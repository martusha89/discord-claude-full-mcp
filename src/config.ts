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

  return {
    discordToken: token,
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY?.trim() || null,
    elevenlabs: merged,
    defaults: file.defaults ?? {},
  };
}

export function isElevenLabsReady(cfg: RuntimeConfig): boolean {
  return Boolean(cfg.elevenLabsApiKey && cfg.elevenlabs.voiceId);
}
