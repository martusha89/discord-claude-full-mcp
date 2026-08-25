import {
  Client, GatewayIntentBits, Partials, TextChannel, ThreadChannel, DMChannel,
  NewsChannel, Guild, ChannelType,
} from "discord.js";
import type { AccessPolicy } from "../config.js";
import { assertChannelAllowed, assertGuildAllowed } from "./policy.js";

export type SendableChannel = TextChannel | ThreadChannel | DMChannel | NewsChannel;
let _client: Client | null = null;
let _policy: AccessPolicy | null = null;

export function createClient(policy: AccessPolicy): Client {
  _policy = policy;
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent, GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel, Partials.Message],
  });
  _client = client;
  return client;
}
export function getClient(): Client { if (!_client) throw new Error("Discord client not initialized"); return _client; }
export function getPolicy(): AccessPolicy { if (!_policy) throw new Error("Discord policy not initialized"); return _policy; }

export async function findGuild(identifier?: string, fallbackId?: string): Promise<Guild> {
  const client = getClient();
  const policy = getPolicy();
  const target = identifier ?? fallbackId;
  if (!target) {
    const allowed = client.guilds.cache.filter(g =>
      policy.allowedGuildIds.length > 0
        ? policy.allowedGuildIds.includes(g.id)
        : !policy.remoteMode
    );
    if (allowed.size === 1) return allowed.first()!;
    throw new Error("Pass an allowed server name or ID");
  }
  try {
    const guild = await client.guilds.fetch(target);
    if (guild) { assertGuildAllowed(policy, guild.id); return guild; }
  } catch (error) { if (error instanceof Error && error.name === "PolicyError") throw error; }
  const matches = client.guilds.cache.filter(g =>
    g.name.toLowerCase() === target.toLowerCase() &&
    (policy.allowedGuildIds.length > 0
      ? policy.allowedGuildIds.includes(g.id)
      : !policy.remoteMode)
  );
  if (matches.size === 1) {
    const guild = matches.first()!;
    assertGuildAllowed(policy, guild.id);
    return guild;
  }
  throw new Error(matches.size > 1 ? "Server name is ambiguous; use its ID" : "Server not found or not allowed");
}

export function isSendable(c: unknown): c is SendableChannel {
  return c instanceof TextChannel || c instanceof ThreadChannel || c instanceof DMChannel || c instanceof NewsChannel;
}

export async function findChannel(channelIdentifier: string, guildIdentifier?: string, fallbackGuildId?: string): Promise<SendableChannel> {
  const client = getClient();
  const policy = getPolicy();
  if (/^\d{17,20}$/.test(channelIdentifier)) {
    const channel = await client.channels.fetch(channelIdentifier).catch(() => null);
    if (!isSendable(channel)) throw new Error("Channel not found");
    assertChannelAllowed(policy, channel.id, "guildId" in channel ? channel.guildId : null);
    if (guildIdentifier || fallbackGuildId) {
      const guild = await findGuild(guildIdentifier, fallbackGuildId);
      if (!("guildId" in channel) || channel.guildId !== guild.id) throw new Error("Channel is not in the selected server");
    }
    return channel;
  }
  const guild = await findGuild(guildIdentifier, fallbackGuildId);
  const stripped = channelIdentifier.replace(/^#/, "").toLowerCase();
  const matches = guild.channels.cache.filter(c => isSendable(c) && "name" in c && c.name.toLowerCase() === stripped &&
    (policy.allowedChannelIds.length === 0 || policy.allowedChannelIds.includes(c.id)));
  if (matches.size !== 1) throw new Error(matches.size > 1 ? "Channel name is ambiguous; use its ID" : "Channel not found or not allowed");
  const channel = matches.first();
  if (!isSendable(channel)) throw new Error("Channel is not sendable");
  assertChannelAllowed(policy, channel.id, channel.guildId);
  return channel;
}

export function allowedGuilds(): Guild[] {
  const policy = getPolicy();
  if (policy.remoteMode && policy.allowedGuildIds.length === 0) return [];
  return Array.from(getClient().guilds.cache.values()).filter(
    g => policy.allowedGuildIds.length === 0 || policy.allowedGuildIds.includes(g.id)
  );
}
