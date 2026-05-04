import { findGuild } from "./client.js";

export async function listEmojis(opts: { server?: string; fallbackGuildId?: string }) {
  const guild = await findGuild(opts.server, opts.fallbackGuildId);
  await guild.emojis.fetch();
  return guild.emojis.cache.map((e) => ({
    id: e.id,
    name: e.name,
    animated: e.animated ?? false,
    available: e.available ?? true,
    mention: e.toString(),
  }));
}

/**
 * Resolve `:emoji_name:` placeholders in a message body to their full
 * `<:name:id>` form so they render as actual server emojis.
 */
export async function resolveEmojiPlaceholders(
  text: string,
  guildId: string | undefined,
  fallbackGuildId?: string
): Promise<string> {
  if (!text.includes(":")) return text;
  const guild = await findGuild(guildId, fallbackGuildId).catch(() => null);
  if (!guild) return text;
  await guild.emojis.fetch().catch(() => null);

  return text.replace(/(?<![<:\w]):([a-zA-Z0-9_]+):(?!\d+>)/g, (match, name) => {
    const e = guild.emojis.cache.find((x) => x.name === name);
    if (!e) return match;
    return e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`;
  });
}
