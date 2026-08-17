import { copyFile, writeFile } from 'node:fs/promises';

export type TtsAudioSource =
  | { kind: 'base64'; data: string }
  | { kind: 'path'; path: string }
  | { kind: 'missing'; reason: string };

/**
 * Edge writes a file and returns `mediaPath` / `audioRef` as a path.
 * Gemini/Kokoro return a data URI on `audioRef`. Never treat an empty
 * text completion as audio.
 */
export function resolveTtsAudioSource(audioRef: unknown, output: unknown): TtsAudioSource {
  if (typeof audioRef === 'string' && audioRef.trim()) {
    const b64Match = audioRef.trim().match(/^data:[^;]*;base64,(.+)$/);
    if (b64Match?.[1]) return { kind: 'base64', data: b64Match[1] };
    return { kind: 'path', path: audioRef.trim() };
  }
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const mediaPath = (output as { mediaPath?: unknown }).mediaPath;
    if (typeof mediaPath === 'string' && mediaPath.trim()) {
      return { kind: 'path', path: mediaPath.trim() };
    }
  }
  if (typeof output === 'string' && output.length > 0) {
    return { kind: 'base64', data: output };
  }
  return {
    kind: 'missing',
    reason: 'TTS provider returned no audio (missing audioRef and mediaPath)',
  };
}

export async function writeTtsAudioRef(
  audioRef: unknown,
  output: unknown,
  destPath: string,
): Promise<void> {
  const src = resolveTtsAudioSource(audioRef, output);
  if (src.kind === 'missing') throw new Error(src.reason);
  if (src.kind === 'base64') {
    await writeFile(destPath, Buffer.from(src.data, 'base64'));
    return;
  }
  if (src.path === destPath) return;
  await copyFile(src.path, destPath);
}
