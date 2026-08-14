/**
 * Detect spoken dialogue vs natural-sound beds from VIDEO_ANALYSIS JSON
 * (and fallback text). Used by the Repurposed render mix so voiceover can
 * sit over ambience when the original clip has no talking.
 */

const DIALOGUE_HINT =
  /\b(dialogue|speaking|talking|talks|speaks|says|said|spoken|speech|conversation|interview|replies?|asks?|asked|narrat(?:or|ion)?|voice[- ]?over|vo\b|lyrics|singing|sung)\b/i;
const NO_DIALOGUE_HINT =
  /\b(no (?:dialogue|speech|talking|voices?|narration)|silent|silence|instrumental|ambience only|natural sound only|sfx only|music only)\b/i;

function collectSpeechBlobs(analysis: unknown): string[] {
  if (analysis == null) return [];
  if (typeof analysis === 'string') return [analysis];
  if (Array.isArray(analysis)) {
    return analysis.flatMap(collectSpeechBlobs);
  }
  if (typeof analysis !== 'object') return [];
  const obj = analysis as Record<string, unknown>;
  const blobs: string[] = [];
  if (typeof obj.speechOrAudio === 'string') blobs.push(obj.speechOrAudio);
  if (typeof obj.summary === 'string') blobs.push(obj.summary);
  if (typeof obj.overallWhatHappens === 'string') blobs.push(obj.overallWhatHappens);
  if (Array.isArray(obj.segments)) blobs.push(...collectSpeechBlobs(obj.segments));
  if (Array.isArray(obj.people)) blobs.push(...collectSpeechBlobs(obj.people));
  return blobs;
}

function readFlag(analysis: unknown, key: string): boolean | undefined {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return undefined;
  const v = (analysis as Record<string, unknown>)[key];
  return typeof v === 'boolean' ? v : undefined;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function speechLooksLikeDialogue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const withoutNeg = trimmed.replace(
    /\b(no (?:dialogue|speech|talking|voices?|narration)|silent|silence|instrumental|ambience only|natural sound only|sfx only|music only)\b/gi,
    ' ',
  );
  if (NO_DIALOGUE_HINT.test(trimmed) && !DIALOGUE_HINT.test(withoutNeg)) return false;
  if (DIALOGUE_HINT.test(withoutNeg)) return true;
  // Quoted or "X: ..." style lines often mark dialogue even without verbs.
  if (/[""«»]/.test(trimmed) || /\b\w{2,}\s*:\s+\S/.test(trimmed)) return true;
  return false;
}

/** True when analysis says ambience / SFX / music is present (even with dialogue). */
export function analysisIndicatesNaturalSound(analysis: unknown): boolean {
  const flagged = readFlag(analysis, 'hasNaturalSound');
  if (flagged !== undefined) return flagged;
  const blobs = collectSpeechBlobs(analysis);
  const text = blobs.join(' ').trim();
  if (!text) return false;
  return /\b(ambience|ambient|sfx|sound effects?|background music|bgm|instrumental|natural sound|crowd|traffic|wind|music)\b/i.test(
    text,
  );
}

/** True when analysis says people are talking / there is spoken dialogue. */
export function analysisIndicatesDialogue(analysis: unknown): boolean {
  const flagged = readFlag(analysis, 'hasDialogue');
  if (flagged === true) return true;

  const blobs = collectSpeechBlobs(analysis);
  const text = blobs.join(' ').trim();
  if (text) {
    // Strip negative phrases first so "no dialogue" does not trip the positive hint.
    const withoutNeg = text.replace(
      /\b(no (?:dialogue|speech|talking|voices?|narration)|silent|silence|instrumental|ambience only|natural sound only|sfx only|music only)\b/gi,
      ' ',
    );
    if (DIALOGUE_HINT.test(withoutNeg)) return true;
    if (NO_DIALOGUE_HINT.test(text)) return false;
  }

  return false;
}

export interface DialogueTimeRange {
  startSec: number;
  endSec: number;
}

function normalizeRange(startSec: number, endSec: number): DialogueTimeRange | null {
  if (!(Number.isFinite(startSec) && Number.isFinite(endSec))) return null;
  const start = Math.max(0, startSec);
  const end = endSec;
  if (!(end > start + 0.05)) return null;
  return { startSec: start, endSec: end };
}

/** Merge overlapping / near-adjacent dialogue windows (gap ≤ 0.3s). */
export function mergeDialogueRanges(ranges: DialogueTimeRange[]): DialogueTimeRange[] {
  const sorted = [...ranges]
    .map((r) => normalizeRange(r.startSec, r.endSec))
    .filter((r): r is DialogueTimeRange => r != null)
    .sort((a, b) => a.startSec - b.startSec);
  if (sorted.length === 0) return [];
  const out: DialogueTimeRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startSec <= last.endSec + 0.3) {
      last.endSec = Math.max(last.endSec, cur.endSec);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Precise dialogue windows for render mute.
 * Prefer analysis.dialogueRanges; else derive from segments with spoken speechOrAudio.
 * Empty → caller should fall back to full-bed aggressive mute when hasDialogue.
 */
export function analysisDialogueRanges(analysis: unknown): DialogueTimeRange[] {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return [];
  const obj = analysis as Record<string, unknown>;
  const fromField: DialogueTimeRange[] = [];
  if (Array.isArray(obj.dialogueRanges)) {
    for (const row of obj.dialogueRanges) {
      if (!row || typeof row !== 'object') continue;
      const o = row as Record<string, unknown>;
      const startSec = num(o.startSec);
      const endSec = num(o.endSec);
      if (startSec == null || endSec == null) continue;
      const r = normalizeRange(startSec, endSec);
      if (r) fromField.push(r);
    }
  }
  if (fromField.length > 0) return mergeDialogueRanges(fromField);

  const segments = obj.segments;
  if (!Array.isArray(segments)) return [];
  const derived: DialogueTimeRange[] = [];
  for (const row of segments) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const speech = typeof o.speechOrAudio === 'string' ? o.speechOrAudio : '';
    if (!speechLooksLikeDialogue(speech)) continue;
    const startSec = num(o.startSec) ?? 0;
    const endSec = num(o.endSec) ?? startSec;
    const r = normalizeRange(startSec, endSec);
    if (r) derived.push(r);
  }
  return mergeDialogueRanges(derived);
}

export interface AnalysisPerson {
  label: string;
  originOrContext: string;
  whyNotable: string;
}

/** People / notable subjects called out by VIDEO_ANALYSIS. */
export function analysisPeople(analysis: unknown): AnalysisPerson[] {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) return [];
  const raw = (analysis as Record<string, unknown>).people;
  if (!Array.isArray(raw)) {
    const characters = (analysis as Record<string, unknown>).characters;
    if (Array.isArray(characters)) {
      return characters
        .map((c) => (typeof c === 'string' ? c.trim() : ''))
        .filter(Boolean)
        .map((label) => ({ label, originOrContext: '', whyNotable: '' }));
    }
    return [];
  }
  const out: AnalysisPerson[] = [];
  for (const row of raw) {
    if (typeof row === 'string' && row.trim()) {
      out.push({ label: row.trim(), originOrContext: '', whyNotable: '' });
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!label) continue;
    out.push({
      label,
      originOrContext: typeof o.originOrContext === 'string' ? o.originOrContext.trim() : '',
      whyNotable: typeof o.whyNotable === 'string' ? o.whyNotable.trim() : '',
    });
  }
  return out;
}
