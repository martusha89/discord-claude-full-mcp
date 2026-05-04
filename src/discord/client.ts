import {
  Client,
  GatewayIntentBits,
  Partials,
  TextChannel,
  ThreadChannel,
  DMChannel,
  NewsChannel,
  Guild,
  ChannelType,
} from "discord.js";

export type SendableChannel = TextChannel | ThreadChannel | DMChannel | NewsChannel;

let _client: Client | null = null;

export function createClient(): Client {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildEmojisAndStickers,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });
  _client = client;
  return client;
}

export function getClient(): Client {
  if (!_client) throw new Error("Discord client not initialized");
  return _client;
}

export async function findGuild(
  identifier?: string,
  fallbackId?: string
): Promise<Guild> {
  const client = getClient();
  const target = identifier ?? fallbackId;

  if (!target) {
    if (client.guilds.cache.size === 1) return client.guilds.cache.first()!;
    const list = Array.from(client.guilds.cache.values())
      .map((g) => `"${g.name}"`)
      .join(", ");
    throw new Error(
      `Multiple servers — pass server name or ID. Available: ${list}`
    );
  }

  try {
    const g = await client.guilds.fetch(target);
    if (g) return g;
  } catch {
    // fall through to name search
  }

  const matches = client.guilds.cache.filter(
    (g) => g.name.toLowerCase() === target.toLowerCase()
  );
  if (matches.size === 1) return matches.first()!;
  if (matches.size > 1) {
    const list = matches.map((g) => `${g.name} (${g.id})`).join(", ");
    throw new Error(`Multiple servers named "${target}": ${list}`);
  }

  const all = Array.from(client.guilds.cache.values())
    .map((g) => `"${g.name}"`)
    .join(", ");
  throw new Error(`Server "${target}" not found. Available: ${all}`);
}

export function isSendable(c: unknown): c is SendableChannel {
  return (
    c instanceof TextChannel ||
    c instanceof ThreadChannel ||
    c instanceof DMChannel ||
    c instanceof NewsChannel
  );
}

export async function findChannel(
  channelIdentifier: string,
  guildIdentifier: string | undefined,
  fallbackGuildId?: string
): Promise<SendableChannel> {
  const client = getClient();

  // Try direct channel ID fetch first
  try {
    const c = await client.channels.fetch(channelIdentifier);
    if (isSendable(c)) return c;
  } catch {
    // fall through
  }

  const guild = await findGuild(guildIdentifier, fallbackGuildId);
  const stripped = channelIdentifier.replace(/^#/, "").toLowerCase();
  const matches: SendableChannel[] = [];
  for (const c of guild.channels.cache.values()) {
    if (
      isSendable(c) &&
      "name" in c &&
      c.name.toLowerCase() === stripped
    ) {
      matches.push(c);
    }
  }

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const list = matches.map((c) => `#${("name" in c ? c.name : "?")} (${c.id})`).join(", ");
    throw new Error(
      `Multiple channels named "${channelIdentifier}" in ${guild.name}: ${list}`
    );
  }

  const available = guild.channels.cache
    .filter((c) => c.type === ChannelType.GuildText)
    .map((c) => `"#${c.name}"`)
    .join(", ");
  throw new Error(
    `Channel "${channelIdentifier}" not found in ${guild.name}. Available: ${available}`
  );
}
