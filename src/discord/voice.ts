import { spawn } from "node:child_process";
import { Routes } from "discord.js";
import ffmpegPath from "ffmpeg-static";
import { findChannel, getClient } from "./client.js";
import { textToSpeechMp3 } from "../elevenlabs/tts.js";
import type { ElevenLabsConfig, LimitsConfig } from "../config.js";

const FFMPEG = (ffmpegPath as unknown as string) || "ffmpeg";
const IS_VOICE_MESSAGE = 1 << 13;

class Semaphore {
  private active = 0; private readonly waiting: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active++;
    try { return await fn(); } finally { this.active--; this.waiting.shift()?.(); }
  }
}
let semaphore: Semaphore | undefined; let semaphoreLimit = 0;
function voiceLimiter(limit: number): Semaphore { if (!semaphore || semaphoreLimit !== limit) { semaphore = new Semaphore(limit); semaphoreLimit = limit; } return semaphore; }

function runFfmpeg(input: Buffer, args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...args, "pipe:1"], { windowsHide: true });
    const chunks: Buffer[] = []; const errs: Buffer[] = []; let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; proc.kill(); reject(new Error("ffmpeg timed out")); } }, timeoutMs);
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk)); proc.stderr.on("data", (chunk: Buffer) => errs.push(chunk));
    proc.on("error", error => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
    proc.on("close", code => { if (settled) return; settled = true; clearTimeout(timer);
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg failed with exit code ${code}: ${Buffer.concat(errs).toString().slice(0, 200)}`)); });
    proc.stdin.end(input);
  });
}
function buildWaveform(pcm: Buffer, sampleRate: number): { waveform: string; durationSecs: number } {
  const sampleCount = Math.floor(pcm.length / 2); const durationSecs = sampleCount / sampleRate; const targetBytes = 256;
  const samplesPerSlice = Math.max(1, Math.floor(sampleCount / targetBytes)); const peaks = new Float32Array(targetBytes); let max = 1;
  for (let i = 0; i < targetBytes; i++) { for (let j = i * samplesPerSlice; j < Math.min((i + 1) * samplesPerSlice, sampleCount); j++) peaks[i] = Math.max(peaks[i], Math.abs(pcm.readInt16LE(j * 2))); max = Math.max(max, peaks[i]); }
  const bytes = Buffer.alloc(targetBytes); for (let i = 0; i < targetBytes; i++) bytes[i] = Math.min(255, Math.round(peaks[i] / max * 255));
  return { waveform: bytes.toString("base64"), durationSecs };
}
export async function sendVoiceNote(opts: { apiKey: string; cfg: ElevenLabsConfig; limits: LimitsConfig; server?: string; channel: string; text: string; fallbackGuildId?: string }) {
  if (opts.text.length > opts.limits.ttsChars) throw new Error(`Voice text exceeds configured ${opts.limits.ttsChars} character limit`);
  return voiceLimiter(opts.limits.voiceConcurrency).run(async () => {
    const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
    const mp3 = await textToSpeechMp3({ apiKey: opts.apiKey, cfg: opts.cfg, text: opts.text, timeoutMs: opts.limits.elevenLabsTimeoutMs, maxBytes: opts.limits.attachmentBytes });
    const [ogg, pcm] = await Promise.all([
      runFfmpeg(mp3, ["-c:a", "libopus", "-b:a", "64k", "-ac", "1", "-ar", "48000", "-f", "ogg"], opts.limits.ffmpegTimeoutMs),
      runFfmpeg(mp3, ["-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000"], opts.limits.ffmpegTimeoutMs),
    ]);
    if (ogg.length > opts.limits.attachmentBytes) throw new Error("Generated voice attachment exceeds configured byte limit");
    const { waveform, durationSecs } = buildWaveform(pcm, 16000);
    const result = await getClient().rest.post(Routes.channelMessages(channel.id), { body: { flags: IS_VOICE_MESSAGE,
      allowed_mentions: { parse: [] }, attachments: [{ id: "0", filename: "voice-message.ogg", duration_secs: durationSecs, waveform }] },
      files: [{ name: "voice-message.ogg", data: ogg, contentType: "audio/ogg" }] }) as { id?: string };
    return { id: result.id ?? null, durationSecs };
  });
}
