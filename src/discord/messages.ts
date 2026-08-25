import { type Message, type MessageCreateOptions } from "discord.js";
import { findChannel, getClient, getPolicy, type SendableChannel } from "./client.js";
import { assertDmAllowed } from "./policy.js";
import type { LimitsConfig } from "../config.js";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function checkText(value: string | undefined, max: number, label = "Message"): void {
  if ((value?.length ?? 0) > max) throw new Error(`${label} exceeds configured ${max} character limit`);
}
async function typingBeat(channel: SendableChannel, content: string | undefined, limits: LimitsConfig) {
  if (!("sendTyping" in channel) || limits.typingDelayMaxMs === 0) return;
  await channel.sendTyping().catch(() => undefined);
  const scaled = Math.round((content?.length ?? 0) * 33);
  await sleep(Math.min(limits.typingDelayMaxMs, Math.max(limits.typingDelayMinMs, scaled)));
}
export interface SendOpts { server?: string; channel: string; content?: string; replyToMessageId?: string; fallbackGuildId?: string; limits: LimitsConfig; }
export async function sendMessage(opts: SendOpts & { extra?: MessageCreateOptions }) {
  checkText(opts.content, opts.limits.messageChars);
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const payload: MessageCreateOptions = { content: opts.content, allowedMentions: { parse: [] }, ...(opts.extra ?? {}) };
  if (opts.replyToMessageId) payload.reply = { messageReference: opts.replyToMessageId, failIfNotExists: true };
  await typingBeat(channel, opts.content, opts.limits);
  const sent = await channel.send(payload);
  return { id: sent.id, channelId: channel.id, channelName: "name" in channel ? channel.name : "(dm)" };
}
export async function readMessages(opts: { server?: string; channel: string; limit?: number; fallbackGuildId?: string }) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const fetched = await channel.messages.fetch({ limit: Math.min(Math.max(opts.limit ?? 50, 1), 100) });
  return Array.from(fetched.values()).map(formatMessage);
}
export function formatMessage(msg: Message) {
  return {
    id: msg.id, author: { id: msg.author.id, tag: msg.author.tag, bot: msg.author.bot }, content: msg.content,
    timestamp: msg.createdAt.toISOString(), editedAt: msg.editedAt?.toISOString() ?? null,
    attachments: msg.attachments.map(a => ({ id: a.id, name: a.name || "attachment", url: a.url, contentType: a.contentType,
      size: a.size, isVoiceMessage: a.flags?.has(1 << 13) ?? false, duration: a.duration ?? null, waveform: a.waveform ?? null })),
    embeds: msg.embeds.map(e => ({ title: e.title, description: e.description, url: e.url, type: e.data.type })),
    stickers: msg.stickers.map(s => ({ id: s.id, name: s.name })), reactions: msg.reactions.cache.map(r => ({ emoji: r.emoji.toString(), count: r.count })),
    reference: msg.reference?.messageId ?? null, pinned: msg.pinned,
  };
}
export async function editMessage(opts: { server?: string; channel: string; messageId: string; content: string; fallbackGuildId?: string; limits: LimitsConfig }) {
  checkText(opts.content, opts.limits.messageChars); const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  return { id: (await (await channel.messages.fetch(opts.messageId)).edit({ content: opts.content, allowedMentions: { parse: [] } })).id };
}
export async function deleteMessage(opts: { server?: string; channel: string; messageId: string; fallbackGuildId?: string }) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId); await (await channel.messages.fetch(opts.messageId)).delete(); return { ok: true };
}
export async function reactToMessage(opts: { server?: string; channel: string; messageId: string; emoji: string; fallbackGuildId?: string }) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId); await (await channel.messages.fetch(opts.messageId)).react(opts.emoji); return { ok: true };
}
export async function setTyping(opts: { server?: string; channel: string; fallbackGuildId?: string }) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId); if ("sendTyping" in channel) await channel.sendTyping(); return { ok: true };
}
export async function sendDirectMessage(opts: { userId: string; content: string; limits: LimitsConfig }) {
  checkText(opts.content, opts.limits.messageChars); assertDmAllowed(getPolicy(), opts.userId);
  const user = await getClient().users.fetch(opts.userId); const dm = await user.createDM(); await typingBeat(dm, opts.content, opts.limits);
  const sent = await dm.send({ content: opts.content, allowedMentions: { parse: [] } }); return { id: sent.id, channelId: dm.id, recipient: user.tag };
}
