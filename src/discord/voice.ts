import { spawn } from "node:child_process";
import { Routes } from "discord.js";
import ffmpegPath from "ffmpeg-static";
import { findChannel, getClient } from "./client.js";
import { textToSpeechMp3 } from "../elevenlabs/tts.js";
import { ElevenLabsConfig } from "../config.js";

const FFMPEG = (ffmpegPath as unknown as string) || "ffmpeg";

const IS_VOICE_MESSAGE = 1 << 13; // 8192

function runFfmpeg(input: Buffer, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", ...args, "pipe:1"]);
    const chunks: Buffer[] = [];
    const errs: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => errs.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(errs).toString().slice(0, 300)}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function transcodeToOggOpus(mp3: Buffer): Promise<Buffer> {
  return runFfmpeg(mp3, ["-c:a", "libopus", "-b:a", "64k", "-ac", "1", "-ar", "48000", "-f", "ogg"]);
}

async function extractPcmMono(mp3: Buffer): Promise<{ pcm: Buffer; sampleRate: number }> {
  const sampleRate = 16000;
  const pcm = await runFfmpeg(mp3, ["-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(sampleRate)]);
  return { pcm, sampleRate };
}

function buildWaveform(pcm: Buffer, sampleRate: number): { waveform: string; durationSecs: number } {
  const sampleCount = pcm.length / 2;
  const durationSecs = sampleCount / sampleRate;

  const targetBytes = 256;
  const samplesPerSlice = Math.max(1, Math.floor(sampleCount / targetBytes));

  let peakOverall = 1;
  const peaks = new Float32Array(targetBytes);

  for (let i = 0; i < targetBytes; i++) {
    const start = i * samplesPerSlice;
    const end = Math.min(start + samplesPerSlice, sampleCount);
    let peak = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(pcm.readInt16LE(j * 2));
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
    if (peak > peakOverall) peakOverall = peak;
  }

  const waveformBytes = Buffer.alloc(targetBytes);
  for (let i = 0; i < targetBytes; i++) {
    waveformBytes[i] = Math.min(255, Math.round((peaks[i] / peakOverall) * 255));
  }

  return {
    waveform: waveformBytes.toString("base64"),
    durationSecs,
  };
}

export async function sendVoiceNote(opts: {
  apiKey: string;
  cfg: ElevenLabsConfig;
  server?: string;
  channel: string;
  text: string;
  fallbackGuildId?: string;
}) {
  const channel = await findChannel(opts.channel, opts.server, opts.fallbackGuildId);
  if ("sendTyping" in channel) {
    await channel.sendTyping().catch(() => null);
  }

  const mp3 = await textToSpeechMp3({ apiKey: opts.apiKey, cfg: opts.cfg, text: opts.text });
  const [ogg, pcmInfo] = await Promise.all([transcodeToOggOpus(mp3), extractPcmMono(mp3)]);
  const { waveform, durationSecs } = buildWaveform(pcmInfo.pcm, pcmInfo.sampleRate);

  const client = getClient();
  const result: any = await client.rest.post(Routes.channelMessages(channel.id), {
    body: {
      flags: IS_VOICE_MESSAGE,
      attachments: [
        {
          id: "0",
          filename: "voice-message.ogg",
          duration_secs: durationSecs,
          waveform,
        },
      ],
    },
    files: [{ name: "voice-message.ogg", data: ogg, contentType: "audio/ogg" }],
  });

  return { id: result?.id ?? null, durationSecs };
}
