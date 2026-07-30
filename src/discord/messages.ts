import { Message, MessageCreateOptions } from "discord.js";
import { findChannel, SendableChannel } from "./client.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fire typing indicator then wait long enough for Discord to render it before
 * the message lands. Length scales with content (~30 chars/sec, min 800ms,
 * cap 3000ms) so it feels like a human composing.
 */
async function typingBeat(channel: SendableChannel, content?: string) {
  if (!("sendTyping" in channel)) return;
  await channel.sendTyping().catch(() => null);
  const len = content?.length ?? 60;
  const ms = Math.min(3000, Math.max(800, Math.round(len * 33)));
  await sleep(ms);
}

export interface SendOpts {
  server?: string;
  channel: string;
  content?: string;
  replyToMessageId?: string;
  fallbackGuildId?: string;
}

export async function sendMessage(opts: SendOpts & { extra?: MessageCreateOptions }) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const payload: MessageCreateOptions = {
    content: opts.content,
    ...(opts.extra ?? {}),
  };
  if (opts.replyToMessageId) {
    payload.reply = { messageReference: opts.replyToMessageId, failIfNotExists: false };
  }
  await typingBeat(channel, opts.content);
  const sent = await channel.send(payload);
  return { id: sent.id, channelId: channel.id, channelName: "name" in channel ? channel.name : "(dm)" };
}

export async function readMessages(opts: {
  server?: string;
  channel: string;
  limit?: number;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const fetched = await channel.messages.fetch({ limit });
  return Array.from(fetched.values()).map((msg) => {
    try {
      return formatMessage(msg);
    } catch (err) {
      // One malformed message (null author, system/webhook entry, odd embed)
      // must not take down the whole scroll-back. Degrade to a minimal stub.
      return {
        id: (msg as Message)?.id ?? null,
        content: (msg as Message)?.content ?? "",
        formatError: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function formatMessage(msg: Message) {
  return {
    id: msg.id,
    author: msg.author
      ? { id: msg.author.id, tag: msg.author.tag, bot: msg.author.bot }
      : null,
    content: msg.content ?? "",
    timestamp: msg.createdAt.toISOString(),
    editedAt: msg.editedAt?.toISOString() ?? null,
    attachments: msg.attachments.map((a) => ({
      id: a.id,
      name: a.name ?? null,
      url: a.url,
      contentType: a.contentType,
      size: a.size,
      isVoiceMessage: (a.flags?.bitfield ?? 0) !== 0,
      duration: a.duration ?? null,
      waveform: a.waveform ?? null,
    })),
    embeds: msg.embeds.map((e) => ({
      title: e.title ?? null,
      description: e.description ?? null,
      url: e.url ?? null,
      type: e.data?.type ?? null,
    })),
    stickers: msg.stickers.map((s) => ({ id: s.id, name: s.name ?? null })),
    reactions: msg.reactions.cache.map((r) => ({
      emoji: r.emoji.toString(),
      count: r.count,
    })),
    reference: msg.reference?.messageId ?? null,
    pinned: msg.pinned,
  };
}

export async function editMessage(opts: {
  server?: string;
  channel: string;
  messageId: string;
  content: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const msg = await channel.messages.fetch(opts.messageId);
  const edited = await msg.edit({ content: opts.content });
  return { id: edited.id };
}

export async function deleteMessage(opts: {
  server?: string;
  channel: string;
  messageId: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const msg = await channel.messages.fetch(opts.messageId);
  await msg.delete();
  return { ok: true };
}

export async function reactToMessage(opts: {
  server?: string;
  channel: string;
  messageId: string;
  emoji: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  const msg = await channel.messages.fetch(opts.messageId);
  await msg.react(opts.emoji);
  return { ok: true };
}

export async function setTyping(opts: {
  server?: string;
  channel: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  if ("sendTyping" in channel) {
    await channel.sendTyping();
  }
  return { ok: true };
}
