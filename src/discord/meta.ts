import { ChannelType, ActivityType, PresenceStatusData } from "discord.js";
import { getClient, findGuild } from "./client.js";
import {
  publicChannelReference,
  publicServerReference,
} from "../privacy.js";

export async function listServers() {
  const client = getClient();
  return Array.from(client.guilds.cache.values()).map((g) => ({
    id: publicServerReference(g.id),
    name: g.name,
    memberCount: g.memberCount,
  }));
}

export async function listChannels(opts: { server?: string; fallbackGuildId?: string }) {
  const guild = await findGuild(opts.server, opts.fallbackGuildId);
  await guild.channels.fetch();
  return guild.channels.cache.map((c) => ({
    id: publicChannelReference(c.id),
    name: c.name,
    type: ChannelType[c.type],
  }));
}

export async function setStatus(opts: {
  status?: "online" | "idle" | "dnd" | "invisible";
  activityName?: string;
  activityType?: "playing" | "streaming" | "listening" | "watching" | "competing";
}) {
  const client = getClient();
  if (!client.user) throw new Error("Bot user not ready");

  const activityTypeMap: Record<string, ActivityType> = {
    playing: ActivityType.Playing,
    streaming: ActivityType.Streaming,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing,
  };

  const status: PresenceStatusData = opts.status ?? "online";
  const activities = opts.activityName
    ? [
        {
          name: opts.activityName,
          type: opts.activityType
            ? activityTypeMap[opts.activityType]
            : ActivityType.Playing,
          state: opts.activityName,
        },
      ]
    : [];

  client.user.setPresence({ status, activities });

  // Give the gateway 600ms to push the PRESENCE_UPDATE packet before we return.
  await new Promise((r) => setTimeout(r, 600));

  return {
    ok: true,
    status,
    activity: activities[0] ?? null,
  };
}
