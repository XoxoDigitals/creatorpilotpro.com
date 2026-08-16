/**
 * Viral overlay caption templates (Hormozi / Reels style) for ffmpeg ASS burn-in
 * and AI-tab CSS preview. Bold, all-caps, thick outline, word-level color pops.
 */
export const CAPTION_TEMPLATE_IDS = [
  'impact_center',
  'impact_hormozi',
  'impact_cyan',
  'impact_yellow',
  'impact_pink',
  'impact_red',
  'impact_stack',
  'karaoke_word',
  'boxed_white',
  'boxed_yellow',
  // Legacy ids kept so old saved settings still resolve.
  'bottom_white',
  'bottom_yellow',
  'center_white',
  'karaoke_yellow',
] as const;

export type CaptionTemplateId = (typeof CAPTION_TEMPLATE_IDS)[number];

/** Kept for older saved settings / DB rows. */
export const LEGACY_CAPTION_PRESETS = ['bottom', 'center', 'karaoke'] as const;

export type CaptionPreset = CaptionTemplateId | (typeof LEGACY_CAPTION_PRESETS)[number];

export type CaptionHighlightMode =
  | 'none'
  | 'hormozi'
  | 'cyan_phrase'
  | 'yellow_pop'
  | 'pink_pop'
  | 'red_pop'
  | 'stack_two_tone'
  /** Timed: active spoken word highlighted across a 2-line caption. */
  | 'karaoke_word';

/**
 * Caption text appearance vs video brightness.
 * - `dark` = light text / dark outline (default, for dark footage)
 * - `light` = dark text / light outline (for bright footage)
 */
export const CAPTION_COLOR_MODES = ['dark', 'light'] as const;
export type CaptionColorMode = (typeof CAPTION_COLOR_MODES)[number];

export const CAPTION_COLOR_MODE_LABELS: Record<CaptionColorMode, string> = {
  dark: 'Light text (dark mode)',
  light: 'Dark text (light mode)',
};

/** Vertical placement for captions / hooks (ASS MarginV + Alignment). */
export const OVERLAY_POSITIONS = ['top', 'upper', 'center', 'lower', 'bottom'] as const;
export type OverlayPosition = (typeof OVERLAY_POSITIONS)[number];

export const OVERLAY_POSITION_LABELS: Record<OverlayPosition, string> = {
  top: 'Top',
  upper: 'Upper third',
  center: 'Center',
  lower: 'Lower third',
  bottom: 'Bottom',
};

/** Discrete positions → Y% from top (legacy → continuous slider). */
export const OVERLAY_POSITION_Y_PERCENT: Record<OverlayPosition, number> = {
  top: 6,
  upper: 20,
  center: 46,
  lower: 70,
  bottom: 88,
};

/** Sentinel: skip hook / caption burn-in for this video. */
export const OVERLAY_OFF_ID = 'none';

/** Hard cap so ASS + CSS preview stay ≤2 visual lines (no mid-line wrap). */
export const CAPTION_MAX_WORDS = 6;

/**
 * Legacy constant — do not show this as fake caption copy.
 * Live preview should use {@link captionPreviewFromNarration} from the real script.
 * Empty so callers never paint a placeholder phrase onto the video mock.
 */
export const CAPTION_PREVIEW_SAMPLE = '';

/**
 * First ≤{@link CAPTION_MAX_WORDS} words of narration for the AI-panel CSS caption mock.
 * Burn-in / ASS never use this — only the live overlay preview.
 */
