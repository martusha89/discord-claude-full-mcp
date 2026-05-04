#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig, isElevenLabsReady, RuntimeConfig } from "./config.js";
import { createClient } from "./discord/client.js";
import {
  sendMessage,
  readMessages,
  editMessage,
  deleteMessage,
  reactToMessage,
  setTyping,
} from "./discord/messages.js";
import { sendImage, sendFile } from "./discord/attachments.js";
import { listEmojis, resolveEmojiPlaceholders } from "./discord/emojis.js";
import { listStickers, sendSticker } from "./discord/stickers.js";
import { listServers, listChannels, setStatus } from "./discord/meta.js";
import { sendVoiceNote } from "./discord/voice.js";

const cfg: RuntimeConfig = loadConfig();
const fallbackGuildId = cfg.defaults.guildId || undefined;
const elevenReady = isElevenLabsReady(cfg);

const client = createClient();

const server = new Server(
  { name: "discord-claude-full-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const baseTools = [
  {
    name: "send_message",
    description:
      "Send a text message to a Discord channel. Supports `:emoji_name:` shortcuts (resolved against the server's custom emojis) and optional reply-to.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string", description: "Server name or ID (optional if bot is in one server or default is configured)" },
        channel: { type: "string", description: "Channel name (e.g. 'general') or channel ID" },
        message: { type: "string", description: "Message content" },
        replyToMessageId: { type: "string", description: "Optional message ID to reply to" },
      },
      required: ["channel", "message"],
    },
  },
  {
    name: "read_messages",
    description: "Read recent messages from a channel. Includes attachments, embeds, stickers, reactions, and reply references.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        limit: { type: "number", description: "1-100, default 50" },
      },
      required: ["channel"],
    },
  },
  {
    name: "edit_message",
    description: "Edit a message previously sent by the bot.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        messageId: { type: "string" },
        content: { type: "string" },
      },
      required: ["channel", "messageId", "content"],
    },
  },
  {
    name: "delete_message",
    description: "Delete a message by ID.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        messageId: { type: "string" },
      },
      required: ["channel", "messageId"],
    },
  },
  {
    name: "react_to_message",
    description: "Add a reaction to a message. Use a unicode emoji ('🔥') or server emoji in `<:name:id>` form.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        messageId: { type: "string" },
        emoji: { type: "string" },
      },
      required: ["channel", "messageId", "emoji"],
    },
  },
  {
    name: "set_typing",
    description: "Trigger the bot's typing indicator in a channel for ~10 seconds.",
    inputSchema: {
      type: "object",
      properties: { server: { type: "string" }, channel: { type: "string" } },
      required: ["channel"],
    },
  },
  {
    name: "send_image",
    description: "Send an image (path or URL) with an optional caption.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        source: { type: "string", description: "Local file path or http(s) URL" },
        caption: { type: "string" },
        filename: { type: "string", description: "Override filename" },
      },
      required: ["channel", "source"],
    },
  },
  {
    name: "send_file",
    description: "Send any file (path or URL) as an attachment.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        source: { type: "string" },
        caption: { type: "string" },
        filename: { type: "string" },
      },
      required: ["channel", "source"],
    },
  },
  {
    name: "send_sticker",
    description: "Send a server sticker by ID. Use list_stickers to discover IDs.",
    inputSchema: {
      type: "object",
      properties: {
        server: { type: "string" },
        channel: { type: "string" },
        stickerId: { type: "string" },
        content: { type: "string", description: "Optional accompanying text" },
      },
      required: ["channel", "stickerId"],
    },
  },
  {
    name: "list_servers",
    description: "List every server the bot is a member of.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_channels",
    description: "List channels in a server.",
    inputSchema: {
      type: "object",
      properties: { server: { type: "string" } },
    },
  },
  {
    name: "list_emojis",
    description: "List custom emojis available in a server.",
    inputSchema: {
      type: "object",
      properties: { server: { type: "string" } },
    },
  },
  {
    name: "list_stickers",
    description: "List stickers available in a server.",
    inputSchema: {
      type: "object",
      properties: { server: { type: "string" } },
    },
  },
  {
    name: "set_status",
    description: "Update the bot's presence (online/idle/dnd/invisible) and optional activity text.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["online", "idle", "dnd", "invisible"] },
        activityName: { type: "string" },
        activityType: {
          type: "string",
          enum: ["playing", "streaming", "listening", "watching", "competing"],
        },
      },
    },
  },
];

