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

export interface RuntimeConfig {
  discordToken: string;
  elevenLabsApiKey: string | null;
  elevenlabs: ElevenLabsConfig;
  defaults: { guildId?: string };
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

  return {
    discordToken: token,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() || null,
    elevenlabs: merged,
    defaults,
  };
}

export function isElevenLabsReady(cfg: RuntimeConfig): boolean {
  return Boolean(cfg.elevenLabsApiKey && cfg.elevenlabs.voiceId);
}
