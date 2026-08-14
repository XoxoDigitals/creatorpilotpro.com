/**
 * Voiceover timing helpers for repurposed narration: duration budget,
 * atempo fit, and scene-aligned line layout from VIDEO_ANALYSIS beats.
 */

/** Conservative speaking rate for budgets (prefer short lines over rush). */
export const NARRATION_WORDS_PER_SEC = 2.2;
/** Leave a small tail so TTS never runs past picture. */
export const NARRATION_DURATION_RATIO = 0.95;
export const NARRATION_DURATION_MARGIN_SEC = 0.25;
/** Max atempo before we trim instead of chipmunking (~15% speedup). */
export const MAX_VO_FIT_SPEED = 1.15;
/** Ignore tiny overruns — no need to speed 2% of slack. */
export const MIN_VO_FIT_SPEED = 1.04;

export function narrationBudgetSec(
  videoDurationSec: number | null | undefined,
): number | null {
  if (videoDurationSec == null || !Number.isFinite(videoDurationSec) || videoDurationSec <= 0) {
    return null;
  }
  return Math.max(1, videoDurationSec * NARRATION_DURATION_RATIO - NARRATION_DURATION_MARGIN_SEC);
}

export function narrationWordBudget(
  videoDurationSec: number | null | undefined,
): number | null {
  const budget = narrationBudgetSec(videoDurationSec);
  if (budget == null) return null;
  return Math.max(8, Math.round(budget * NARRATION_WORDS_PER_SEC));
}

/** Max spoken words that fit a single beat without rushing past ~1.15× atempo. */
export function beatWordBudget(durationSec: number): number {
  const dur = Math.max(0.35, durationSec);
  // Budget for natural pace; leave headroom so mild atempo can still fit.
  return Math.max(2, Math.floor(dur * NARRATION_WORDS_PER_SEC));
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Prefer shortening over extreme atempo — keep first N words. */
export function clampTextToWordBudget(text: string, maxWords: number): string {
  const trimmed = text.trim();
  if (!(maxWords > 0) || !trimmed) return trimmed;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return trimmed;
  return words.slice(0, maxWords).join(' ');
}

/** Speed factor to fit `actualSec` into `targetSec` (1 = no change). */
export function fitSpeed(actualSec: number, targetSec: number): number {
  if (!(actualSec > 0) || !(targetSec > 0) || actualSec <= targetSec * 1.02) return 1;
  return Math.min(MAX_VO_FIT_SPEED, actualSec / Math.max(0.2, targetSec));
}

/**
 * ffmpeg `atempo` accepts 0.5–2.0 per filter; chain for other values.
 * Returns null when speed-up is negligible.
 */
export function atempoFilter(speed: number): string | null {
  if (!Number.isFinite(speed) || speed <= MIN_VO_FIT_SPEED) return null;
  const clamped = Math.min(4, Math.max(0.5, speed));
  const parts: number[] = [];
  let remaining = clamped;
  while (remaining > 2 + 1e-6) {
    parts.push(2);
    remaining /= 2;
  }
  while (remaining < 0.5 - 1e-6) {
    parts.push(0.5);
    remaining /= 0.5;
  }
  parts.push(Number(remaining.toFixed(3)));
  return parts.map((p) => `atempo=${p}`).join(',');
}

export interface AnalysisBeat {
  startSec: number;
  endSec: number;
  whatHappens: string;
  visuals: string;
  speechOrAudio: string;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function analysisBeats(analysis: unknown): AnalysisBeat[] {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return [];
  const raw = (analysis as Record<string, unknown>).segments;
  if (!Array.isArray(raw)) return [];
  const out: AnalysisBeat[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const startSec = num(o.startSec) ?? 0;
    const endSec = num(o.endSec) ?? startSec;
    const whatHappens = typeof o.whatHappens === 'string' ? o.whatHappens.trim() : '';
    if (!whatHappens && endSec <= startSec) continue;
    out.push({
      startSec,
      endSec: endSec > startSec ? endSec : startSec,
      whatHappens,
      visuals: typeof o.visuals === 'string' ? o.visuals.trim() : '',
      speechOrAudio: typeof o.speechOrAudio === 'string' ? o.speechOrAudio.trim() : '',
    });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

export function analysisDurationSec(
  analysis: unknown,
  fallback?: number | null,
): number | null {
  if (analysis && typeof analysis === 'object' && !Array.isArray(analysis)) {
    const d = num((analysis as Record<string, unknown>).durationSec);
    if (d != null && d > 0) return d;
    const beats = analysisBeats(analysis);
    if (beats.length > 0) {
      const end = Math.max(...beats.map((b) => b.endSec));
      if (end > 0) return end;
    }
  }
  if (fallback != null && Number.isFinite(fallback) && fallback > 0) return fallback;
  return null;
}

export interface TimedNarrationLine {
  startSec: number;
  endSec: number;
  text: string;
}

function readLine(row: unknown): TimedNarrationLine | null {
  if (!row || typeof row !== 'object') return null;
  const o = row as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) return null;
  const startSec = num(o.startSec) ?? 0;
  const endSec = num(o.endSec) ?? startSec;
  return { startSec, endSec: endSec > startSec ? endSec : startSec, text };
}

function linesFromUnknown(raw: unknown): TimedNarrationLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(readLine).filter((l): l is TimedNarrationLine => l != null);
}

function variantById(output: unknown, selectedId?: string | null): Record<string, unknown> | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const variants = (output as Record<string, unknown>).variants;
  if (!Array.isArray(variants) || variants.length === 0) return null;
  if (selectedId) {
    const match = variants.find(
      (v) =>
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        (v as Record<string, unknown>).id === selectedId,
    );
    if (match && typeof match === 'object') return match as Record<string, unknown>;
  }
  const first = variants[0];
  return first && typeof first === 'object' && !Array.isArray(first)
    ? (first as Record<string, unknown>)
    : null;
}

/** Scene-aligned lines from persisted currentStep (variants first, then raw narration). */
export function timedLinesFromStep(step: Record<string, unknown> | null | undefined): TimedNarrationLine[] {
  if (!step) return [];
  const selectedId = typeof step.selectedScriptId === 'string' ? step.selectedScriptId : null;
  if (Array.isArray(step.scriptVariants)) {
    const variants = step.scriptVariants;
    const match = selectedId
      ? variants.find(
          (v) => v && typeof v === 'object' && !Array.isArray(v) && (v as { id?: unknown }).id === selectedId,
        )
      : variants.find(
          (v) =>
            v && typeof v === 'object' && !Array.isArray(v) && (v as { id?: unknown }).id === 'explainer',
        );
    const row = (match ?? variants[0]) as Record<string, unknown> | undefined;
    if (row) {
      const fromVariant = linesFromUnknown(row.lines);
      if (fromVariant.length > 0) return fromVariant;
    }
  }
  return timedLinesFromNarration(step.narration, selectedId);
}

/** Scene-aligned lines from narration JSON / selected variant. */
export function timedLinesFromNarration(
  output: unknown,
  selectedId?: string | null,
): TimedNarrationLine[] {
  const variant = variantById(output, selectedId);
  if (variant) {
    const fromVariant = linesFromUnknown(variant.lines);
    if (fromVariant.length > 0) return fromVariant;
  }
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const fromRoot = linesFromUnknown((output as Record<string, unknown>).lines);
    if (fromRoot.length > 0) return fromRoot;
  }
  return [];
}

