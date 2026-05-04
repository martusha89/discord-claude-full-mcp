import { ElevenLabsConfig } from "../config.js";

const ELEVENLABS_API = "https://api.elevenlabs.io/v1";

export async function textToSpeechMp3(opts: {
  apiKey: string;
  cfg: ElevenLabsConfig;
  text: string;
}): Promise<Buffer> {
  if (!opts.cfg.voiceId) {
    throw new Error("ElevenLabs voiceId is not configured (config.json)");
  }
  const url = `${ELEVENLABS_API}/text-to-speech/${opts.cfg.voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": opts.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: opts.cfg.modelId,
      voice_settings: {
        stability: opts.cfg.stability,
        similarity_boost: opts.cfg.similarityBoost,
        style: opts.cfg.style,
        use_speaker_boost: opts.cfg.useSpeakerBoost,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
