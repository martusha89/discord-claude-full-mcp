import { AttachmentBuilder } from "discord.js";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { findChannel } from "./client.js";

async function loadAttachment(source: string, filename?: string) {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return new AttachmentBuilder(buf, {
      name: filename ?? basename(new URL(source).pathname) ?? "file",
    });
  }
  if (!existsSync(source)) {
    throw new Error(`File not found: ${source}`);
  }
  const buf = readFileSync(source);
  return new AttachmentBuilder(buf, { name: filename ?? basename(source) });
}

export async function sendImage(opts: {
  server?: string;
  channel: string;
  source: string;
  caption?: string;
  filename?: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  if ("sendTyping" in channel) {
    await channel.sendTyping().catch(() => null);
  }
  const attachment = await loadAttachment(opts.source, opts.filename);
  const sent = await channel.send({
    content: opts.caption,
    files: [attachment],
  });
  return { id: sent.id };
}

export async function sendFile(opts: {
  server?: string;
  channel: string;
  source: string;
  caption?: string;
  filename?: string;
  fallbackGuildId?: string;
}) {
  return sendImage(opts); // same path; named separately for clarity in tool schema
}
