import type { AccessPolicy } from "../config.js";

export class PolicyError extends Error {
  constructor(message = "Discord target is not allowed by policy") { super(message); this.name = "PolicyError"; }
}

export function assertGuildAllowed(policy: AccessPolicy, guildId: string): void {
  if (policy.allowedGuildIds.length > 0) {
    if (!policy.allowedGuildIds.includes(guildId)) throw new PolicyError();
    return;
  }
  if (policy.remoteMode) throw new PolicyError();
}

export function assertChannelAllowed(policy: AccessPolicy, channelId: string, guildId: string | null): void {
  if (!guildId) throw new PolicyError("DM channels cannot be addressed through channel tools");
  if (policy.allowedChannelIds.length > 0) {
    if (!policy.allowedChannelIds.includes(channelId)) throw new PolicyError();
  } else if (policy.remoteMode && policy.allowedGuildIds.length === 0) {
    throw new PolicyError();
  }
  if (policy.allowedGuildIds.length > 0) assertGuildAllowed(policy, guildId);
}

export function assertDmAllowed(policy: AccessPolicy, userId: string): void {
  if (!policy.allowedDmUserIds.includes(userId)) throw new PolicyError("DM recipient is not allowed by policy");
}
