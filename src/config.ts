import dotenv from "dotenv";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the project root from this file's location so we work no matter
// what cwd the MCP host (Claude Desktop, Claude Code, custom hosts) launches us from.
const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), "..");

dotenv.config({ path: join(PROJECT_ROOT, ".env") });

export interface ElevenLabsConfig {
  voiceId: string;
  modelId: string;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
}

export interface FileConfig {
  elevenlabs?: Partial<ElevenLabsConfig>;
  defaults?: { guildId?: string };
}

export type PrivacyMode = "metadata" | "redacted" | "full";

export interface RuntimeConfig {
  discordToken: string;
  elevenLabsApiKey: string | null;
  elevenlabs: ElevenLabsConfig;
  defaults: { guildId?: string };
  privacy: {
    mode: PrivacyMode;
    aliasKey: string;
    includeImages: boolean;
    maxImageContextBytes: number;
    maxImagePixels: number;
    imageReadTimeoutMs: number;
  };
  attachments: {
    allowedFileRoots: string[];
    maxBytes: number;
  };
}

const DEFAULTS: ElevenLabsConfig = {
  voiceId: "",
  modelId: "eleven_turbo_v2_5",
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.0,
  useSpeakerBoost: true,
};

function loadConfigFile(): FileConfig {
  const candidates = [
    join(PROJECT_ROOT, "config.json"),
    join(PROJECT_ROOT, "config.example.json"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        return JSON.parse(readFileSync(path, "utf-8")) as FileConfig;
      } catch (err) {
        console.error(`[config] Failed to parse ${path}:`, err);
      }
    }
  }
  return {};
}

export function loadConfig(): RuntimeConfig {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error(
      "DISCORD_TOKEN is not set. Copy .env.example to .env and fill it in."
    );
  }

  const file = loadConfigFile();
  const merged: ElevenLabsConfig = { ...DEFAULTS, ...(file.elevenlabs ?? {}) };

  // Installed from npm, the package lives inside node_modules and there is
  // nowhere sensible to drop a config.json, so env vars must be able to carry
  // everything a user actually needs to set. They win over the file.
  const envVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  if (envVoiceId) merged.voiceId = envVoiceId;

  const envModelId = process.env.ELEVENLABS_MODEL_ID?.trim();
  if (envModelId) merged.modelId = envModelId;

  const defaults = { ...(file.defaults ?? {}) };
  const envGuildId = process.env.DISCORD_DEFAULT_GUILD_ID?.trim();
  if (envGuildId) defaults.guildId = envGuildId;

  const privacyMode = (process.env.DISCORD_PRIVACY_MODE?.trim().toLowerCase() ||
    "redacted") as PrivacyMode;
  if (!["metadata", "redacted", "full"].includes(privacyMode)) {
    throw new Error(
      "DISCORD_PRIVACY_MODE must be one of: metadata, redacted, full"
    );
  }

  const maxAttachmentBytes = Number.parseInt(
    process.env.DISCORD_MAX_ATTACHMENT_BYTES || String(25 * 1024 * 1024),
    10
  );
  if (!Number.isSafeInteger(maxAttachmentBytes) || maxAttachmentBytes <= 0) {
    throw new Error("DISCORD_MAX_ATTACHMENT_BYTES must be a positive integer");
  }

  const allowedFileRoots = (process.env.DISCORD_ALLOWED_FILE_ROOTS || "")
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean);

  const includeImagesValue = (process.env.DISCORD_INCLUDE_IMAGES || "true")
    .trim()
    .toLowerCase();
  if (!["1", "true", "yes", "on", "0", "false", "no", "off"].includes(includeImagesValue)) {
    throw new Error(
      "DISCORD_INCLUDE_IMAGES must be true/false, yes/no, on/off, or 1/0"
    );
  }
  const includeImages = ["1", "true", "yes", "on"].includes(includeImagesValue);
  const maxImageContextBytes = Number.parseInt(
    process.env.DISCORD_MAX_IMAGE_CONTEXT_BYTES || String(25 * 1024 * 1024),
    10
  );
  if (!Number.isSafeInteger(maxImageContextBytes) || maxImageContextBytes <= 0) {
    throw new Error("DISCORD_MAX_IMAGE_CONTEXT_BYTES must be a positive integer");
  }
  const maxImagePixels = Number.parseInt(
    process.env.DISCORD_MAX_IMAGE_PIXELS || "40000000",
    10
  );
  if (!Number.isSafeInteger(maxImagePixels) || maxImagePixels <= 0) {
    throw new Error("DISCORD_MAX_IMAGE_PIXELS must be a positive integer");
  }
  const imageReadTimeoutMs = Number.parseInt(
    process.env.DISCORD_IMAGE_READ_TIMEOUT_MS || "30000",
    10
  );
  if (!Number.isSafeInteger(imageReadTimeoutMs) || imageReadTimeoutMs <= 0) {
    throw new Error("DISCORD_IMAGE_READ_TIMEOUT_MS must be a positive integer");
  }

  return {
    discordToken: token,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() || null,
    elevenlabs: merged,
    defaults,
    privacy: {
      mode: privacyMode,
      // Deriving the default from the bot token keeps aliases stable between
      // restarts without persisting Discord user IDs or adding another secret.
      // Operators can provide a separate key if aliases must survive rotation.
      aliasKey:
        process.env.DISCORD_PRIVACY_ALIAS_KEY?.trim() ||
        `discord-bridge:${token}`,
      includeImages,
      maxImageContextBytes,
      maxImagePixels,
      imageReadTimeoutMs,
    },
    attachments: {
      allowedFileRoots,
      maxBytes: maxAttachmentBytes,
    },
  };
}

export function isElevenLabsReady(cfg: RuntimeConfig): boolean {
  return Boolean(cfg.elevenLabsApiKey && cfg.elevenlabs.voiceId);
}