export function captionPreviewFromNarration(raw: string | null | undefined): string {
  const words = (raw ?? '')
    .replace(/[#@]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, CAPTION_MAX_WORDS);
  return words.join(' ');
}

/** Safe inset from frame edge as % of height (CSS + ASS). */
export const OVERLAY_SAFE_EDGE_PERCENT = 5;

export type CaptionTemplateMeta = {
  id: CaptionTemplateId;
  label: string;
  description: string;
  /** Default placement when the owner hasn't overridden position. */
  align: 'bottom' | 'center' | 'upper';
  /** Hex for base / unhighlighted text. */
  color: string;
  /** Hex for preview outline / box. */
  outline: string;
  boxed: boolean;
  italic: boolean;
  /** Relative font size for preview (sm / md / lg / xl). */
  size: 'sm' | 'md' | 'lg' | 'xl';
  highlightMode: CaptionHighlightMode;
  /** Accent colors used when highlighting words (hex). */
  accents: string[];
};

export const CAPTION_TEMPLATES: CaptionTemplateMeta[] = [
  {
    id: 'impact_hormozi',
    label: 'Impact Hormozi',
    description: 'Center bold caps — yellow + green word pops (viral Shorts)',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'hormozi',
    accents: ['#FFE566', '#00E676'],
  },
  {
    id: 'impact_cyan',
    label: 'Impact cyan',
    description: 'Upper bold italic — white + cyan punch line',
    align: 'upper',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: true,
    size: 'xl',
    highlightMode: 'cyan_phrase',
    accents: ['#00E5FF'],
  },
  {
    id: 'impact_center',
    label: 'Impact white',
    description: 'Huge white center captions, thick black outline',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'none',
    accents: [],
  },
  {
    id: 'impact_yellow',
    label: 'Impact yellow',
    description: 'Center caps with yellow emphasis words',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'yellow_pop',
    accents: ['#FFE566'],
  },
  {
    id: 'impact_pink',
    label: 'Impact pink',
    description: 'Center bold with hot-pink word pops',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'pink_pop',
    accents: ['#FF4DC4'],
  },
  {
    id: 'impact_red',
    label: 'Impact red',
    description: 'Upper bold with red emphasis',
    align: 'upper',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'red_pop',
    accents: ['#FF3B3B'],
  },
  {
    id: 'impact_stack',
    label: 'Two-tone stack',
    description: 'Line 1 white, line 2 yellow (always 2 lines)',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'stack_two_tone',
    accents: ['#FFE566'],
  },
  {
    id: 'karaoke_word',
    label: 'Karaoke highlight',
    description: '2-line captions — each word lights up as the narrator says it',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'xl',
    highlightMode: 'karaoke_word',
    accents: ['#FFE566'],
  },
  {
    id: 'boxed_white',
    label: 'Boxed bottom',
    description: 'White text on a dark box (lower third)',
    align: 'bottom',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: true,
    italic: false,
    size: 'md',
    highlightMode: 'none',
    accents: [],
  },
  {
    id: 'boxed_yellow',
    label: 'Boxed yellow',
    description: 'Yellow text on a dark box',
    align: 'bottom',
    color: '#FFE566',
    outline: '#000000',
    boxed: true,
    italic: false,
    size: 'md',
    highlightMode: 'none',
    accents: [],
  },
  // Legacy aliases (hidden from picker via CAPTION_TEMPLATE_PICKER)
  {
    id: 'bottom_white',
    label: 'Bottom white',
    description: 'Classic white captions at the bottom',
    align: 'bottom',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'md',
    highlightMode: 'none',
    accents: [],
  },
  {
    id: 'bottom_yellow',
    label: 'Bottom yellow',
    description: 'High-contrast yellow captions',
    align: 'bottom',
    color: '#FFE566',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'md',
    highlightMode: 'none',
    accents: [],
  },
  {
    id: 'center_white',
    label: 'Center bold',
    description: 'Large white captions in the middle',
    align: 'center',
    color: '#FFFFFF',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'lg',
    highlightMode: 'none',
    accents: [],
  },
  {
    id: 'karaoke_yellow',
    label: 'Karaoke pop',
    description: 'Bigger yellow bottom captions',
    align: 'bottom',
    color: '#FFE566',
    outline: '#000000',
    boxed: false,
    italic: false,
    size: 'lg',
    highlightMode: 'none',
    accents: [],
  },
];

/** Templates shown in the AI script-approval picker (viral overlay set). */
export const CAPTION_TEMPLATE_PICKER: CaptionTemplateMeta[] = CAPTION_TEMPLATES.filter((t) =>
  [
    'impact_hormozi',
    'impact_cyan',
    'impact_center',
    'impact_yellow',
    'impact_pink',
    'impact_red',
    'impact_stack',
    'karaoke_word',
    'boxed_white',
    'boxed_yellow',
  ].includes(t.id),
);

export function normalizeCaptionColorMode(raw: unknown): CaptionColorMode {
  return raw === 'light' ? 'light' : 'dark';
}

/** Resolve base / outline / accent hex for a template + light/dark text mode. */
export function resolveCaptionColors(
  meta: CaptionTemplateMeta,
  colorMode: CaptionColorMode = 'dark',
): { color: string; outline: string; accents: string[] } {
  if (colorMode === 'light') {
    // Dark text on bright footage; keep punchy accents.
    return {
      color: '#111111',
      outline: '#FFFFFF',
      accents: meta.accents.length > 0 ? meta.accents : ['#C9A227'],
    };
  }
  return {
    color: meta.color,
    outline: meta.outline,
    accents: meta.accents,
  };
}

export function normalizeOverlayPosition(
  raw: unknown,
  fallback: OverlayPosition = 'center',
): OverlayPosition {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if ((OVERLAY_POSITIONS as readonly string[]).includes(s)) return s as OverlayPosition;
  // Numeric / pct strings → nearest discrete bucket (legacy callers).
  if (s && /^\d+(\.\d+)?$/.test(s)) {
    return overlayPositionFromYPercent(Number(s));
  }
  return fallback;
}

/** Clamp continuous vertical placement (0 = top, 100 = bottom). */
export function clampOverlayYPercent(raw: unknown, fallback = 46): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(n)) return Math.max(0, Math.min(100, fallback));
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Resolve stored position (enum or numeric %) → continuous Y% from top.
 * Safe for sliders + ASS MarginV mapping.
 */
export function normalizeOverlayYPercent(
  raw: unknown,
  fallbackPos: OverlayPosition = 'center',
): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clampOverlayYPercent(raw, OVERLAY_POSITION_Y_PERCENT[fallbackPos]);
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return OVERLAY_POSITION_Y_PERCENT[fallbackPos];
    if (/^\d+(\.\d+)?$/.test(s)) {
      return clampOverlayYPercent(Number(s), OVERLAY_POSITION_Y_PERCENT[fallbackPos]);
    }
    if ((OVERLAY_POSITIONS as readonly string[]).includes(s)) {
      return OVERLAY_POSITION_Y_PERCENT[s as OverlayPosition];
    }
  }
  return OVERLAY_POSITION_Y_PERCENT[fallbackPos];
}

