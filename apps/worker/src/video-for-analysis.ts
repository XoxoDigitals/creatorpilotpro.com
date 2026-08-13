/**
 * Prepare multimodal input for VIDEO_ANALYSIS so the model effectively
 * "watches" as much of the clip as practical:
 *
 *  1. Inline base64 when ≤ ~13 MB (fast path).
 *  2. Gemini Files API upload when larger (full video URI).
 *  3. Evenly spaced JPEG frame samples when upload fails / file is huge.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  uploadGeminiFile,
  deleteGeminiFile,
  type AIInput,
} from '@scp/ai-providers';
import { Ffmpeg } from './media/ffmpeg.js';

/** Cap for Gemini inline_data (~20 MB after base64 expansion). */
export const MAX_INLINE_VIDEO_BYTES = 13 * 1024 * 1024;
/** Practical Files API upload ceiling for short-form worker jobs. */
export const MAX_FILES_API_VIDEO_BYTES = 100 * 1024 * 1024;
/** Max stills when falling back to frame sampling. */
const MAX_SAMPLE_FRAMES = 24;

export type AnalysisMediaMode = 'inline' | 'files_api' | 'frames' | 'metadata_only';

export interface PreparedAnalysisMedia {
  mode: AnalysisMediaMode;
  /** Multimodal parts to attach (may be empty for metadata_only). */
  parts: NonNullable<Extract<AIInput, { kind: 'multimodal' }>['parts']>;
  /** Cleanup Gemini file / temp frames after the model call. */
  cleanup: () => Promise<void>;
  detail?: Record<string, unknown>;
}

export async function prepareAnalysisMedia(opts: {
  videoPath: string;
  sizeBytes: number;
  durationSec: number | null;
  /** Gemini API key for Files API (required for large uploads). */
  apiKey: string | null;
  contentItemId: string;
}): Promise<PreparedAnalysisMedia> {
  const { videoPath, sizeBytes, apiKey, contentItemId } = opts;
  let durationSec = opts.durationSec;

  if (sizeBytes <= MAX_INLINE_VIDEO_BYTES) {
    const buf = await readFile(videoPath);
    return {
      mode: 'inline',
      parts: [{ data: buf.toString('base64'), mimeType: 'video/mp4' }],
      cleanup: async () => {},
      detail: { sizeBytes, mode: 'inline' },
    };
  }

  if (apiKey && sizeBytes <= MAX_FILES_API_VIDEO_BYTES) {
    try {
      const uploaded = await uploadGeminiFile({
        apiKey,
        filePath: videoPath,
        mimeType: 'video/mp4',
        displayName: `scp-${contentItemId}`,
      });
      return {
        mode: 'files_api',
        parts: [{ uri: uploaded.uri, mimeType: uploaded.mimeType }],
        cleanup: async () => {
          await deleteGeminiFile({ apiKey, name: uploaded.name });
        },
        detail: { sizeBytes, mode: 'files_api', fileName: uploaded.name },
      };
    } catch (err) {
      // Fall through to frame sampling.
      console.warn(
        `[worker:ai] Files API upload failed for ${contentItemId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const frames = await sampleTimelineFrames(videoPath, durationSec);
  if (frames.parts.length > 0) {
    return {
      mode: 'frames',
      parts: frames.parts,
      cleanup: frames.cleanup,
      detail: {
        sizeBytes,
        mode: 'frames',
        frameCount: frames.parts.length,
        durationSec: frames.durationSec,
        reason:
          sizeBytes > MAX_FILES_API_VIDEO_BYTES
            ? 'video_exceeds_files_api_cap'
            : 'files_api_unavailable_or_failed',
      },
    };
  }

  return {
    mode: 'metadata_only',
    parts: [],
    cleanup: async () => {},
    detail: { sizeBytes, mode: 'metadata_only' },
  };
}

async function sampleTimelineFrames(
  videoPath: string,
  durationSecHint: number | null,
): Promise<{
  parts: NonNullable<Extract<AIInput, { kind: 'multimodal' }>['parts']>;
  cleanup: () => Promise<void>;
  durationSec: number | null;
}> {
  const ffmpeg = new Ffmpeg();
  if (!(await ffmpeg.available())) {
    return { parts: [], cleanup: async () => {}, durationSec: durationSecHint };
  }

  let durationSec = durationSecHint;
  if (durationSec == null || !(durationSec > 0)) {
    durationSec = await ffmpeg.probeDurationSec(videoPath);
  }
  if (durationSec == null || !(durationSec > 0)) {
    // Still try a single mid-ish frame.
    durationSec = 1;
  }

  const frameCount = Math.min(
    MAX_SAMPLE_FRAMES,
    Math.max(4, Math.ceil(durationSec / 2.5)),
  );
  const dir = await mkdtemp(join(tmpdir(), 'scp-analyze-frames-'));
  const parts: NonNullable<Extract<AIInput, { kind: 'multimodal' }>['parts']> = [];

  for (let i = 0; i < frameCount; i++) {
    // Spread across (0, duration) — avoid exact 0/end which can be black frames.
    const t =
      frameCount === 1
        ? Math.min(0.5, durationSec * 0.5)
        : (durationSec * (i + 0.5)) / frameCount;
    const dest = join(dir, `frame-${i}.jpg`);
    try {
      await ffmpeg.extractJpegAt(videoPath, dest, t);
      const buf = await readFile(dest);
      parts.push({
        text: `Frame sample at ${t.toFixed(2)}s of ~${durationSec.toFixed(1)}s video`,
      });
      parts.push({ data: buf.toString('base64'), mimeType: 'image/jpeg' });
    } catch {
      /* skip bad frames */
    }
  }

  return {
    parts,
    durationSec,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

/** Resolve a Gemini key secret for Files API without going through the full router. */
export async function peekGeminiApiKey(
  listKeys: () => Promise<Array<{ secret: string; status: string }>>,
): Promise<string | null> {
  const keys = await listKeys();
  const active = keys.find((k) => k.status === 'ACTIVE' || k.status === 'COOLDOWN');
  return active?.secret ?? keys[0]?.secret ?? null;
}
