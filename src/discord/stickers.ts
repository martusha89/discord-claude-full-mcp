import { findGuild, findChannel } from "./client.js";

export async function listStickers(opts: { server?: string; fallbackGuildId?: string }) {
  const guild = await findGuild(opts.server, opts.fallbackGuildId);
  await guild.stickers.fetch();
  return guild.stickers.cache.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    tags: s.tags,
    format: s.format,
  }));
}

export async function sendSticker(opts: {
  server?: string;
  channel: string;
  stickerId: string;
  content?: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  if ("sendTyping" in channel) {
    await channel.sendTyping().catch(() => null);
  }
  const sent = await channel.send({
    content: opts.content,
    allowedMentions: { parse: [], repliedUser: false },
    stickers: [opts.stickerId],
  });
  return { id: sent.id };
}