/** Nearest discrete bucket for a continuous Y% (settings UIs that still use enums). */
export function overlayPositionFromYPercent(yPercent: number): OverlayPosition {
  const y = clampOverlayYPercent(yPercent, 46);
  let best: OverlayPosition = 'center';
  let bestDist = Infinity;
  for (const pos of OVERLAY_POSITIONS) {
    const d = Math.abs(OVERLAY_POSITION_Y_PERCENT[pos] - y);
    if (d < bestDist) {
      bestDist = d;
      best = pos;
    }
  }
  return best;
}

/**
 * Map continuous Y% → ASS Alignment 8 (top) + MarginV with safe edge padding
 * so multi-line XL captions/hooks are not clipped at the frame edge.
 */
export function overlayAssFromYPercent(
  yPercent: number,
  playResY = 1920,
  opts?: { lineCount?: number; fontSize?: number },
): { alignment: number; marginV: number } {
  const fontSize = opts?.fontSize ?? 52;
  const lineCount = Math.max(1, Math.min(2, opts?.lineCount ?? 2));
  const blockH = Math.round(fontSize * 1.15 * lineCount);
  const safePx = Math.max(
    Math.round((OVERLAY_SAFE_EDGE_PERCENT / 100) * playResY),
    Math.round(fontSize * 0.9),
  );
  const usable = Math.max(0, playResY - 2 * safePx - blockH);
  const y = clampOverlayYPercent(yPercent, 46) / 100;
  const marginV = Math.round(safePx + y * usable);
  return { alignment: 8, marginV };
}

/** CSS `top` % for live preview — mirrors ASS safe margins. */
export function overlayPreviewTopPercent(
  yPercent: number,
  opts?: { blockHeightPercent?: number },
): number {
  const block = opts?.blockHeightPercent ?? 10;
  const safe = OVERLAY_SAFE_EDGE_PERCENT;
  const usable = Math.max(0, 100 - 2 * safe - block);
  const y = clampOverlayYPercent(yPercent, 46) / 100;
  return Math.round((safe + y * usable) * 10) / 10;
}

/** Map position → ASS Alignment + MarginV (1080x1920 PlayRes). */
export function overlayPositionAss(pos: OverlayPosition): { alignment: number; marginV: number } {
  return overlayAssFromYPercent(OVERLAY_POSITION_Y_PERCENT[pos]);
}

