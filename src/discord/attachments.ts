import { AttachmentBuilder, type MessageCreateOptions } from "discord.js";
import { open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { findChannel } from "./client.js";
import type { AccessPolicy, LimitsConfig } from "../config.js";

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) ||
    (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

export function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;
  const ip = address.toLowerCase().split("%")[0];
  if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") ||
      ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || ip.startsWith("ff")) return true;
  if (ip.startsWith("::ffff:")) return isPrivateIpv4(ip.slice(7));
  return false;
}

async function validateRemoteUrl(url: URL): Promise<void> {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Attachment URL must use http or https");
  if (url.username || url.password) throw new Error("Attachment URL credentials are not allowed");
  if (url.hostname.toLowerCase() === "localhost") throw new Error("Attachment URL targets a blocked address");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(a => isBlockedAddress(a.address))) throw new Error("Attachment URL targets a blocked address");
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Attachment exceeds configured byte limit");
  if (!response.body) throw new Error("Attachment response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("Attachment exceeds configured byte limit"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), size);
}

export async function fetchAttachment(source: string, limits: LimitsConfig): Promise<{ data: Buffer; name: string }> {
  let current = new URL(source);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), limits.attachmentTimeoutMs);
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      await validateRemoteUrl(current);
      const response = await fetch(current, { redirect: "manual", signal: controller.signal });
      if (REDIRECT_CODES.has(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) throw new Error("Attachment redirect limit exceeded");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`Attachment fetch failed with HTTP ${response.status}`);
      const data = await readBoundedBody(response, limits.attachmentBytes);
      const candidate = basename(decodeURIComponent(current.pathname));
      return { data, name: candidate && extname(candidate) ? candidate : "attachment.bin" };
    }
    throw new Error("Attachment redirect limit exceeded");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Attachment fetch timed out");
    throw error;
  } finally { clearTimeout(timeout); }
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function readLocalAttachment(source: string, policy: AccessPolicy, maxBytes: number): Promise<{ data: Buffer; name: string }> {
  if (!policy.allowLocalFiles) throw new Error("Local file attachments are disabled");
  const target = await realpath(resolve(source));
  const roots = await Promise.all(policy.allowedLocalRoots.map(root => realpath(root)));
  if (!roots.some(root => isWithin(root, target))) throw new Error("Local file is outside configured allowed roots");
  const handle = await open(target, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Local attachment is not a regular file or exceeds configured byte limit");
    return { data: await handle.readFile(), name: basename(target) || "attachment.bin" };
  } finally { await handle.close(); }
}

export async function loadAttachment(source: string, filename: string | undefined, policy: AccessPolicy, limits: LimitsConfig, remoteMode: boolean): Promise<AttachmentBuilder> {
  const remote = /^https?:\/\//i.test(source);
  if (!remote && remoteMode) throw new Error("Remote HTTP mode cannot read local file paths");
  const loaded = remote ? await fetchAttachment(source, limits) : await readLocalAttachment(source, policy, limits.attachmentBytes);
  return new AttachmentBuilder(loaded.data, { name: filename?.trim() || loaded.name || "attachment.bin" });
}

export async function sendImage(opts: {
  server?: string; channel: string; source: string; caption?: string; filename?: string; fallbackGuildId?: string;
  policy: AccessPolicy; limits: LimitsConfig; remoteMode: boolean;
}) {
  if ((opts.caption?.length ?? 0) > opts.limits.messageChars) throw new Error("Caption exceeds configured message limit");
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const attachment = await loadAttachment(opts.source, opts.filename, opts.policy, opts.limits, opts.remoteMode);
  const payload: MessageCreateOptions = { content: opts.caption, files: [attachment], allowedMentions: { parse: [] } };
  const sent = await channel.send(payload);
  return { id: sent.id };
}
export const sendFile = sendImage;
