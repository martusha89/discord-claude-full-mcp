import { ChannelType, ActivityType, type PresenceStatusData } from "discord.js";
import { allowedGuilds, getClient, findGuild, getPolicy } from "./client.js";
export async function listServers() { return allowedGuilds().map(g => ({ id: g.id, name: g.name, memberCount: g.memberCount })); }
export async function listChannels(opts: { server?: string; fallbackGuildId?: string }) {
  const guild = await findGuild(opts.server, opts.fallbackGuildId); await guild.channels.fetch(); const policy = getPolicy();
  return guild.channels.cache.filter(c => policy.allowedChannelIds.length === 0 || policy.allowedChannelIds.includes(c.id))
    .map(c => ({ id: c.id, name: c.name, type: ChannelType[c.type] }));
}
export async function setStatus(opts: { status?: "online" | "idle" | "dnd" | "invisible"; activityName?: string; activityType?: "playing" | "streaming" | "listening" | "watching" | "competing" }) {
  const client = getClient(); if (!client.user) throw new Error("Bot user not ready");
  const map = { playing: ActivityType.Playing, streaming: ActivityType.Streaming, listening: ActivityType.Listening, watching: ActivityType.Watching, competing: ActivityType.Competing };
  const status: PresenceStatusData = opts.status ?? "online"; const activities = opts.activityName ? [{ name: opts.activityName.slice(0, 128), type: opts.activityType ? map[opts.activityType] : ActivityType.Playing }] : [];
  client.user.setPresence({ status, activities }); return { ok: true, status, activity: activities[0] ?? null };
}