/** Split words into up to `maxLines` balanced rows (captions = 2). Caps total words. */
export function wrapWordsToLines(
  words: string[],
  maxLines = 2,
  maxWords = CAPTION_MAX_WORDS,
): string[][] {
  const clean = words.filter(Boolean).slice(0, Math.max(1, maxWords));
  if (clean.length === 0) return [];
  const lines = Math.max(1, Math.min(2, maxLines));
  if (lines === 1 || clean.length <= 2) return [clean];
  const mid = Math.ceil(clean.length / 2);
  return [clean.slice(0, mid), clean.slice(mid)].filter((r) => r.length > 0);
}

export function isOverlayOffId(raw: unknown): boolean {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return s === OVERLAY_OFF_ID || s === 'off' || s === '__none__';
}

export function normalizeCaptionTemplateId(raw: unknown): CaptionTemplateId {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if ((CAPTION_TEMPLATE_IDS as readonly string[]).includes(s)) {
    return s as CaptionTemplateId;
  }
  switch (s) {
    case 'bottom':
      return 'bottom_white';
    case 'center':
      return 'center_white';
    case 'karaoke':
      return 'karaoke_yellow';
    default:
      return 'impact_hormozi';
  }
}

export function captionTemplateMeta(id: unknown): CaptionTemplateMeta {
  const normalized = normalizeCaptionTemplateId(id);
  return CAPTION_TEMPLATES.find((t) => t.id === normalized) ?? CAPTION_TEMPLATES[0]!;
}

