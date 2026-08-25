import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const FFMPEG = (ffmpegPath as unknown as string) || "ffmpeg";

/** Decode one frame so magic bytes alone cannot masquerade as model image input. */
export function validateDecodableImage(
  data: Buffer,
  maxPixels: number,
  timeoutMs = 10_000
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      FFMPEG,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-max_pixels",
        String(maxPixels),
        "-i",
        "pipe:0",
        "-frames:v",
        "1",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true }
    );
    const errors: Buffer[] = [];
    let errorBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      proc.kill();
      if (!settled) {
        settled = true;
        reject(new Error("Image decode validation timed out."));
      }
    }, timeoutMs);

    proc.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes >= 4_096) return;
      const remaining = 4_096 - errorBytes;
      const kept = chunk.subarray(0, remaining);
      errors.push(kept);
      errorBytes += kept.length;
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const detail = Buffer.concat(errors).toString("utf8").trim();
      reject(
        new Error(
          detail
            ? `Image could not be decoded safely: ${detail.slice(0, 240)}`
            : "Image could not be decoded safely."
        )
      );
    });
    // EPIPE is expected when ffmpeg rejects malformed input early; close handles it.
    proc.stdin.on("error", () => undefined);
    proc.stdin.end(data);
  });
}
