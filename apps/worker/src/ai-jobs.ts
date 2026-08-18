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

// ── Phase 4 AI jobs ────────────────────────────────────────────────────────

export interface IdeaGenerationJob {
  kind: 'idea_generation';
  accountId: string;
  /** Persisted JobRun used by the API/UI to expose progress across refreshes. */
  generationRunId?: string;
  /** How many ideas to generate (default 50). */
  count?: number;
  /** Optional user topic seed that steers idea generation. */
  topicSeed?: string;
  /** When true, use the seed as the exact video topic (single idea). */
  exactTopic?: boolean;
}

export interface BriefGenerationJob {
  kind: 'brief_generation';
  ideaId: string;
}

/** TTS for an AI-owner creative package (idea brief script → voiceover file). */
export interface IdeaTtsJob {
  kind: 'idea_tts';
  ideaId: string;
}

/** Finalize timed transcript from Edge subtitles (or transcription fallback). */
export interface IdeaTranscriptJob {
  kind: 'idea_transcript';
  ideaId: string;
}

/** Generate scene image/video prompts aligned to timed narration. */
export interface IdeaVisualsJob {
  kind: 'idea_visuals';
  ideaId: string;
}

export interface DramaBibleJob {
  kind: 'drama_bible';
  seriesId: string;
}

export interface DramaEpisodeJob {
  kind: 'drama_episode';
  episodeId: string;
}

export function isIdeaGenerationJob(data: unknown): data is IdeaGenerationJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'idea_generation' &&
    typeof (data as IdeaGenerationJob).accountId === 'string'
  );
}

export function isBriefGenerationJob(data: unknown): data is BriefGenerationJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'brief_generation' &&
    typeof (data as BriefGenerationJob).ideaId === 'string'
  );
}

export function isIdeaTtsJob(data: unknown): data is IdeaTtsJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'idea_tts' &&
    typeof (data as IdeaTtsJob).ideaId === 'string'
  );
}

export function isIdeaTranscriptJob(data: unknown): data is IdeaTranscriptJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'idea_transcript' &&
    typeof (data as IdeaTranscriptJob).ideaId === 'string'
  );
}

export function isIdeaVisualsJob(data: unknown): data is IdeaVisualsJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'idea_visuals' &&
    typeof (data as IdeaVisualsJob).ideaId === 'string'
  );
}

export function isDramaBibleJob(data: unknown): data is DramaBibleJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'drama_bible' &&
    typeof (data as DramaBibleJob).seriesId === 'string'
  );
}

export function isDramaEpisodeJob(data: unknown): data is DramaEpisodeJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'drama_episode' &&
    typeof (data as DramaEpisodeJob).episodeId === 'string'
  );
}

// ── Phase 7 AI jobs ────────────────────────────────────────────────────────

export interface AbSuggestionsJob {
  kind: 'ab_suggestions';
  contentItemId: string;
}

export function isAbSuggestionsJob(data: unknown): data is AbSuggestionsJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'ab_suggestions' &&
    typeof (data as AbSuggestionsJob).contentItemId === 'string'
  );
}

/** Analyze reference-channel titles/views → persist performanceMemory. */
export interface CompetitorPerformanceJob {
  kind: 'competitor_performance';
  competitorChannelId: string;
  /** When true, re-analyze even if data fingerprint is unchanged. */
  force?: boolean;
}

export function isCompetitorPerformanceJob(data: unknown): data is CompetitorPerformanceJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'competitor_performance' &&
    typeof (data as CompetitorPerformanceJob).competitorChannelId === 'string'
  );
}
