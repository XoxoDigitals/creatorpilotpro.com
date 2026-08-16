/**
 * Per-account final-video render settings (nested under ChannelProfile.voiceSettings.renderSettings).
 * Each effect is off unless its `enabled` flag is true.
 */
import { z } from 'zod';

export const CAPTION_PRESETS = ['bottom', 'center', 'karaoke'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

export const COLOR_FILTER_PRESETS = ['none', 'vivid', 'warm', 'cool', 'contrast'] as const;
export type ColorFilterPreset = (typeof COLOR_FILTER_PRESETS)[number];

export const DEFAULT_TRIM_START_MS = 500;

export const renderSettingsSchema = z.object({
  trimStartMs: z.number().int().min(0).max(60_000).default(DEFAULT_TRIM_START_MS),
  burnCaptions: z
    .object({
      enabled: z.boolean().default(false),
      preset: z.enum(CAPTION_PRESETS).default('bottom'),
      fontSize: z.number().int().min(12).max(72).optional(),
      primaryColor: z.string().optional(),
      outlineColor: z.string().optional(),
    })
    .default({ enabled: false, preset: 'bottom' }),
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
};

/**
 * Build a comma-joined `-vf` chain. Empty string means no video re-encode needed
 * for effects (caller may still loudnorm audio with -c:v copy).
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

  if (settings.burnCaptions.enabled && input.subtitlePath) {
    const escaped = escapeFfmpegSubtitlesPath(input.subtitlePath);
    const style = captionForceStyle(settings.burnCaptions).replace(/:/g, '\\:').replace(/'/g, "\\'");
    parts.push(`subtitles='${escaped}':force_style='${style}'`);
  }

  return parts.join(',');
}

export function finalVideoEffectsEnabled(settings: RenderSettings, subtitlePath?: string | null): boolean {
  if (settings.flipHorizontal.enabled) return true;
  if (settings.colorFilter.enabled && settings.colorFilter.preset !== 'none') return true;
  if (settings.burnCaptions.enabled && !!subtitlePath) return true;
  return false;
}