/**
 * Clamp each line to its beat duration word budget so TTS is not forced to
 * extreme atempo. Rebuilds `script` from clamped lines when lines exist.
 */
export function clampTimedLinesToBeats(
  lines: TimedNarrationLine[],
  beats?: AnalysisBeat[],
): TimedNarrationLine[] {
  if (lines.length === 0) return lines;
  return lines.map((line) => {
    const beatDur = Math.max(0.35, line.endSec - line.startSec);
    let maxWords = beatWordBudget(beatDur);
    if (beats && beats.length > 0) {
      const match = beats.find(
        (b) =>
          Math.abs(b.startSec - line.startSec) < 0.35 &&
          Math.abs(b.endSec - line.endSec) < 0.35,
      );
      if (match) {
        maxWords = beatWordBudget(Math.max(0.35, match.endSec - match.startSec));
      }
    }
    return {
      ...line,
      text: clampTextToWordBudget(line.text, maxWords),
    };
  });
}

export interface ConcatPadStep {
  kind: 'silence' | 'audio';
  durationSec?: number;
  index?: number;
}

/**
 * Insert leading/gap silence so clips land on analysis timestamps.
 * Natural pace: if a clip overruns into the next beat start, the next clip
 * starts after it (no speedup). Trailing pad-to-picture is at render mux.
 */
export function timelinePadPlan(
  clips: { startSec: number; durationSec: number }[],
  _videoDurationSec?: number | null,
): ConcatPadStep[] {
  const ordered = clips
    .map((c, index) => ({ ...c, index }))
    .filter((c) => c.durationSec > 0)
    .sort((a, b) => a.startSec - b.startSec);
  const steps: ConcatPadStep[] = [];
  let cursor = 0;
  for (const clip of ordered) {
    const gap = clip.startSec - cursor;
    if (gap >= 0.04) {
      steps.push({ kind: 'silence', durationSec: gap });
      cursor += gap;
    }
    steps.push({ kind: 'audio', index: clip.index });
    cursor += clip.durationSec;
  }
  return steps;
}

export function beatsForPrompt(beats: AnalysisBeat[]): {
  startSec: number;
  endSec: number;
  durationSec: number;
  maxWords: number;
  whatHappens: string;
  visuals: string;
  speechOrAudio: string;
}[] {
  return beats.map((b) => {
    const durationSec = Math.max(0.2, Number((b.endSec - b.startSec).toFixed(2)));
    return {
      startSec: b.startSec,
      endSec: b.endSec,
      durationSec,
      maxWords: beatWordBudget(durationSec),
      whatHappens: b.whatHappens,
      visuals: b.visuals,
      speechOrAudio: b.speechOrAudio,
    };
  });
}