const voiceTool = {
  name: "send_voice_note",
  description:
    "Send a Discord voice message generated from text via ElevenLabs TTS. Renders as a real waveform-bar voice note in Discord. Requires ELEVENLABS_API_KEY and a voiceId in config.json.",
  inputSchema: {
    type: "object",
    properties: {
      server: { type: "string" },
      channel: { type: "string" },
      text: { type: "string", description: "What you want the voice to say" },
    },
    required: ["channel", "text"],
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: elevenReady ? [...baseTools, voiceTool] : baseTools,
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as any;

  try {
    switch (name) {
      case "send_message": {
        const message = await resolveEmojiPlaceholders(a.message, a.server, fallbackGuildId);
        const r = await sendMessage({
          server: a.server,
          channel: a.channel,
          content: message,
          replyToMessageId: a.replyToMessageId,
          fallbackGuildId,
        });
        return ok(`Sent (id: ${r.id}) to #${r.channelName}`);
      }
      case "read_messages": {
        const msgs = await readMessages({
          server: a.server,
          channel: a.channel,
          limit: a.limit,
          fallbackGuildId,
        });
        return ok(JSON.stringify(msgs, null, 2));
      }
      case "edit_message": {
        const r = await editMessage({ ...a, fallbackGuildId });
        return ok(`Edited ${r.id}`);
      }
      case "delete_message": {
        await deleteMessage({ ...a, fallbackGuildId });
        return ok(`Deleted ${a.messageId}`);
      }
      case "react_to_message": {
        await reactToMessage({ ...a, fallbackGuildId });
        return ok(`Reacted with ${a.emoji}`);
      }
      case "set_typing": {
        await setTyping({ ...a, fallbackGuildId });
        return ok("Typing.");
      }
      case "send_image":
      case "send_file": {
        const fn = name === "send_image" ? sendImage : sendFile;
        const r = await fn({ ...a, fallbackGuildId });
        return ok(`Sent (id: ${r.id})`);
      }
      case "send_sticker": {
        const r = await sendSticker({ ...a, fallbackGuildId });
        return ok(`Sent sticker (id: ${r.id})`);
      }
      case "list_servers":
        return ok(JSON.stringify(await listServers(), null, 2));
      case "list_channels":
        return ok(JSON.stringify(await listChannels({ ...a, fallbackGuildId }), null, 2));
      case "list_emojis":
        return ok(JSON.stringify(await listEmojis({ ...a, fallbackGuildId }), null, 2));
      case "list_stickers":
        return ok(JSON.stringify(await listStickers({ ...a, fallbackGuildId }), null, 2));
      case "set_status":
        await setStatus(a);
        return ok("Status updated.");
      case "send_voice_note": {
        if (!elevenReady) {
          return err(
            "ElevenLabs is not configured. Set ELEVENLABS_API_KEY in .env and voiceId in config.json."
          );
        }
        const r = await sendVoiceNote({
          apiKey: cfg.elevenLabsApiKey!,
          cfg: cfg.elevenlabs,
          server: a.server,
          channel: a.channel,
          text: a.text,
          fallbackGuildId,
        });
        return ok(`Voice note sent (id: ${r.id}, ${r.durationSecs.toFixed(1)}s)`);
      }
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function err(text: string) {
  return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true };
}

client.once("ready", () => {
  console.error(`[discord] logged in as ${client.user?.tag}`);
  console.error(`[elevenlabs] ${elevenReady ? "ready" : "disabled (no API key or voiceId)"}`);
});

async function main() {
  await client.login(cfg.discordToken);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] discord-claude-full-mcp running on stdio");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
