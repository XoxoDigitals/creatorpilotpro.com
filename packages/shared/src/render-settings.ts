/**
 * Per-account final-video render settings (nested under ChannelProfile.voiceSettings.renderSettings).
 * Each effect is off unless its `enabled` flag is true.
 */
import { z } from 'zod';
import {
  CAPTION_TEMPLATE_IDS,
  LEGACY_CAPTION_PRESETS,
  OVERLAY_POSITIONS,
  CAPTION_COLOR_MODES,
  normalizeCaptionTemplateId,
  normalizeOverlayPosition,
  normalizeCaptionColorMode,
  captionAssStyleFields,
} from './caption-templates.js';

export {
  CAPTION_TEMPLATE_IDS,
  CAPTION_TEMPLATES,
  CAPTION_TEMPLATE_PICKER,
  LEGACY_CAPTION_PRESETS,
  OVERLAY_POSITIONS,
  OVERLAY_POSITION_LABELS,
  OVERLAY_POSITION_Y_PERCENT,
  OVERLAY_OFF_ID,
  CAPTION_MAX_WORDS,
  CAPTION_PREVIEW_SAMPLE,
  captionPreviewFromNarration,
  CAPTION_COLOR_MODES,
  CAPTION_COLOR_MODE_LABELS,
  normalizeCaptionTemplateId,
  normalizeOverlayPosition,
  normalizeOverlayYPercent,
  clampOverlayYPercent,
  overlayAssFromYPercent,
  overlayPreviewTopPercent,
  overlayPositionFromYPercent,
  isOverlayOffId,
  normalizeCaptionColorMode,
  resolveCaptionColors,
  captionTemplateMeta,
  captionAssStyleFields,
  hookAssStyleFields,
  formatImpactAssText,
  buildKaraokeAssCueEvents,
  previewCaptionSpans,
  previewCaptionLines,
  pickHighlightIndices,
  wrapWordsToLines,
  assColor,
  type CaptionTemplateId,
  type CaptionPreset,
  type CaptionTemplateMeta,
  type PreviewCaptionSpan,
  type OverlayPosition,
  type CaptionColorMode,
} from './caption-templates.js';

/** @deprecated Prefer CaptionTemplateId — kept for older imports. */
export const CAPTION_PRESETS = [...CAPTION_TEMPLATE_IDS, ...LEGACY_CAPTION_PRESETS] as const;
export type CaptionPresetCompat = (typeof CAPTION_PRESETS)[number];

export const COLOR_FILTER_PRESETS = ['none', 'vivid', 'warm', 'cool', 'contrast'] as const;
export type ColorFilterPreset = (typeof COLOR_FILTER_PRESETS)[number];

export const COLOR_FILTER_LABELS: Record<ColorFilterPreset, string> = {
  none: 'None',
  vivid: 'Vivid',
  warm: 'Warm',
  cool: 'Cool',
  contrast: 'Contrast',
};

/** CSS filter approximating ffmpeg color presets for live AI-panel preview. */
export function colorFilterCss(preset: ColorFilterPreset | string | null | undefined): string {
  switch (preset) {
    case 'vivid':
      return 'saturate(1.35) contrast(1.08)';
    case 'warm':
      return 'sepia(0.22) saturate(1.2) brightness(1.03)';
    case 'cool':
      return 'saturate(0.95) hue-rotate(195deg) brightness(1.02)';
    case 'contrast':
      return 'contrast(1.22) saturate(1.05)';
    case 'none':
    default:
      return 'none';
  }
}

export function normalizeColorFilterPreset(raw: unknown): ColorFilterPreset {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if ((COLOR_FILTER_PRESETS as readonly string[]).includes(s)) return s as ColorFilterPreset;
  return 'none';
}

/** `options` = per-video pick at script approval; `title` / `custom` = account defaults. */
export const HOOK_TEXT_SOURCES = ['options', 'title', 'custom'] as const;
export type HookTextSource = (typeof HOOK_TEXT_SOURCES)[number];

export type HookTextVariant = { id: string; text: string };

export const DEFAULT_TRIM_START_MS = 500;

const captionPresetSchema = z
  .string()
  .default('bottom_white')
  .transform((v) => normalizeCaptionTemplateId(v));

const overlayPositionSchema = z
  .enum(OVERLAY_POSITIONS)
  .or(z.string())
  .transform((v) => normalizeOverlayPosition(v, 'center'));

