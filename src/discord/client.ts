import {
  Client,
  GatewayIntentBits,
  Partials,
  TextChannel,
  ThreadChannel,
  DMChannel,
  NewsChannel,
  Guild,
} from "discord.js";
import {
  resolveChannelReference,
  resolveServerReference,
} from "../privacy.js";

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
  const rawTarget = identifier ?? fallbackId;
  const target = rawTarget ? resolveServerReference(rawTarget) : undefined;

  if (!target) {
    if (client.guilds.cache.size === 1) return client.guilds.cache.first()!;
    throw new Error("Multiple servers — pass a server name or ID.");
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
    throw new Error(`Multiple servers are named "${target}". Pass its ID.`);
  }

  throw new Error(`Server "${target}" not found.`);
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
  const resolvedChannelIdentifier = resolveChannelReference(channelIdentifier);
  const requestedGuild = guildIdentifier ?? fallbackGuildId;
  const expectedGuild = requestedGuild
    ? await findGuild(guildIdentifier, fallbackGuildId)
    : null;

  // Try direct channel ID fetch first
  try {
    const c = await client.channels.fetch(resolvedChannelIdentifier);
    if (isSendable(c)) {
      if (expectedGuild) {
        if (!("guildId" in c) || c.guildId !== expectedGuild.id) {
          throw new Error("Channel does not belong to the requested server.");
        }
      }
      return c;
    }
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === "Channel does not belong to the requested server."
    ) {
      throw err;
    }
    // fall through
  }

  const guild = expectedGuild ?? (await findGuild(guildIdentifier, fallbackGuildId));
  const stripped = resolvedChannelIdentifier.replace(/^#/, "").toLowerCase();
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
    throw new Error(
      `Multiple channels are named "${channelIdentifier}". Pass the channel ID.`
    );
  }

  throw new Error(`Channel "${channelIdentifier}" not found in ${guild.name}.`);
}
