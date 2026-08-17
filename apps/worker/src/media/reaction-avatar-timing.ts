/**
 * Speaking-window timing for reaction-avatar PiP.
 * Prefer AI dialogue ranges; fall back to subtitle cues, VO length, then a short lead-in.
 * Source trim length = sum of speaking durations (capped by clip / rembg max).
 */

export type TimeRange = { startSec: number; endSec: number };

/** Default lead-in when no dialogue / VO / subtitle windows exist (within 3–8s). */
export const REACTION_AVATAR_FALLBACK_LEAD_IN_SEC = 5;
export const REACTION_AVATAR_FALLBACK_LEAD_IN_MIN_SEC = 3;
export const REACTION_AVATAR_FALLBACK_LEAD_IN_MAX_SEC = 8;
/**
 * Hold PiP across short VO pauses (inter-segment silence is ~0.32s).
 * Gaps longer than this still hide the avatar in speaking-only mode.
 */
export const REACTION_AVATAR_HOLD_GAP_SEC = 0.75;

export type ReactionAvatarPick = { rel: string; kind: 'silent' | 'lip-sync' };

/**
 * Silent still/clip is the always-on PiP. Lip-sync is only used when no silent
 * asset was uploaded (otherwise the talking-head hid the silent face).
 */
export function pickReactionAvatarSource(avatar: {
  enabled?: boolean;
  assetPath?: string | null;
  lipSyncAssetPath?: string | null;
}): ReactionAvatarPick | null {
  if (!avatar.enabled) return null;
  const silent = avatar.assetPath?.trim();
  if (silent) return { rel: silent, kind: 'silent' };
  const lip = avatar.lipSyncAssetPath?.trim();
  if (lip) return { rel: lip, kind: 'lip-sync' };
  return null;
}

export type ReactionAvatarSpeakingSource =
  | 'dialogue'
  | 'subtitle'
  | 'voiceover'
  | 'lead-in'
  | 'always';

function normalizeRange(startSec: number, endSec: number): TimeRange | null {
  if (!(Number.isFinite(startSec) && Number.isFinite(endSec))) return null;
  const start = Math.max(0, startSec);
  const end = endSec;
  if (!(end > start + 0.05)) return null;
  return { startSec: start, endSec: end };
}

/**
 * Merge speaking windows separated by ≤ `maxGapSec` so the avatar stays visible
 * through short inter-segment VO gaps (not long intentional silence).
 */
export function bridgeSpeakingGaps(
  ranges: TimeRange[],
  maxGapSec: number = REACTION_AVATAR_HOLD_GAP_SEC,
): TimeRange[] {
  const sorted = [...ranges]
    .map((r) => normalizeRange(r.startSec, r.endSec))
    .filter((r): r is TimeRange => r != null)
    .sort((a, b) => a.startSec - b.startSec);
  if (sorted.length === 0) return [];
  const out: TimeRange[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startSec <= last.endSec + maxGapSec) {
      last.endSec = Math.max(last.endSec, cur.endSec);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Total seconds covered by speaking windows (after normalizing). */
export function sumSpeakingDurations(ranges: TimeRange[]): number {
  let sum = 0;
  for (const r of ranges) {
    const n = normalizeRange(r.startSec, r.endSec);
    if (!n) continue;
    sum += n.endSec - n.startSec;
  }
  return sum;
}

export function speakingRangesFromSubtitleCues(
  cues: { startMs: number; endMs: number }[],
): TimeRange[] {
  const out: TimeRange[] = [];
  for (const c of cues) {
    if (!(Number.isFinite(c.startMs) && Number.isFinite(c.endMs))) continue;
    const r = normalizeRange(c.startMs / 1000, c.endMs / 1000);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Resolve when the reaction PiP should be visible and how much source media to keep.
 * - dialogue: AI ranges → subtitle cues → VO [0, voEnd] → short lead-in
 * - always: full picture (no enable windows); still used for source trim caps
 */
export function resolveReactionAvatarSpeakingRanges(opts: {
  showDuring: 'dialogue' | 'always';
  dialogueRanges: TimeRange[];
  subtitleCues?: { startMs: number; endMs: number }[];
  voEndSec?: number | null;
  pictureSec?: number | null;
  leadInSec?: number;
}): { ranges: TimeRange[]; source: ReactionAvatarSpeakingSource } {
  if (opts.showDuring === 'always') {
    const pic = opts.pictureSec;
    if (pic != null && Number.isFinite(pic) && pic > 0.05) {
      return { ranges: [{ startSec: 0, endSec: pic }], source: 'always' };
    }
    return { ranges: [], source: 'always' };
  }

  const dialogue = bridgeSpeakingGaps(
    (opts.dialogueRanges ?? [])
      .map((r) => normalizeRange(r.startSec, r.endSec))
      .filter((r): r is TimeRange => r != null),
  );
  if (dialogue.length > 0) {
    return { ranges: dialogue, source: 'dialogue' };
  }

  const fromSubs = bridgeSpeakingGaps(speakingRangesFromSubtitleCues(opts.subtitleCues ?? []));
  if (fromSubs.length > 0) {
    return { ranges: fromSubs, source: 'subtitle' };
  }

  const vo = opts.voEndSec;
  if (vo != null && Number.isFinite(vo) && vo > 0.05) {
    const end =
      opts.pictureSec != null && Number.isFinite(opts.pictureSec) && opts.pictureSec > 0
        ? Math.min(vo, opts.pictureSec)
        : vo;
    const r = normalizeRange(0, end);
    if (r) return { ranges: [r], source: 'voiceover' };
  }

  const lead = Math.min(
    REACTION_AVATAR_FALLBACK_LEAD_IN_MAX_SEC,
    Math.max(
      REACTION_AVATAR_FALLBACK_LEAD_IN_MIN_SEC,
      opts.leadInSec ?? REACTION_AVATAR_FALLBACK_LEAD_IN_SEC,
    ),
  );
  const picCap =
    opts.pictureSec != null && Number.isFinite(opts.pictureSec) && opts.pictureSec > 0
      ? opts.pictureSec
      : lead;
  return {
    ranges: [{ startSec: 0, endSec: Math.min(lead, picCap) }],
    source: 'lead-in',
  };
}

/**
 * How many seconds of the reaction source to read/process.
 * Caps by clip length and optional hard max (e.g. rembg). Minimum small epsilon avoided.
 */
export function reactionAvatarSourceTrimSec(opts: {
  speakingRanges: TimeRange[];
  clipDurationSec?: number | null;
  maxSec?: number | null;
  /** When ranges empty (always + unknown picture), keep this much of the clip. */
  fallbackSec?: number;
}): number {
  const spoken = sumSpeakingDurations(opts.speakingRanges);
  let need =
    spoken > 0.05
      ? spoken
      : Math.max(
          REACTION_AVATAR_FALLBACK_LEAD_IN_MIN_SEC,
          opts.fallbackSec ?? REACTION_AVATAR_FALLBACK_LEAD_IN_SEC,
        );

  if (opts.clipDurationSec != null && Number.isFinite(opts.clipDurationSec) && opts.clipDurationSec > 0) {
    need = Math.min(need, opts.clipDurationSec);
  }
  if (opts.maxSec != null && Number.isFinite(opts.maxSec) && opts.maxSec > 0) {
    need = Math.min(need, opts.maxSec);
  }
  return Math.max(0.1, Number(need.toFixed(3)));
}
