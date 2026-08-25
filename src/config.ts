import dotenv from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: join(PROJECT_ROOT, ".env") });

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord snowflake");
const nonNegativeInt = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

const fileSchema = z.object({
  elevenlabs: z.object({
    voiceId: z.string().default(""),
    modelId: z.string().default("eleven_turbo_v2_5"),
    stability: z.number().min(0).max(1).default(0.5),
    similarityBoost: z.number().min(0).max(1).default(0.75),
    style: z.number().min(0).max(1).default(0),
    useSpeakerBoost: z.boolean().default(true),
  }).partial().optional(),
  defaults: z.object({ guildId: z.union([snowflake, z.literal("")]).optional() }).optional(),
  policy: z.object({
    allowedGuildIds: z.array(snowflake).default([]),
    allowedChannelIds: z.array(snowflake).default([]),
    allowedDmUserIds: z.array(snowflake).default([]),
    allowLocalFiles: z.boolean().default(false),
    allowedLocalRoots: z.array(z.string().min(1)).default([]),
  }).partial().optional(),
  limits: z.object({
    messageChars: positiveInt.default(2000),
    ttsChars: positiveInt.default(2000),
    attachmentBytes: positiveInt.default(8 * 1024 * 1024),
    attachmentTimeoutMs: positiveInt.default(15000),
    elevenLabsTimeoutMs: positiveInt.default(30000),
    ffmpegTimeoutMs: positiveInt.default(30000),
    voiceConcurrency: positiveInt.max(8).default(2),
    typingDelayMinMs: nonNegativeInt.default(0),
    typingDelayMaxMs: nonNegativeInt.default(0),
  }).partial().optional(),
}).strict();

export interface ElevenLabsConfig {
  voiceId: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
}
export interface AccessPolicy {
  allowedGuildIds: string[];
  allowedChannelIds: string[];
  allowedDmUserIds: string[];
  allowLocalFiles: boolean;
  allowedLocalRoots: string[];
  remoteMode: boolean;
}
export interface LimitsConfig {
  messageChars: number;
  ttsChars: number;
  attachmentBytes: number;
  attachmentTimeoutMs: number;
  elevenLabsTimeoutMs: number;
  ffmpegTimeoutMs: number;
  voiceConcurrency: number;
  typingDelayMinMs: number;
  typingDelayMaxMs: number;
}
export interface RuntimeConfig {
  discordToken: string;
  elevenLabsApiKey: string | null;
  elevenlabs: ElevenLabsConfig;
  defaults: { guildId?: string };
  policy: AccessPolicy;
  limits: LimitsConfig;
  transport: "stdio" | "http";
  http: {
    host: string;
    port: number;
    bearerToken: string | null;
    allowedOrigins: string[];
    jsonLimitBytes: number;
    rateLimitPerMinute: number;
  };
}

const ELEVEN_DEFAULTS: ElevenLabsConfig = {
  voiceId: "", modelId: "eleven_turbo_v2_5", stability: 0.5,
  similarityBoost: 0.75, style: 0, useSpeakerBoost: true,
};
const LIMIT_DEFAULTS: LimitsConfig = {
  messageChars: 2000, ttsChars: 2000, attachmentBytes: 8 * 1024 * 1024,
  attachmentTimeoutMs: 15000, elevenLabsTimeoutMs: 30000, ffmpegTimeoutMs: 30000,
  voiceConcurrency: 2, typingDelayMinMs: 0, typingDelayMaxMs: 0,
};

function parseInteger(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const result = Number(value);
  if (result < min || result > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return result;
}

export function normalizeTransport(value: string | undefined): "stdio" | "http" {
  const mode = (value ?? "stdio").trim().toLowerCase();
  if (mode === "sse") {
    console.error("[config] MCP_TRANSPORT=sse is deprecated; use streamable-http");
    return "http";
  }
  if (mode === "http" || mode === "streamable-http") return "http";
  if (mode === "stdio") return "stdio";
  throw new Error("MCP_TRANSPORT must be stdio, http, or streamable-http (sse is a deprecated alias)");
}

function loadConfigFile(): unknown {
  const path = process.env.MCP_CONFIG_PATH ? resolve(process.env.MCP_CONFIG_PATH) : join(PROJECT_ROOT, "config.json");
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new Error(`Configuration file is not valid JSON: ${path}`); }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const discordToken = env.DISCORD_TOKEN?.trim();
  if (!discordToken) throw new Error("DISCORD_TOKEN is required");
  const parsed = fileSchema.safeParse(loadConfigFile());
  if (!parsed.success) throw new Error(`Invalid config.json: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const file = parsed.data;
  const transport = normalizeTransport(env.MCP_TRANSPORT);
  const allowedOrigins = (env.MCP_ALLOWED_ORIGINS ?? "").split(",").map(v => v.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    if (origin === "*" || new URL(origin).origin !== origin) throw new Error("MCP_ALLOWED_ORIGINS must contain exact http(s) origins and cannot use *");
  }
  const bearerToken = env.MCP_HTTP_BEARER_TOKEN?.trim() || null;
  if (transport === "http" && (!bearerToken || bearerToken.length < 24)) {
    throw new Error("MCP_HTTP_BEARER_TOKEN is required in HTTP mode and must be at least 24 characters");
  }
  const guilds = file.policy?.allowedGuildIds ?? [];
  const channels = file.policy?.allowedChannelIds ?? [];
  const dms = file.policy?.allowedDmUserIds ?? [];
  if (transport === "http" && guilds.length === 0 && channels.length === 0 && dms.length === 0) {
    throw new Error("HTTP mode requires an explicit policy allowlist in config.json");
  }
  const roots = (file.policy?.allowedLocalRoots ?? []).map(root => resolve(PROJECT_ROOT, root));
  const allowLocalFiles = file.policy?.allowLocalFiles ?? false;
  if (allowLocalFiles && roots.length === 0) throw new Error("policy.allowedLocalRoots is required when allowLocalFiles is true");
  return {
    discordToken,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY?.trim() || null,
    elevenlabs: { ...ELEVEN_DEFAULTS, ...file.elevenlabs },
    defaults: { guildId: file.defaults?.guildId || undefined },
    policy: {
      allowedGuildIds: guilds,
      allowedChannelIds: channels,
      allowedDmUserIds: dms,
      allowLocalFiles,
      allowedLocalRoots: roots,
      remoteMode: transport === "http",
    },
    limits: { ...LIMIT_DEFAULTS, ...file.limits },
    transport,
    http: {
      host: env.MCP_HOST?.trim() || "127.0.0.1",
      port: parseInteger("MCP_PORT", env.MCP_PORT, 3001, 1, 65535),
      bearerToken,
      allowedOrigins,
      jsonLimitBytes: parseInteger("MCP_JSON_LIMIT_BYTES", env.MCP_JSON_LIMIT_BYTES, 1024 * 1024, 1024, 4 * 1024 * 1024),
      rateLimitPerMinute: parseInteger("MCP_RATE_LIMIT_PER_MINUTE", env.MCP_RATE_LIMIT_PER_MINUTE, 60, 1, 10000),
    },
  };
}

export function isElevenLabsReady(cfg: RuntimeConfig): boolean {
  return Boolean(cfg.elevenLabsApiKey && cfg.elevenlabs.voiceId);
}