export const renderSettingsSchema = z.object({
  trimStartMs: z.number().int().min(0).max(60_000).default(DEFAULT_TRIM_START_MS),
  /** Full dialogue / VO captions burned from SRT/ASS (max 2 lines). */
  burnCaptions: z
    .object({
      enabled: z.boolean().default(false),
      preset: captionPresetSchema,
      /** Vertical placement override (upper / center / lower / …). */
      position: overlayPositionSchema.default('center'),
      /** Light text (dark mode) vs dark text (light mode). */
      colorMode: z
        .enum(CAPTION_COLOR_MODES)
        .or(z.string())
        .transform((v) => normalizeCaptionColorMode(v))
        .default('dark'),
      fontSize: z.number().int().min(12).max(72).optional(),
      primaryColor: z.string().optional(),
      outlineColor: z.string().optional(),
    })
    .default({ enabled: false, preset: 'impact_hormozi', position: 'center', colorMode: 'dark' }),
  /** Short attention hook at top (1–2 lines, up to ~8–12 words). */
  hookText: z
    .object({
      enabled: z.boolean().default(false),
      source: z.enum(HOOK_TEXT_SOURCES).default('options'),
      customText: z.string().max(96).optional(),
      /** Soft cap when auto-deriving; selected options may be longer. */
      maxWords: z.number().int().min(1).max(12).default(8),
      maxLines: z.number().int().min(1).max(3).default(2),
      position: z
        .enum(OVERLAY_POSITIONS)
        .or(z.string())
        .transform((v) => normalizeOverlayPosition(v, 'top'))
        .default('top'),
      fontSize: z.number().int().min(24).max(96).optional(),
    })
    .default({ enabled: false, source: 'options', maxWords: 8, maxLines: 2, position: 'top' }),
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
  /**
   * Corner reaction / talking-head PiP. Upload a silent face image/clip and/or
   * a lip-sync (talking-head) video; ffmpeg overlays it (no ML lip-sync).
   * Prefer lipSyncAssetPath when present, else assetPath.
   * Background removal: rembg (ML) and/or ffmpeg chromakey (green screen).
   */
  reactionAvatar: z
    .object({
      enabled: z.boolean().default(false),
      /** Silent / still reaction — path relative to STORAGE_ROOT. */
      assetPath: z.string().max(500).optional(),
      /** Talking-head / lip-sync video preferred during dialogue windows. */
      lipSyncAssetPath: z.string().max(500).optional(),
      fileName: z.string().max(200).optional(),
      lipSyncFileName: z.string().max(200).optional(),
      mimeType: z.string().max(100).optional(),
      lipSyncMimeType: z.string().max(100).optional(),
      shape: z.enum(['circle', 'square', 'rounded']).default('circle'),
      corner: z.enum(['br', 'bl', 'tr', 'tl']).default('br'),
      /** Width as % of video width (12–40). */
      sizePercent: z.number().int().min(12).max(40).default(22),
      /**
       * `dialogue` (default): PiP only during speaking windows; reaction source trimmed to
       * sum(speaking) — unused clip tail is cut. Falls back to VO/subtitle cues, else ~5s lead-in.
       * `always`: visible for full video; still trims reaction source to main duration.
       */
      showDuring: z.enum(['dialogue', 'always']).default('dialogue'),
      /**
       * `auto` = rembg if installed, else chromakey; `rembg` / `chromakey` force one path;
       * `off` = overlay original (no remove-bg).
       */
      removeBg: z.enum(['auto', 'rembg', 'chromakey', 'off']).default('auto'),
      /** Hex key color for ffmpeg chromakey/colorkey (default chroma green). */
      chromakeyColor: z
        .string()
        .optional()
        .transform((v) => {
          const raw = (v ?? '').trim();
          const m = raw.match(/^#?([0-9A-Fa-f]{6})$/);
          return m ? `#${m[1]!.toUpperCase()}` : '#00B140';
        }),
      /** 0–1 similarity for colorkey (higher = more aggressive). */
      chromakeySimilarity: z.number().min(0.01).max(1).default(0.3),
      /** 0–1 edge blend for colorkey. */
      chromakeyBlend: z.number().min(0).max(1).default(0.1),
    })
    .default({
      enabled: false,
      shape: 'circle',
      corner: 'br',
      sizePercent: 22,
      showDuring: 'dialogue',
      removeBg: 'auto',
      chromakeyColor: '#00B140',
      chromakeySimilarity: 0.3,
      chromakeyBlend: 0.1,
    }),
});

export type RenderSettings = z.infer<typeof renderSettingsSchema>;

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  trimStartMs: DEFAULT_TRIM_START_MS,
  burnCaptions: { enabled: false, preset: 'impact_hormozi', position: 'center', colorMode: 'dark' },
  hookText: { enabled: false, source: 'options', maxWords: 8, maxLines: 2, position: 'top' },
  flipHorizontal: { enabled: false },
  colorFilter: { enabled: false, preset: 'none' },
  reactionAvatar: {
    enabled: false,
    shape: 'circle',
    corner: 'br',
    sizePercent: 22,
    showDuring: 'dialogue',
    removeBg: 'auto',
    chromakeyColor: '#00B140',
    chromakeySimilarity: 0.3,
    chromakeyBlend: 0.1,
  },
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
 * Turn text into an on-screen hook (uppercase). Supports 1–2 lines and longer phrases.
 */
export function shortenToHookWords(raw: string, maxWords = 8, maxLines = 2): string {
  const cleaned = raw
    .replace(/[#@]/g, ' ')
    .replace(/\|/g, '\n')
    .replace(/[^\p{L}\p{N}\s'\-\n]/gu, ' ')
    .trim();
  if (!cleaned) return '';
  // Preserve explicit multi-line input.
  if (cleaned.includes('\n')) {
    const lines = cleaned
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(3, maxLines)));
    return lines
      .map((l) =>
        l
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, maxWords)
          .join(' ')
          .toUpperCase(),
      )
      .filter(Boolean)
      .join('\n');
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  const n = Math.max(1, Math.min(12, maxWords));
  const limited = words.slice(0, n);
  if (maxLines <= 1 || limited.length <= 4) {
    return limited.join(' ').toUpperCase();
  }
  const mid = Math.ceil(limited.length / 2);
  return [limited.slice(0, mid).join(' '), limited.slice(mid).join(' ')]
    .filter(Boolean)
    .join('\n')
    .toUpperCase();
}

/**
 * Build hook options for script approval: short, medium, long, and 2-line variants.
 */
export function buildHookTextVariants(input: {
  title?: string | null;
  variantHooks?: Array<string | null | undefined>;
  overlayHooks?: Array<string | null | undefined>;
  maxWords?: number;
  maxOptions?: number;
}): HookTextVariant[] {
  const maxWords = Math.max(3, Math.min(12, input.maxWords ?? 8));
  const maxOptions = Math.max(3, Math.min(8, input.maxOptions ?? 6));
  const seen = new Set<string>();
  const out: HookTextVariant[] = [];

  const push = (raw: string | null | undefined, words = maxWords, lines = 2) => {
    if (out.length >= maxOptions) return;
    const text = shortenToHookWords(raw ?? '', words, lines);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push({ id: `hook-${out.length + 1}`, text });
  };

  for (const h of input.overlayHooks ?? []) push(h, maxWords, 2);
  for (const h of input.variantHooks ?? []) push(h, Math.min(6, maxWords), 2);

  // Title windows: short / medium / long / 2-line.
  push(input.title, 3, 1);
  push(input.title, 5, 1);
  push(input.title, maxWords, 2);

  const titleWords = (input.title ?? '')
    .replace(/[#@]/g, ' ')
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let start = 1; out.length < maxOptions && start + 2 < titleWords.length; start++) {
    push(titleWords.slice(start, start + Math.min(6, maxWords)).join(' '), 6, 2);
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
  const maxWords = settings.maxWords ?? 8;
  const maxLines = settings.maxLines ?? 2;
  if (settings.source === 'custom') {
    const custom = (settings.customText ?? '').trim();
    if (!custom) return null;
    return (
      shortenToHookWords(custom, maxWords, maxLines) || custom.toUpperCase().slice(0, 96)
    );
  }
  if (settings.source === 'options') {
    const picked = (selectedText ?? '').trim();
    if (picked) {
      // Keep the owner's pick nearly as-is (still uppercase / light wrap).
      return (
        shortenToHookWords(picked, Math.max(maxWords, 12), maxLines) ||
        picked.toUpperCase().slice(0, 96)
      );
    }
  }
  const fromTitle = shortenToHookWords(contentTitle ?? '', maxWords, maxLines);
  return fromTitle || null;
}

/** ASS force_style fragment for burned captions (legacy subtitles= path). */
export function captionForceStyle(settings: RenderSettings['burnCaptions']): string {
  const style = captionAssStyleFields(settings.preset, settings.position, settings.colorMode);
  const fontSize = settings.fontSize ?? style.fontSize;
  const primary = settings.primaryColor?.trim() || style.primary;
  const outline = settings.outlineColor?.trim() || style.outline;
  return [
    `FontName=Arial`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${primary}`,
    `OutlineColour=${outline}`,
    `BorderStyle=${style.borderStyle}`,
    `Outline=${style.outlineWidth}`,
    `Shadow=0`,
    `Alignment=${style.alignment}`,
    `MarginV=${style.marginV}`,
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

/** Canonical vertical canvas for FB / TikTok / YouTube Shorts (ASS PlayRes match). */
export const VERTICAL_9x16_WIDTH = 1080;
export const VERTICAL_9x16_HEIGHT = 1920;

/** Per-video YouTube format in the REPURPOSED (copyright) AI pipeline. */
export const YOUTUBE_FORMATS = ['SHORT', 'LONG'] as const;
export type YoutubeFormat = (typeof YOUTUBE_FORMATS)[number];

export const YOUTUBE_FORMAT_LABELS: Record<YoutubeFormat, string> = {
  SHORT: 'Short (9:16)',
  LONG: 'Long (source format)',
};

export function normalizeYoutubeFormat(raw: unknown): YoutubeFormat | null {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (s === 'SHORT' || s === 'LONG') return s;
  return null;
}

/**
 * ffmpeg scale+pad to a centered 9:16 black canvas (letterbox / pillarbox).
 * Apply after flip/color and before burned captions so overlays match the canvas.
 */
export function letterboxVertical9x16Filter(
  width: number = VERTICAL_9x16_WIDTH,
  height: number = VERTICAL_9x16_HEIGHT,
): string {
  return (
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`
  );
}

/**
 * Force 9:16 output for Facebook / TikTok always; for YouTube only when Short
 * (default Short when unset — Long keeps source aspect).
 */
export function shouldForceVertical9x16(input: {
  platform: string | null | undefined;
  youtubeFormat?: string | null;
}): boolean {
  const platform = (input.platform ?? '').toUpperCase();
  if (platform === 'FACEBOOK' || platform === 'TIKTOK') return true;
  if (platform === 'YOUTUBE') {
    const fmt = normalizeYoutubeFormat(input.youtubeFormat) ?? 'SHORT';
    return fmt === 'SHORT';
  }
  return false;
}

export type FinalVideoEffectsInput = {
  settings: RenderSettings;
  /** Preferred: single ASS file with hook + caption dialogues (ffmpeg `ass=`). */
  assPath?: string | null;
  /** Absolute path to an SRT/ASS file when burnCaptions is enabled (legacy). */
  subtitlePath?: string | null;
  /** Short hook phrase when hookText is enabled (legacy drawtext). */
  hookOverlayText?: string | null;
  /** Absolute font file for ffmpeg drawtext (required on many Linux hosts). */
  fontFile?: string | null;
  /** Letterbox/pillarbox to 1080×1920 black canvas, video centered. */
  forceVertical9x16?: boolean;
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

  if (input.forceVertical9x16) {
    parts.push(letterboxVertical9x16Filter());
  }

  if (input.assPath?.trim()) {
    const escaped = escapeFfmpegSubtitlesPath(input.assPath.trim());
    parts.push(`ass='${escaped}'`);
  } else {
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
      const style = captionForceStyle(settings.burnCaptions)
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'");
      parts.push(`subtitles='${escaped}':force_style='${style}'`);
    }
  }

  return parts.join(',');
}

/** True when render should re-process the muxed file (trim and/or visual effects). */
export function finalVideoEffectsEnabled(
  settings: RenderSettings,
  subtitlePath?: string | null,
  hookOverlayText?: string | null,
  assPath?: string | null,
  forceVertical9x16?: boolean,
): boolean {
  if (forceVertical9x16) return true;
  if (settings.trimStartMs > 0) return true;
  if (settings.flipHorizontal.enabled) return true;
  if (settings.colorFilter.enabled && settings.colorFilter.preset !== 'none') return true;
  if (assPath?.trim()) return true;
  if (settings.hookText.enabled && !!hookOverlayText?.trim()) return true;
  if (settings.burnCaptions.enabled && !!subtitlePath) return true;
  return false;
}

/**
 * Progressive `-vf` fallbacks: drop ASS/text overlays last so flip/color/trim
 * still apply when libass fails.
 */
export function buildFinalVideoFilterFallbacks(input: FinalVideoEffectsInput): string[] {
  const full = buildFinalVideoFilterChain(input);
  const noAss = buildFinalVideoFilterChain({
    ...input,
    assPath: null,
    hookOverlayText: null,
    subtitlePath: null,
  });
  const noHook = buildFinalVideoFilterChain({
    ...input,
    assPath: null,
    hookOverlayText: null,
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const vf of [full, noHook, noAss]) {
    if (seen.has(vf)) continue;
    seen.add(vf);
    out.push(vf);
  }
  return out;
}
