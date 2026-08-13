/**
 * Per-channel TTS / voice settings stored on ChannelProfile.voiceSettings.
 * Edge Neural (edge-tts) is the product default; other providers remain fallbacks.
 */
import { z } from 'zod';

export const TTS_PROVIDERS = ['edge', 'kokoro', 'gemini', 'openai'] as const;
export type TtsProviderId = (typeof TTS_PROVIDERS)[number];

export const EDGE_DEFAULT_VOICE = 'en-US-AriaNeural';
export const EDGE_DEFAULT_LOCALE = 'en-US';

export const voiceSettingsSchema = z.object({
  provider: z.enum(TTS_PROVIDERS).default('edge'),
  voiceId: z.string().default(EDGE_DEFAULT_VOICE),
  /** BCP-47-ish locale filter for Edge voice picker (e.g. en-US). */
  locale: z.string().default(EDGE_DEFAULT_LOCALE),
  /** Edge-tts rate, e.g. "+0%" / "-10%". */
  rate: z.string().optional(),
  /** Edge-tts pitch, e.g. "+0Hz". */
  pitch: z.string().optional(),
  /** Edge-tts volume, e.g. "+0%". */
  volume: z.string().optional(),
  /** Numeric speed for Kokoro / Gemini (1.0 = normal). */
  speed: z.number().positive().optional(),
  language: z.string().optional(),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  provider: 'edge',
  voiceId: EDGE_DEFAULT_VOICE,
  locale: EDGE_DEFAULT_LOCALE,
};

/** Locale-aware Edge default when the channel language is known. */
export function defaultVoiceForLanguage(language?: string | null): VoiceSettings {
  const lang = (language ?? 'en').toLowerCase().split(/[-_]/)[0] ?? 'en';
  const map: Record<string, { locale: string; voiceId: string }> = {
    en: { locale: 'en-US', voiceId: 'en-US-AriaNeural' },
    es: { locale: 'es-ES', voiceId: 'es-ES-ElviraNeural' },
    ur: { locale: 'ur-PK', voiceId: 'ur-PK-UzmaNeural' },
    hi: { locale: 'hi-IN', voiceId: 'hi-IN-SwaraNeural' },
    fr: { locale: 'fr-FR', voiceId: 'fr-FR-DeniseNeural' },
    de: { locale: 'de-DE', voiceId: 'de-DE-KatjaNeural' },
    pt: { locale: 'pt-BR', voiceId: 'pt-BR-FranciscaNeural' },
    ar: { locale: 'ar-SA', voiceId: 'ar-SA-ZariyahNeural' },
    zh: { locale: 'zh-CN', voiceId: 'zh-CN-XiaoxiaoNeural' },
    ja: { locale: 'ja-JP', voiceId: 'ja-JP-NanamiNeural' },
    ko: { locale: 'ko-KR', voiceId: 'ko-KR-SunHiNeural' },
  };
  const hit = map[lang] ?? map.en!;
  return {
    provider: 'edge',
    voiceId: hit.voiceId,
    locale: hit.locale,
    language: lang,
  };
}

export function parseVoiceSettings(
  raw: unknown,
  fallbackLanguage?: string | null,
): VoiceSettings {
  const base = defaultVoiceForLanguage(fallbackLanguage);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const row = raw as Record<string, unknown>;
  const provider =
    typeof row.provider === 'string' && (TTS_PROVIDERS as readonly string[]).includes(row.provider)
      ? (row.provider as TtsProviderId)
      : base.provider;
  const voiceId =
    typeof row.voiceId === 'string' && row.voiceId.trim()
      ? row.voiceId.trim()
      : provider === 'edge'
        ? base.voiceId
        : 'default';
  return {
    provider,
    voiceId,
    locale:
      typeof row.locale === 'string' && row.locale.trim()
        ? row.locale.trim()
        : base.locale,
    ...(typeof row.rate === 'string' && row.rate ? { rate: row.rate } : {}),
    ...(typeof row.pitch === 'string' && row.pitch ? { pitch: row.pitch } : {}),
    ...(typeof row.volume === 'string' && row.volume ? { volume: row.volume } : {}),
    ...(typeof row.speed === 'number' && row.speed > 0 ? { speed: row.speed } : {}),
    ...(typeof row.language === 'string' && row.language
      ? { language: row.language }
      : base.language
        ? { language: base.language }
        : {}),
  };
}

/** Package pipeline stages for audio-first narration packages. */
export const PACKAGE_STAGES = [
  'NONE',
  'SCRIPT',
  'VOICE',
  'TRANSCRIPT',
  'VISUALS',
  'READY',
  'FAILED',
] as const;
export type PackageStage = (typeof PACKAGE_STAGES)[number];

export const PACKAGE_STAGE_LABELS: Record<PackageStage, string> = {
  NONE: 'Not started',
  SCRIPT: 'Writing title/script',
  VOICE: 'Generating voice',
  TRANSCRIPT: 'Creating timestamped transcript',
  VISUALS: 'Generating image/video prompts',
  READY: 'Package ready',
  FAILED: 'Failed',
};
