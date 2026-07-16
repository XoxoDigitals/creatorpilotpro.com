import { createHash } from 'node:crypto';
import type { TaskType } from '@scp/shared';

/**
 * Deterministic cache key (docs/05 §5) — same inputs must always produce the
 * same key across processes, so field order and JSON canonicalisation matter.
 *
 * cacheKey = sha256(taskType | model | promptVersion | styleVersion | inputContentHash)
 * where inputContentHash is caller-provided (video md5 for VIDEO_ANALYSIS,
 * script md5 for TTS, prompt+params sha for text tasks, etc.).
 *
 * Prompt/style edits bump `promptVersion` / `styleVersion` → the resulting key
 * changes, naturally invalidating only affected cache entries.
 */
export interface CacheKeyParts {
  task: TaskType;
  model: string;
  promptVersion: number;
  styleVersion: number;
  inputContentHash: string;
}

export function cacheKeyFor(parts: CacheKeyParts): string {
  const canonical = [
    'v1',
    parts.task,
    parts.model,
    String(parts.promptVersion),
    String(parts.styleVersion),
    parts.inputContentHash,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Cheap content-hash helper for text inputs. For video/audio callers pass the
 * asset's md5 directly (already computed by the ingest/render steps).
 */
export function hashText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
