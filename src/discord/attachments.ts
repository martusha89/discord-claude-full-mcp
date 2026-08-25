import { AttachmentBuilder } from "discord.js";
import { lookup } from "node:dns/promises";
import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { basename, isAbsolute, relative, sep } from "node:path";
import { findChannel } from "./client.js";

export interface AttachmentPolicy {
  allowedFileRoots: string[];
  maxBytes: number;
}

const blockedAddresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedAddresses.addSubnet(network, prefix, "ipv6");
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family === 6) return !blockedAddresses.check(address, "ipv6");
  return false;
}

export function isPathWithinRoot(root: string, sourcePath: string): boolean {
  const pathFromRoot = relative(root, sourcePath);
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromRoot)
  );
}

export function resolveRedirectUrl(location: string, currentUrl: URL): URL {
  try {
    return new URL(location, currentUrl);
  } catch {
    throw new Error("Attachment URL returned an invalid redirect location.");
  }
}

async function resolvePublicAddress(hostname: string, deadlineAt: number) {
  const normalizedHostname = hostname.replace(/^\[(.*)\]$/, "$1");
  const literalFamily = isIP(normalizedHostname);
  let addresses: Array<{ address: string; family: number }>;
  if (literalFamily) {
    addresses = [{ address: normalizedHostname, family: literalFamily }];
  } else {
    const remainingTime = deadlineAt - Date.now();
    if (remainingTime <= 0) {
      throw new Error("Attachment DNS lookup exceeded the overall deadline.");
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      addresses = await Promise.race([
        lookup(normalizedHostname, { all: true, verbatim: true }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Attachment DNS lookup exceeded the overall deadline.")),
            remainingTime
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (!addresses.length || addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new Error("Attachment URL resolves to a private or reserved network address.");
  }

  return addresses[0];
}

export async function downloadRemoteAttachment(
  initialUrl: URL,
  maxBytes: number,
  redirectsRemaining = 3,
  deadlineAt = Date.now() + 30_000
): Promise<Buffer> {
  if (initialUrl.protocol !== "https:") {
    throw new Error("Remote attachments must use HTTPS.");
  }
  if (initialUrl.username || initialUrl.password) {
    throw new Error("Attachment URLs must not contain credentials.");
  }
  if (initialUrl.port && initialUrl.port !== "443") {
    throw new Error("Remote attachments must use the standard HTTPS port.");
  }

  const pinned = await resolvePublicAddress(initialUrl.hostname, deadlineAt);

  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      rejectPromise(error);
    };

    const req = request(
      initialUrl,
      {
        headers: { "User-Agent": "discord-claude-full-mcp/0.1" },
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = res.headers.location;
          res.destroy();
          if (!location || redirectsRemaining <= 0) {
            fail(new Error("Attachment URL redirected too many times."));
            return;
          }
          let redirectUrl: URL;
          try {
            redirectUrl = resolveRedirectUrl(location, initialUrl);
          } catch (error) {
            fail(error instanceof Error ? error : new Error("Invalid attachment redirect."));
            return;
          }
          settled = true;
          if (deadline) clearTimeout(deadline);
          downloadRemoteAttachment(
            redirectUrl,
            maxBytes,
            redirectsRemaining - 1,
            deadlineAt
          ).then(resolvePromise, rejectPromise);
          return;
        }

        if (status < 200 || status >= 300) {
          res.destroy();
          fail(new Error(`Attachment download failed with HTTP ${status}.`));
          return;
        }

        const declaredLength = Number.parseInt(
          String(res.headers["content-length"] || "0"),
          10
        );
        if (declaredLength > maxBytes) {
          res.destroy();
          fail(new Error("Attachment exceeds the configured size ceiling."));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            res.destroy();
            fail(new Error("Attachment exceeds the configured size ceiling."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", fail);
        res.on("end", () => {
          if (settled) return;
          settled = true;
          if (deadline) clearTimeout(deadline);
          resolvePromise(Buffer.concat(chunks));
        });
      }
    );

    req.setTimeout(15_000, () => {
      req.destroy(new Error("Attachment download timed out."));
    });
    const deadlineDelay = Math.max(1, deadlineAt - Date.now());
    deadline = setTimeout(() => {
      req.destroy(new Error("Attachment download exceeded the overall deadline."));
    }, deadlineDelay);
    req.on("error", fail);
    req.end();
  });
}

export async function loadLocalAttachment(
  source: string,
  policy: AttachmentPolicy
): Promise<Buffer> {
  if (!policy.allowedFileRoots.length) {
    throw new Error(
      "Local attachments are disabled. Configure DISCORD_ALLOWED_FILE_ROOTS to enable them."
    );
  }

  const sourcePath = await realpath(source).catch(() => null);
  if (!sourcePath) throw new Error("Local attachment was not found.");

  const permittedRoots = await Promise.all(
    policy.allowedFileRoots.map((root) => realpath(root).catch(() => null))
  );
  const permitted = permittedRoots.some((root) => {
    if (!root) return false;
    return isPathWithinRoot(root, sourcePath);
  });
  if (!permitted) {
    throw new Error("Local attachment is outside the configured allowed roots.");
  }

  const expectedDetails = await stat(sourcePath);
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(sourcePath, constants.O_RDONLY | noFollow);
  try {
    const openedDetails = await handle.stat();
    if (
      expectedDetails.dev !== openedDetails.dev ||
      expectedDetails.ino !== openedDetails.ino
    ) {
      throw new Error("Local attachment changed while it was being opened.");
    }
    if (!openedDetails.isFile()) {
      throw new Error("Local attachment is not a regular file.");
    }
    if (openedDetails.size > policy.maxBytes) {
      throw new Error("Attachment exceeds the configured size ceiling.");
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= policy.maxBytes) {
      const remaining = policy.maxBytes + 1 - total;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      chunks.push(chunk.subarray(0, bytesRead));
    }
    if (total > policy.maxBytes) {
      throw new Error("Attachment exceeds the configured size ceiling.");
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function loadAttachment(
  source: string,
  filename: string | undefined,
  policy: AttachmentPolicy
) {
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source);
    const buffer = await downloadRemoteAttachment(url, policy.maxBytes);
    return new AttachmentBuilder(buffer, {
      name: filename ?? (basename(url.pathname) || "file"),
    });
  }

  const buffer = await loadLocalAttachment(source, policy);
  return new AttachmentBuilder(buffer, { name: filename ?? basename(source) });
}

export async function sendImage(opts: {
  server?: string;
  channel: string;
  source: string;
  caption?: string;
  filename?: string;
  fallbackGuildId?: string;
  attachmentPolicy: AttachmentPolicy;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  if ("sendTyping" in channel) {
    await channel.sendTyping().catch(() => null);
  }
  const attachment = await loadAttachment(
    opts.source,
    opts.filename,
    opts.attachmentPolicy
  );
  const sent = await channel.send({
    content: opts.caption,
    allowedMentions: { parse: [], repliedUser: false },
    files: [attachment],
  });
  return { id: sent.id };
}

export async function sendFile(opts: Parameters<typeof sendImage>[0]) {
  return sendImage(opts);
}
