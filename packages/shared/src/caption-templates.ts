/**
 * Viral overlay caption templates (Hormozi / Reels style) for ffmpeg ASS burn-in
 * and AI-tab CSS preview. Bold, all-caps, thick outline, word-level color pops.
 */
export const CAPTION_TEMPLATE_IDS = [
  'impact_center',
  'impact_hormozi',
  'impact_cyan',
  'impact_yellow',
  'boxed_white',
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

export type CaptionHighlightMode = 'none' | 'hormozi' | 'cyan_phrase' | 'yellow_pop';

export type CaptionTemplateMeta = {
  id: CaptionTemplateId;
  label: string;
  description: string;
  /** Preview placement for the CSS mock on the original video. */
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
  ['impact_hormozi', 'impact_cyan', 'impact_center', 'impact_yellow', 'boxed_white'].includes(
    t.id,
  ),
);

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

/** Split caption into colored spans for the live CSS preview. */
export function previewCaptionSpans(
  raw: string,
  templateId: unknown,
): PreviewCaptionSpan[] {
  const meta = captionTemplateMeta(templateId);
  const words = raw
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];

  if (meta.highlightMode === 'none') {
    return [{ text: words.join(' '), color: meta.color }];
  }

  if (meta.highlightMode === 'cyan_phrase') {
    // First half white, second half cyan (like "YEAH DUDE" / "IT'S CRAZY").
    const mid = Math.max(1, Math.ceil(words.length / 2));
    const first = words.slice(0, mid).join(' ');
    const second = words.slice(mid).join(' ');
    const spans: PreviewCaptionSpan[] = [{ text: first, color: meta.color }];
    if (second) spans.push({ text: second, color: meta.accents[0] ?? '#00E5FF' });
    return spans;
  }

  const indices = new Set(pickHighlightIndices(words, meta.highlightMode === 'hormozi' ? 3 : 2));
  return words.map((w, i) => {
    if (!indices.has(i)) return { text: w, color: meta.color };
    const accentIdx = [...indices].indexOf(i);
    const accent =
      meta.accents[accentIdx % Math.max(1, meta.accents.length)] ?? meta.accents[0] ?? '#FFE566';
    return { text: w, color: accent };
  });
}

/**
 * Format a cue as ASS text with inline color overrides for impact templates.
 * Output is already escaped for ASS (no raw `{` / `}` except override tags).
 */
export function formatImpactAssText(raw: string, templateId: unknown): string {
  const meta = captionTemplateMeta(templateId);
  const words = raw
    .trim()
    .toUpperCase()
    .replace(/[{}]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '';

  const base = assColor(meta.color);
  const reset = `{\\c${base}&}`;

  if (meta.highlightMode === 'none') {
    return words.join(' ');
  }

  if (meta.highlightMode === 'cyan_phrase') {
    const mid = Math.max(1, Math.ceil(words.length / 2));
    const first = words.slice(0, mid).join(' ');
    const second = words.slice(mid).join(' ');
    if (!second) return first;
    const accent = assColor(meta.accents[0] ?? '#00E5FF');
    return `${first}\\N{\\c${accent}&}${second}${reset}`;
  }

  const indices = new Set(pickHighlightIndices(words, meta.highlightMode === 'hormozi' ? 3 : 2));
  const sortedIdx = [...indices].sort((a, b) => a - b);
  return words
    .map((w, i) => {
      if (!indices.has(i)) return w;
      const accentIdx = sortedIdx.indexOf(i);
      const hex =
        meta.accents[accentIdx % Math.max(1, meta.accents.length)] ?? meta.accents[0] ?? '#FFE566';
      return `{\\c${assColor(hex)}&}${w}${reset}`;
    })
    .join(' ');
}

/** Style line fields for ffmpeg ASS burn-in. */
export function captionAssStyleFields(id: unknown): {
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
  const fontSize =
    meta.size === 'xl' ? 68 : meta.size === 'lg' ? 56 : meta.size === 'sm' ? 36 : 48;
  const alignment = meta.align === 'center' ? 5 : meta.align === 'upper' ? 8 : 2;
  const marginV =
    meta.align === 'center' ? 0 : meta.align === 'upper' ? 220 : meta.boxed ? 70 : 90;
  return {
    name: 'Caption',
    fontSize,
    primary: assColor(meta.color),
    outline: assColor(meta.outline),
    borderStyle: meta.boxed ? 3 : 1,
    outlineWidth: meta.boxed ? 8 : meta.size === 'xl' ? 5 : 4,
    alignment,
    marginV,
    italic: meta.italic,
    shadow: meta.boxed ? 0 : 2,
  };
}

export function hookAssStyleFields(): {
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
  return {
    name: 'Hook',
    fontSize: 56,
    primary: assColor('#FFFFFF'),
    outline: assColor('#000000'),
    borderStyle: 1,
    outlineWidth: 4,
    alignment: 8, // top-center
    marginV: 56,
    italic: false,
    shadow: 2,
  };
}
