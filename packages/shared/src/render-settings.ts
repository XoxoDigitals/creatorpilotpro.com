/**
 * Per-account final-video render settings (nested under ChannelProfile.voiceSettings.renderSettings).
 * Each effect is off unless its `enabled` flag is true.
 */
import { z } from 'zod';

export const CAPTION_PRESETS = ['bottom', 'center', 'karaoke'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

export const COLOR_FILTER_PRESETS = ['none', 'vivid', 'warm', 'cool', 'contrast'] as const;
export type ColorFilterPreset = (typeof COLOR_FILTER_PRESETS)[number];

/** `options` = per-video pick at script approval; `title` / `custom` = account defaults. */
export const HOOK_TEXT_SOURCES = ['options', 'title', 'custom'] as const;
export type HookTextSource = (typeof HOOK_TEXT_SOURCES)[number];

export type HookTextVariant = { id: string; text: string };

export const DEFAULT_TRIM_START_MS = 500;

export const renderSettingsSchema = z.object({
  trimStartMs: z.number().int().min(0).max(60_000).default(DEFAULT_TRIM_START_MS),
  /** Full dialogue / VO captions burned from SRT (usually bottom). */
  burnCaptions: z
    .object({
      enabled: z.boolean().default(false),
      preset: z.enum(CAPTION_PRESETS).default('bottom'),
      fontSize: z.number().int().min(12).max(72).optional(),
      primaryColor: z.string().optional(),
      outlineColor: z.string().optional(),
    })
    .default({ enabled: false, preset: 'bottom' }),
  /** Short 2–3 word attention hook at top-center (separate from captions). */
  hookText: z
    .object({
      enabled: z.boolean().default(false),
      source: z.enum(HOOK_TEXT_SOURCES).default('options'),
      /** Used when source=custom; otherwise derived from the video title. */
      customText: z.string().max(48).optional(),
      maxWords: z.number().int().min(1).max(5).default(3),
      fontSize: z.number().int().min(24).max(96).optional(),
    })
    .default({ enabled: false, source: 'options', maxWords: 3 }),
  flipHorizontal: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
  colorFilter: z
    .object({
      enabled: z.boolean().default(false),
      preset: z.enum(COLOR_FILTER_PRESETS).default('none'),
    })
    .default({ enabled: false, preset: 'none' }),
});

export type RenderSettings = z.infer<typeof renderSettingsSchema>;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  trimStartMs: DEFAULT_TRIM_START_MS,
  burnCaptions: { enabled: false, preset: 'bottom' },
  hookText: { enabled: false, source: 'options', maxWords: 3 },
  flipHorizontal: { enabled: false },
  colorFilter: { enabled: false, preset: 'none' },
};

export function parseRenderSettings(raw: unknown): RenderSettings {
  const nested =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).renderSettings !== undefined
        ? (raw as Record<string, unknown>).renderSettings
        : raw
      : null;
  const parsed = renderSettingsSchema.safeParse(nested ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_RENDER_SETTINGS };
}

/** Extract render settings from a ChannelProfile.voiceSettings blob. */
export function renderSettingsFromVoiceSettings(voiceSettings: unknown): RenderSettings {
  if (!voiceSettings || typeof voiceSettings !== 'object' || Array.isArray(voiceSettings)) {
    return { ...DEFAULT_RENDER_SETTINGS };
  }
  return parseRenderSettings((voiceSettings as Record<string, unknown>).renderSettings);
}

export function clampTrimStartMs(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_TRIM_START_MS;
  return Math.max(0, Math.min(60_000, Math.round(n)));
}

/** Prefer account trim, then watched-source trim, then 500ms. */
export function resolveTrimStartMs(opts: {
  accountTrimMs?: number | null;
  sourceTrimMs?: number | null;
}): number {
  if (opts.accountTrimMs != null && Number.isFinite(opts.accountTrimMs)) {
    return clampTrimStartMs(opts.accountTrimMs);
  }
  if (opts.sourceTrimMs != null && Number.isFinite(opts.sourceTrimMs)) {
    return clampTrimStartMs(opts.sourceTrimMs);
  }
  return DEFAULT_TRIM_START_MS;
}

