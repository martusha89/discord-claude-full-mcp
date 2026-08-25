import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import type { Server as HttpServer } from "node:http";
import { loadConfig, isElevenLabsReady } from "./config.js";
import { createClient } from "./discord/client.js";
import { sendMessage, readMessages, editMessage, deleteMessage, reactToMessage, setTyping, sendDirectMessage } from "./discord/messages.js";
import { sendImage, sendFile } from "./discord/attachments.js";
import { listEmojis, resolveEmojiPlaceholders } from "./discord/emojis.js";
import { listStickers, sendSticker } from "./discord/stickers.js";
import { listServers, listChannels, setStatus } from "./discord/meta.js";
import { sendVoiceNote } from "./discord/voice.js";
import { fixedWindowRateLimit, httpSecurity } from "./http-security.js";

const cfg = loadConfig();
const fallbackGuildId = cfg.defaults.guildId;
const elevenReady = isElevenLabsReady(cfg);
const client = createClient(cfg.policy);
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
    description: "Add a reaction to a message. Use a Unicode emoji or server emoji in `<:name:id>` form.",
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


function ok(text: string) { return { content: [{ type: "text" as const, text }] }; }
function fail(text: string) { return { content: [{ type: "text" as const, text: `Error: ${text}` }], isError: true }; }
function publicError(error: unknown): string {
  if (!(error instanceof Error)) return "Request failed";
  if (error.name === "PolicyError") return error.message;
  const safe = ["not allowed", "not found", "disabled", "limit", "exceeds", "timed out", "ambiguous", "required", "configured", "selected server"];
  return safe.some(term => error.message.toLowerCase().includes(term)) ? error.message : "Discord operation failed";
}

const toolHandler = async (req: { params: { name: string; arguments?: Record<string, unknown> } }) => {
  const { name, arguments: args = {} } = req.params; const a = args as Record<string, any>;
  try {
    switch (name) {
      case "send_message": { const content = await resolveEmojiPlaceholders(String(a.message), a.server, fallbackGuildId); const r = await sendMessage({ server: a.server, channel: a.channel, content, replyToMessageId: a.replyToMessageId, fallbackGuildId, limits: cfg.limits }); return ok(`Sent (id: ${r.id})`); }
      case "read_messages": return ok(JSON.stringify(await readMessages({ server: a.server, channel: a.channel, limit: a.limit, fallbackGuildId }), null, 2));
      case "edit_message": return ok(`Edited ${(await editMessage({ server: a.server, channel: a.channel, messageId: a.messageId, content: a.content, fallbackGuildId, limits: cfg.limits })).id}`);
      case "delete_message": await deleteMessage({ server: a.server, channel: a.channel, messageId: a.messageId, fallbackGuildId }); return ok("Deleted message");
      case "react_to_message": await reactToMessage({ server: a.server, channel: a.channel, messageId: a.messageId, emoji: a.emoji, fallbackGuildId }); return ok("Reaction added");
      case "set_typing": await setTyping({ server: a.server, channel: a.channel, fallbackGuildId }); return ok("Typing indicator sent");
      case "send_image": case "send_file": { const fn = name === "send_image" ? sendImage : sendFile; const r = await fn({ server: a.server, channel: a.channel, source: a.source, caption: a.caption, filename: a.filename, fallbackGuildId, policy: cfg.policy, limits: cfg.limits, remoteMode: cfg.transport === "http" }); return ok(`Sent attachment (id: ${r.id})`); }
      case "send_sticker": return ok(`Sent sticker (id: ${(await sendSticker({ server: a.server, channel: a.channel, stickerId: a.stickerId, content: a.content, fallbackGuildId })).id})`);
      case "list_servers": return ok(JSON.stringify(await listServers(), null, 2));
      case "list_channels": return ok(JSON.stringify(await listChannels({ server: a.server, fallbackGuildId }), null, 2));
      case "list_emojis": return ok(JSON.stringify(await listEmojis({ server: a.server, fallbackGuildId }), null, 2));
      case "list_stickers": return ok(JSON.stringify(await listStickers({ server: a.server, fallbackGuildId }), null, 2));
      case "set_status": await setStatus(a); return ok("Status updated");
      case "send_direct_message": { const r = await sendDirectMessage({ userId: a.userId, content: a.message, limits: cfg.limits }); return ok(`DM sent (id: ${r.id})`); }
      case "send_voice_note": { if (!elevenReady) return fail("ElevenLabs is not configured"); const r = await sendVoiceNote({ apiKey: cfg.elevenLabsApiKey!, cfg: cfg.elevenlabs, limits: cfg.limits, server: a.server, channel: a.channel, text: a.text, fallbackGuildId }); return ok(`Voice note sent (id: ${r.id}, ${r.durationSecs.toFixed(1)}s)`); }
      default: return fail("Unknown tool");
    }
  } catch (error) { console.error("[tool] request failed:", error); return fail(publicError(error)); }
};

function createMcpServer(): Server {
  const server = new Server({ name: "discord-claude-full-mcp", version: "0.2.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: elevenReady ? [...baseTools, voiceTool] : baseTools }));
  server.setRequestHandler(CallToolRequestSchema, toolHandler);
  return server;
}

let httpServer: HttpServer | undefined; let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; shuttingDown = true; console.error(`[shutdown] ${signal}`);
  await new Promise<void>(resolve => httpServer ? httpServer.close(() => resolve()) : resolve());
  client.destroy(); process.exitCode = 0;
}
process.once("SIGINT", () => void shutdown("SIGINT")); process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function main() {
  await client.login(cfg.discordToken);
  if (cfg.transport === "stdio") { await createMcpServer().connect(new StdioServerTransport()); console.error("[mcp] running on stdio"); return; }
  const app = express(); app.disable("x-powered-by");
  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
  app.get("/ready", (_req, res) => client.isReady() && !shuttingDown ? res.status(200).json({ status: "ready" }) : res.status(503).json({ status: "not_ready" }));
  app.use("/mcp", fixedWindowRateLimit(cfg.http.rateLimitPerMinute));
  app.use("/mcp", httpSecurity(cfg.http.allowedOrigins, cfg.http.bearerToken!));
  app.use("/mcp", express.json({ limit: cfg.http.jsonLimitBytes, strict: true, type: ["application/json", "application/*+json"] }));
  app.post("/mcp", async (req, res) => { const mcp = createMcpServer(); const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { void transport.close(); void mcp.close(); });
    try { await mcp.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { console.error("[mcp] request failed:", error); if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null }); }
  });
  app.all("/mcp", (_req, res) => res.status(405).json({ error: "method_not_allowed" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error("[http] rejected request:", error); res.status(400).json({ error: "invalid_request" }); });
  httpServer = app.listen(cfg.http.port, cfg.http.host, () => console.error(`[mcp] Streamable HTTP listening on http://${cfg.http.host}:${cfg.http.port}/mcp`));
}
main().catch(error => { console.error("Fatal:", error instanceof Error ? error.message : "Startup failed"); client.destroy(); process.exitCode = 1; });