/** ASS PrimaryColour / OutlineColour (&HAABBGGRR). */
export function assColor(hex: string, alpha = '00'): string {
  const h = hex.replace('#', '').trim();
  if (h.length !== 6) return `&H${alpha}FFFFFF`;
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

const STOP_WORDS = new Set([
  'A',
  'AN',
  'THE',
  'AND',
  'OR',
  'BUT',
  'TO',
  'OF',
  'IN',
  'ON',
  'FOR',
  'IS',
  'ARE',
  'WAS',
  'IT',
  'ITS',
  "IT'S",
  'THIS',
  'THAT',
  'WITH',
  'AS',
  'AT',
  'BY',
  'FROM',
  'BE',
  'HAVE',
  'HAS',
  'HAD',
  'YOU',
  'YOUR',
  'WE',
  'THEY',
  'I',
  'ME',
  'MY',
  'OUR',
]);

function isHighlightCandidate(word: string): boolean {
  const w = word.replace(/[^A-Z0-9$%]/g, '');
  if (!w || STOP_WORDS.has(w)) return false;
  if (/[$%\d]/.test(w)) return true;
  if (w.length >= 5) return true;
  return false;
}

/**
 * Pick word indices to color for Hormozi-style emphasis.
 * Prefers numbers/$ words, then longest content words (up to 2–3).
 */
export function pickHighlightIndices(words: string[], max = 3): number[] {
  const scored = words
    .map((w, i) => {
      const clean = w.replace(/[^A-Z0-9$%]/g, '');
      let score = 0;
      if (/[$%\d]/.test(clean)) score += 100;
      if (clean.length >= 6) score += 40;
      else if (clean.length >= 5) score += 25;
      if (isHighlightCandidate(w)) score += 10;
      return { i, score, len: clean.length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.len - a.len);

  const picked: number[] = [];
  for (const row of scored) {
    if (picked.length >= max) break;
    // Prefer not highlighting adjacent words if we already have 2+.
    if (picked.length >= 2 && picked.some((p) => Math.abs(p - row.i) === 1)) continue;
    picked.push(row.i);
  }
  if (picked.length === 0 && words.length > 0) {
    // Fallback: last content word.
    for (let i = words.length - 1; i >= 0; i--) {
      if (isHighlightCandidate(words[i]!)) {
        picked.push(i);
        break;
      }
    }
  }
  return picked.sort((a, b) => a - b);
}

export type PreviewCaptionSpan = { text: string; color: string };

export type PreviewCaptionOptions = {
  colorMode?: CaptionColorMode | null;
  /** For karaoke preview: which word index is “spoken” (defaults to mid word). */
  activeWordIndex?: number | null;
};

/** Colored spans grouped into at most 2 lines for live preview. */
export function previewCaptionLines(
  raw: string,
  templateId: unknown,
  options?: PreviewCaptionOptions,
): PreviewCaptionSpan[][] {
  const meta = captionTemplateMeta(templateId);
  const colors = resolveCaptionColors(meta, normalizeCaptionColorMode(options?.colorMode));
  const words = raw
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, CAPTION_MAX_WORDS);
  if (words.length === 0) return [];

  const colorFor = (_w: string, i: number, indices: Set<number>, sortedIdx: number[]): string => {
    if (!indices.has(i)) return colors.color;
    const accentIdx = sortedIdx.indexOf(i);
    return (
      colors.accents[accentIdx % Math.max(1, colors.accents.length)] ??
      colors.accents[0] ??
      '#FFE566'
    );
  };

  if (meta.highlightMode === 'karaoke_word') {
    const active =
      options?.activeWordIndex != null && Number.isFinite(options.activeWordIndex)
        ? Math.max(0, Math.min(words.length - 1, Math.floor(options.activeWordIndex)))
        : Math.min(words.length - 1, Math.floor(words.length / 2));
    const accent = colors.accents[0] ?? '#FFE566';
    const rows = wrapWordsToLines(words, 2);
    let offset = 0;
    return rows.map((row) => {
      const spans = row.map((w, j) => {
        const i = offset + j;
        return { text: w, color: i === active ? accent : colors.color };
      });
      offset += row.length;
      return spans;
    });
  }

  if (meta.highlightMode === 'cyan_phrase' || meta.highlightMode === 'stack_two_tone') {
    const rows = wrapWordsToLines(words, 2);
    const accent = colors.accents[0] ?? '#00E5FF';
    return rows.map((row, ri) => [
      {
        text: row.join(' '),
        color: ri === 0 ? colors.color : accent,
      },
    ]);
  }

  if (meta.highlightMode === 'none') {
    return wrapWordsToLines(words, 2).map((row) => [{ text: row.join(' '), color: colors.color }]);
  }

  const maxHl =
    meta.highlightMode === 'hormozi' ? 3 : meta.highlightMode === 'pink_pop' || meta.highlightMode === 'red_pop' ? 2 : 2;
  const indices = new Set(pickHighlightIndices(words, maxHl));
  const sortedIdx = [...indices].sort((a, b) => a - b);
  const rows = wrapWordsToLines(words, 2);
  let offset = 0;
  return rows.map((row) => {
    const spans = row.map((w, j) => {
      const i = offset + j;
      return { text: w, color: colorFor(w, i, indices, sortedIdx) };
    });
    offset += row.length;
    return spans;
  });
}

/** @deprecated Prefer previewCaptionLines — flat spans (single line). */
export function previewCaptionSpans(
  raw: string,
  templateId: unknown,
  options?: PreviewCaptionOptions,
): PreviewCaptionSpan[] {
  return previewCaptionLines(raw, templateId, options).flat();
}

/**
 * Format a cue as ASS text with inline color overrides.
 * Always wraps to at most 2 lines (`\\N`).
 * For karaoke_word, prefer `buildKaraokeAssCueEvents` (timed per-word dialogues).
 */
export function formatImpactAssText(
  raw: string,
  templateId: unknown,
  colorMode: CaptionColorMode = 'dark',
  activeWordIndex?: number | null,
): string {
  const meta = captionTemplateMeta(templateId);
  const colors = resolveCaptionColors(meta, normalizeCaptionColorMode(colorMode));
  const words = raw
    .trim()
    .toUpperCase()
    .replace(/[{}]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, CAPTION_MAX_WORDS);
  if (words.length === 0) return '';

  const base = assColor(colors.color);
  const reset = `{\\c${base}&}`;
  const rows = wrapWordsToLines(words, 2);

  if (meta.highlightMode === 'karaoke_word') {
    const active =
      activeWordIndex != null && Number.isFinite(activeWordIndex)
        ? Math.max(0, Math.min(words.length - 1, Math.floor(activeWordIndex)))
        : -1;
    const accent = assColor(colors.accents[0] ?? '#FFE566');
    let offset = 0;
    return rows
      .map((row) => {
        const line = row
          .map((w, j) => {
            const i = offset + j;
            return i === active ? `{\\c${accent}&}${w}${reset}` : w;
          })
          .join(' ');
        offset += row.length;
        return line;
      })
      .join('\\N');
  }

  if (meta.highlightMode === 'cyan_phrase' || meta.highlightMode === 'stack_two_tone') {
    const accent = assColor(colors.accents[0] ?? '#00E5FF');
    return rows
      .map((row, ri) => {
        const line = row.join(' ');
        return ri === 0 ? line : `{\\c${accent}&}${line}${reset}`;
      })
      .join('\\N');
  }

  if (meta.highlightMode === 'none') {
    return rows.map((row) => row.join(' ')).join('\\N');
  }

  const maxHl = meta.highlightMode === 'hormozi' ? 3 : 2;
  const indices = new Set(pickHighlightIndices(words, maxHl));
  const sortedIdx = [...indices].sort((a, b) => a - b);
  let offset = 0;
  return rows
    .map((row) => {
      const line = row
        .map((w, j) => {
          const i = offset + j;
          if (!indices.has(i)) return w;
          const accentIdx = sortedIdx.indexOf(i);
          const hex =
            colors.accents[accentIdx % Math.max(1, colors.accents.length)] ??
            colors.accents[0] ??
            '#FFE566';
          return `{\\c${assColor(hex)}&}${w}${reset}`;
        })
        .join(' ');
      offset += row.length;
      return line;
    })
    .join('\\N');
}

/**
 * Expand one SRT cue into timed ASS dialogues where each spoken word is highlighted
 * in turn (karaoke). Returns empty when the template is not karaoke_word.
 */
export function buildKaraokeAssCueEvents(
  cue: { startMs: number; endMs: number; text: string },
  templateId: unknown,
  colorMode: CaptionColorMode = 'dark',
): Array<{ startMs: number; endMs: number; text: string }> {
  const meta = captionTemplateMeta(templateId);
  if (meta.highlightMode !== 'karaoke_word') return [];
  const words = cue.text
    .trim()
    .toUpperCase()
    .replace(/[{}]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, CAPTION_MAX_WORDS);
  if (words.length === 0) return [];
  const span = Math.max(1, cue.endMs - cue.startMs);
  const slice = Math.max(80, Math.floor(span / words.length));
  const out: Array<{ startMs: number; endMs: number; text: string }> = [];
  for (let i = 0; i < words.length; i++) {
    const startMs = cue.startMs + i * slice;
    const endMs = i === words.length - 1 ? cue.endMs : Math.min(cue.endMs, startMs + slice);
    if (endMs <= startMs) continue;
    const text = formatImpactAssText(cue.text, templateId, colorMode, i);
    if (text) out.push({ startMs, endMs, text });
  }
  return out;
}

/** Style line fields for ffmpeg ASS burn-in. */
export function captionAssStyleFields(
  id: unknown,
  positionOverride?: OverlayPosition | string | number | null,
  colorMode: CaptionColorMode = 'dark',
): {
  name: string;
  fontSize: number;
  primary: string;
  outline: string;
  borderStyle: 1 | 3;
  outlineWidth: number;
  alignment: number;
  marginV: number;
  italic: boolean;
  shadow: number;
} {
  const meta = captionTemplateMeta(id);
  const colors = resolveCaptionColors(meta, normalizeCaptionColorMode(colorMode));
  const fontSize =
    meta.size === 'xl' ? 64 : meta.size === 'lg' ? 52 : meta.size === 'sm' ? 36 : 46;
  const defaultPos: OverlayPosition =
    meta.align === 'center' ? 'center' : meta.align === 'upper' ? 'upper' : 'bottom';
  const yPercent = normalizeOverlayYPercent(positionOverride, defaultPos);
  const { alignment, marginV } = overlayAssFromYPercent(yPercent, 1920, {
    fontSize,
    lineCount: 2,
  });
  return {
    name: 'Caption',
    fontSize,
    primary: assColor(colors.color),
    outline: assColor(colors.outline),
    borderStyle: meta.boxed ? 3 : 1,
    outlineWidth: meta.boxed ? 8 : meta.size === 'xl' ? 5 : 4,
    alignment,
    marginV,
    italic: meta.italic,
    shadow: meta.boxed ? 0 : 2,
  };
}

export function hookAssStyleFields(
  positionOverride?: OverlayPosition | string | number | null,
): {
  name: string;
  fontSize: number;
  primary: string;
  outline: string;
  borderStyle: 1;
  outlineWidth: number;
  alignment: number;
  marginV: number;
  italic: boolean;
  shadow: number;
} {
  const fontSize = 52;
  const yPercent = normalizeOverlayYPercent(positionOverride, 'top');
  const { alignment, marginV } = overlayAssFromYPercent(yPercent, 1920, {
    fontSize,
    lineCount: 2,
  });
  return {
    name: 'Hook',
    fontSize,
    primary: assColor('#FFFFFF'),
    outline: assColor('#000000'),
    borderStyle: 1,
    outlineWidth: 4,
    alignment,
    marginV,
    italic: false,
    shadow: 2,
  };
}
