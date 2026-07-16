/**
 * AI + TTS + render job contracts (docs/05 §2, Phase 3.4–3.6). Each stage rides
 * its own pg-boss queue. State machine: APPROVED→ANALYZING→SCRIPT_READY (AI),
 * SCRIPT_APPROVED→TTS_DONE (TTS), TTS_DONE→RENDERED→METADATA_READY (render).
 */

/** AI queue: analyze video, generate narration script, or generate metadata. */
export interface AiJob {
  kind: 'analyze' | 'narration' | 'metadata';
  contentItemId: string;
}

/** TTS queue: synthesize voiceover from approved script. */
export interface TtsJob {
  kind: 'tts';
  contentItemId: string;
}

/** RENDER queue (reuses MEDIA or a separate render queue): merge VO + video. */
export interface RenderJob {
  kind: 'render';
  contentItemId: string;
}

export function isAiJob(data: unknown): data is AiJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    ['analyze', 'narration', 'metadata'].includes((data as { kind?: string }).kind ?? '') &&
    typeof (data as AiJob).contentItemId === 'string'
  );
}

export function isTtsJob(data: unknown): data is TtsJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'tts' &&
    typeof (data as TtsJob).contentItemId === 'string'
  );
}

export function isRenderJob(data: unknown): data is RenderJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'render' &&
    typeof (data as RenderJob).contentItemId === 'string'
  );
}
