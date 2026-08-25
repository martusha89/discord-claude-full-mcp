import type { ElevenLabsConfig } from "../config.js";
const ELEVENLABS_API = "https://api.elevenlabs.io/v1";
export async function textToSpeechMp3(opts: { apiKey: string; cfg: ElevenLabsConfig; text: string; timeoutMs: number; maxBytes: number }): Promise<Buffer> {
  if (!opts.cfg.voiceId) throw new Error("ElevenLabs voiceId is not configured");
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await fetch(`${ELEVENLABS_API}/text-to-speech/${encodeURIComponent(opts.cfg.voiceId)}?output_format=mp3_44100_128`, {
      method: "POST", signal: controller.signal,
      headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: opts.text, model_id: opts.cfg.modelId, voice_settings: { stability: opts.cfg.stability,
        similarity_boost: opts.cfg.similarityBoost, style: opts.cfg.style, use_speaker_boost: opts.cfg.useSpeakerBoost } }),
    });
    if (!response.ok) throw new Error(`ElevenLabs request failed with HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > opts.maxBytes) throw new Error("ElevenLabs response exceeds configured byte limit");
    const data = Buffer.from(await response.arrayBuffer()); if (data.length > opts.maxBytes) throw new Error("ElevenLabs response exceeds configured byte limit"); return data;
  } catch (error) { if (error instanceof Error && error.name === "AbortError") throw new Error("ElevenLabs request timed out"); throw error; }
  finally { clearTimeout(timer); }
}
