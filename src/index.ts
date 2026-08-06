#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";

import { loadConfig, isElevenLabsReady, RuntimeConfig } from "./config.js";
import { createClient } from "./discord/client.js";
import {
  sendMessage,
  readMessages,
  editMessage,
  deleteMessage,
  reactToMessage,
  setTyping,
  sendDirectMessage,
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
  {
    name: "send_direct_message",
    description: "Send a direct message (DM) to a Discord user by their user ID.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "Discord user ID (numeric)" },
        message: { type: "string", description: "Message content" },
      },
      required: ["userId", "message"],
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

// Extract tool handler so it can be reused by per-session servers (Streamable HTTP mode)
const toolHandler = async (req: any) => {
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
      case "send_direct_message": {
        const r = await sendDirectMessage({
          userId: a.userId,
          content: a.message,
        });
        return ok(`DM sent to ${r.recipient} (id: ${r.id})`);
      }
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
};

// Register on the global server (used in stdio mode)
server.setRequestHandler(CallToolRequestSchema, toolHandler);

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
  const mode = process.env.MCP_TRANSPORT || "stdio";
  const port = parseInt(process.env.MCP_PORT || "3001", 10);
  const host = process.env.MCP_HOST || "127.0.0.1";
  const authToken = process.env.MCP_AUTH_TOKEN || "";
  const allowedOrigins = (process.env.MCP_ALLOWED_ORIGINS || "https://claude.ai,https://claude.com")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  // The HTTP endpoint gives full control of the Discord bot. Refuse to
  // expose it beyond loopback unless an auth token is configured.
  // Validated before Discord login so a misconfigured server never connects.
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost";
  if ((mode === "sse" || mode === "http") && !loopback && !authToken) {
    console.error(
      `[mcp] Refusing to bind MCP_HOST=${host} without MCP_AUTH_TOKEN. ` +
        "Set MCP_AUTH_TOKEN to a long random secret, or bind to 127.0.0.1."
    );
    process.exit(1);
  }

  await client.login(cfg.discordToken);

  if (mode === "sse" || mode === "http") {
    if (loopback && !authToken) {
      console.error("[mcp] Warning: no MCP_AUTH_TOKEN set. Any local process can drive the bot via this port.");
    }

    const app = express();
    app.use(express.json());

    // CORS restricted to explicitly allowed origins (MCP_ALLOWED_ORIGINS)
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, mcp-session-id");
        res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");
      }
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
      next();
    });

    // Bearer auth on /mcp when a token is configured (timing-safe compare)
    app.use("/mcp", (req, res, next) => {
      if (!authToken) {
        next();
        return;
      }
      const header = req.headers.authorization || "";
      const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
      const a = createHash("sha256").update(presented).digest();
      const b = createHash("sha256").update(authToken).digest();
      if (!presented || !timingSafeEqual(a, b)) {
        res.status(401).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized" },
          id: null,
        });
        return;
      }
      next();
    });

    // Helper: create a fresh MCP server with all tools registered
    function createMcpServer(): Server {
      const s = new Server(
        { name: "discord-claude-full-mcp", version: "0.1.0" },
        { capabilities: { tools: {} } }
      );
      s.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: elevenReady ? [...baseTools, voiceTool] : baseTools,
      }));
      s.setRequestHandler(CallToolRequestSchema, toolHandler);
      return s;
    }

    // Stateless mode: new transport + server per request
    app.post("/mcp", async (req, res) => {
      try {
        const mcpServer = createMcpServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        res.on("close", () => {
          transport.close();
          mcpServer.close();
        });
        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (e) {
        console.error("[mcp] Error handling request:", e);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });

    app.get("/mcp", (_req, res) => {
      res.writeHead(405).end("Method Not Allowed — use POST");
    });

    app.delete("/mcp", (_req, res) => {
      res.writeHead(405).end("Method Not Allowed");
    });

    app.get("/health", (_req, res) => {
      res.json({
        status: "ok",
        discord: client.user?.tag || "not logged in",
        elevenlabs: elevenReady ? "ready" : "disabled",
      });
    });

    app.listen(port, host, () => {
      console.error(`[mcp] discord-claude-full-mcp running on Streamable HTTP: http://${host}:${port}/mcp`);
      console.error(`[mcp] health check: http://${host}:${port}/health`);
      console.error(`[mcp] auth: ${authToken ? "bearer token required" : "none"}`);
    });
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp] discord-claude-full-mcp running on stdio");
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
