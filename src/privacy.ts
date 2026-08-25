import { createHmac } from "node:crypto";
import { PrivacyMode } from "./config.js";

let mode: PrivacyMode = "redacted";
let aliasKey = "discord-bridge-unconfigured";

const aliasToUserId = new Map<string, string>();
const aliasToMessageId = new Map<string, string>();
const aliasToServerId = new Map<string, string>();
const aliasToChannelId = new Map<string, string>();

export function configurePrivacy(config: {
  mode: PrivacyMode;
  aliasKey: string;
}) {
  mode = config.mode;
  aliasKey = config.aliasKey;
  aliasToUserId.clear();
  aliasToMessageId.clear();
  aliasToServerId.clear();
  aliasToChannelId.clear();
}

export function getPrivacyMode(): PrivacyMode {
  return mode;
}

/**
 * Produce a stable, non-reversible label while retaining an in-process map so
 * a model can say "reply to User-A1B2C3D4E5F6" without receiving the Discord ID.
 */
export function aliasForUser(userId: string, bot = false): string {
  const digest = createHmac("sha256", aliasKey)
    .update(`user:${userId}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  const alias = `${bot ? "Bot" : "User"}-${digest}`;
  aliasToUserId.set(alias.toLowerCase(), userId);
  return alias;
}

export function aliasForMessage(messageId: string): string {
  const digest = createHmac("sha256", aliasKey)
    .update(`message:${messageId}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  const alias = `Message-${digest}`;
  aliasToMessageId.set(alias.toLowerCase(), messageId);
  return alias;
}

function aliasForResource(
  kind: "Server" | "Channel",
  id: string,
  map: Map<string, string>
): string {
  const digest = createHmac("sha256", aliasKey)
    .update(`${kind.toLowerCase()}:${id}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();
  const alias = `${kind}-${digest}`;
  map.set(alias.toLowerCase(), id);
  return alias;
}

export function publicServerReference(serverId: string): string {
  return mode === "full"
    ? serverId
    : aliasForResource("Server", serverId, aliasToServerId);
}

export function publicChannelReference(channelId: string): string {
  return mode === "full"
    ? channelId
    : aliasForResource("Channel", channelId, aliasToChannelId);
}

function resolveResourceReference(
  reference: string,
  prefix: "Server" | "Channel",
  map: Map<string, string>
): string {
  const value = reference.trim();
  if (!value.toLowerCase().startsWith(`${prefix.toLowerCase()}-`)) return value;
  const resolved = map.get(value.toLowerCase());
  if (!resolved) throw new Error(`Unknown ${prefix.toLowerCase()} alias "${value}".`);
  return resolved;
}

export function resolveServerReference(reference: string): string {
  return resolveResourceReference(reference, "Server", aliasToServerId);
}

export function resolveChannelReference(reference: string): string {
  return resolveResourceReference(reference, "Channel", aliasToChannelId);
}

export function publicMessageReference(messageId: string): string {
  return mode === "full" ? messageId : aliasForMessage(messageId);
}

export function resolveMessageReference(reference: string): string {
  const value = reference.trim();
  if (/^\d{15,22}$/.test(value)) return value;
  const resolved = aliasToMessageId.get(value.toLowerCase());
  if (!resolved) throw new Error(`Unknown message reference "${value}".`);
  return resolved;
}

export function redactDiscordContent(content: string): string {
  return content
    .replace(/<@!?(\d{15,22})>/g, (_match, userId: string) =>
      `@${aliasForUser(userId)}`
    )
    .replace(/<@&\d{15,22}>/g, "@Role")
    .replace(/<#\d{15,22}>/g, "#Channel")
    .replace(/<a?:([A-Za-z0-9_]+):\d{15,22}>/g, ":$1:")
    .replace(
      /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/(?:ephemeral-)?attachments\/\S+/gi,
      "[Discord attachment link omitted]"
    )
    .replace(/\b\d{15,22}\b/g, "[Discord ID omitted]");
}

export function resolveRecipient(recipient: string): string {
  const value = recipient.trim();
  if (/^\d{15,22}$/.test(value)) return value;

  const resolved = aliasToUserId.get(value.toLowerCase());
  if (!resolved) {
    throw new Error(
      `Unknown recipient alias "${value}". Read a message from that person first, or pass their numeric Discord user ID.`
    );
  }
  return resolved;
}