/** Escape a filesystem path for ffmpeg `subtitles=` filter (Windows-safe). */
export function escapeFfmpegSubtitlesPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Escape text for ffmpeg `drawtext=text=...`. */
export function escapeFfmpegDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

/**
 * Turn a title into a short attention hook (default 2–3 words, uppercase).
 */
export function shortenToHookWords(raw: string, maxWords = 3): string {
  const cleaned = raw
    .replace(/[#@]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim();
  if (!cleaned) return '';
  const words = cleaned.split(/\s+/).filter(Boolean);
  const n = Math.max(1, Math.min(5, maxWords));
  return words.slice(0, n).join(' ').toUpperCase();
}

/**
 * Build 3–4 unique short hook phrases for the script-approval picker.
 * Prefers AI `overlayHooks`, then narration variant hooks, then the title.
 */
export function buildHookTextVariants(input: {
  title?: string | null;
  variantHooks?: Array<string | null | undefined>;
  overlayHooks?: Array<string | null | undefined>;
  maxWords?: number;
  maxOptions?: number;
}): HookTextVariant[] {
  const maxWords = input.maxWords ?? 3;
  const maxOptions = Math.max(2, Math.min(6, input.maxOptions ?? 4));
  const seen = new Set<string>();
  const out: HookTextVariant[] = [];

  const push = (raw: string | null | undefined) => {
    if (out.length >= maxOptions) return;
    const text = shortenToHookWords(raw ?? '', maxWords);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ id: `hook-${out.length + 1}`, text });
  };

  for (const h of input.overlayHooks ?? []) push(h);
  for (const h of input.variantHooks ?? []) push(h);
  push(input.title);

  // If we still need fillers, take alternate word windows from the title.
  const titleWords = (input.title ?? '')
    .replace(/[#@]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let start = 1; out.length < maxOptions && start + 1 < titleWords.length; start++) {
    push(titleWords.slice(start, start + maxWords).join(' '));
  }

  return out;
}

/** Resolve the on-video hook string from settings + optional per-video selection. */
export function resolveHookOverlayText(
  settings: RenderSettings['hookText'],
  contentTitle: string | null | undefined,
  selectedText?: string | null,
): string | null {
  if (!settings.enabled) return null;
  if (settings.source === 'custom') {
    const custom = (settings.customText ?? '').trim();
    if (!custom) return null;
    return shortenToHookWords(custom, settings.maxWords ?? 3) || custom.toUpperCase().slice(0, 48);
  }
  if (settings.source === 'options') {
    const picked = (selectedText ?? '').trim();
    if (picked) {
      return (
        shortenToHookWords(picked, settings.maxWords ?? 3) ||
        picked.toUpperCase().slice(0, 48)
      );
    }
  }
  const fromTitle = shortenToHookWords(contentTitle ?? '', settings.maxWords ?? 3);
  return fromTitle || null;
}

/** ASS force_style fragment for burned captions. */
export function captionForceStyle(settings: RenderSettings['burnCaptions']): string {
  const preset = settings.preset ?? 'bottom';
  const fontSize =
    settings.fontSize ??
    (preset === 'karaoke' ? 28 : preset === 'center' ? 26 : 22);
  const primary = settings.primaryColor?.trim() || '&H00FFFFFF';
  const outline = settings.outlineColor?.trim() || '&H00000000';
  const alignment = preset === 'center' ? 5 : 2;
  const marginV = preset === 'center' ? 0 : preset === 'karaoke' ? 80 : 60;
  return [
    `FontName=Arial`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `BorderStyle=1`,
    `Outline=2`,
    `Shadow=0`,
    `Alignment=${alignment}`,
    `MarginV=${marginV}`,
  ].join(',');
}

/** ffmpeg `eq=` (or empty) for color presets. */
export function colorFilterExpr(preset: ColorFilterPreset): string | null {
  switch (preset) {
    case 'vivid':
      return 'eq=saturation=1.25:contrast=1.08';
    case 'warm':
      return 'eq=saturation=1.1:gamma_r=1.05:gamma_b=0.95';
    case 'cool':
      return 'eq=saturation=1.05:gamma_b=1.08:gamma_r=0.95';
    case 'contrast':
      return 'eq=contrast=1.15:brightness=0.02';
    default:
      return null;
  }
}

export type FinalVideoEffectsInput = {
  settings: RenderSettings;
  /** Absolute path to an SRT/ASS file when burnCaptions is enabled. */
  subtitlePath?: string | null;
  /** Short hook phrase when hookText is enabled. */
  hookOverlayText?: string | null;
  /** Absolute font file for ffmpeg drawtext (required on many Linux hosts). */
  fontFile?: string | null;
};

/**
 * Build a comma-joined `-vf` chain. Empty string means no *filter* re-encode is
 * needed (caller may still apply trim via `-ss`).
 */
export function buildFinalVideoFilterChain(input: FinalVideoEffectsInput): string {
  const { settings } = input;
  const parts: string[] = [];

  if (settings.flipHorizontal.enabled) {
    parts.push('hflip');
  }

  if (settings.colorFilter.enabled) {
    const eq = colorFilterExpr(settings.colorFilter.preset);
    if (eq) parts.push(eq);
  }

  if (settings.hookText.enabled && input.hookOverlayText?.trim()) {
    const text = escapeFfmpegDrawtext(input.hookOverlayText.trim());
    const fontSize = settings.hookText.fontSize ?? 52;
    const fontOpt = input.fontFile?.trim()
      ? `:fontfile='${escapeFfmpegSubtitlesPath(input.fontFile.trim())}'`
      : '';
    parts.push(
      `drawtext=text='${text}'${fontOpt}:fontsize=${fontSize}:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.07`,
    );
  }

  if (settings.burnCaptions.enabled && input.subtitlePath) {
    const escaped = escapeFfmpegSubtitlesPath(input.subtitlePath);
    const style = captionForceStyle(settings.burnCaptions).replace(/:/g, '\\:').replace(/'/g, "\\'");
    parts.push(`subtitles='${escaped}':force_style='${style}'`);
  }

  return parts.join(',');
}

/** True when render should re-process the muxed file (trim and/or visual effects). */
export function finalVideoEffectsEnabled(
  settings: RenderSettings,
  subtitlePath?: string | null,
  hookOverlayText?: string | null,
): boolean {
  if (settings.trimStartMs > 0) return true;
  if (settings.flipHorizontal.enabled) return true;
  if (settings.colorFilter.enabled && settings.colorFilter.preset !== 'none') return true;
  if (settings.hookText.enabled && !!hookOverlayText?.trim()) return true;
  if (settings.burnCaptions.enabled && !!subtitlePath) return true;
  return false;
}

/**
 * Progressive `-vf` fallbacks: drop hook drawtext, then captions, so flip/color/trim
 * still apply when a host lacks fonts or libass fails a subtitle path.
 */
export function buildFinalVideoFilterFallbacks(input: FinalVideoEffectsInput): string[] {
  const full = buildFinalVideoFilterChain(input);
  const noHook = buildFinalVideoFilterChain({ ...input, hookOverlayText: null });
  const noSubs = buildFinalVideoFilterChain({
    ...input,
    hookOverlayText: null,
    subtitlePath: null,
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const vf of [full, noHook, noSubs]) {
    if (seen.has(vf)) continue;
    seen.add(vf);
    out.push(vf);
  }
  return out;
}
