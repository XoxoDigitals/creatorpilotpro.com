/**
 * Per-channel TTS / voice settings stored on ChannelProfile.voiceSettings.
 * Edge Neural (edge-tts) is the product default; other providers remain fallbacks.
 */
import { z } from 'zod';
import { resolveContentLanguage } from './content-languages.js';

export const TTS_PROVIDERS = ['edge', 'kokoro', 'gemini', 'openai'] as const;
export type TtsProviderId = (typeof TTS_PROVIDERS)[number];

export const EDGE_DEFAULT_VOICE = 'en-US-AriaNeural';
export const EDGE_DEFAULT_LOCALE = 'en-US';

/**
 * Per-line speaking emotion. Chosen from the scene situation (not a channel-wide
 * mood). Edge CLI has no mstts:express-as, so delivery is rate/pitch/speed plus
 * wording. Folded into AI cache keys via SPEECH_EMOTION_RULES_REV.
 */
export const SPEECH_EMOTION_RULES_REV = 2;

export const TTS_EMOTIONS = [
  'default',
  'cheerful',
  'excited',
  'calm',
  'empathetic',
  'sad',
  'angry',
  'newscast',
] as const;
export type TtsEmotion = (typeof TTS_EMOTIONS)[number];

export const TTS_EMOTION_LABELS: Record<TtsEmotion, string> = {
  default: 'Neutral',
  cheerful: 'Cheerful',
  excited: 'Excited',
  calm: 'Calm',
  empathetic: 'Empathetic',
  sad: 'Sad',
  angry: 'Angry',
  newscast: 'Newscast',
};

/** How the LLM should write spoken scripts for each emotion. */
export const TTS_EMOTION_NARRATION_HINTS: Record<TtsEmotion, string> = {
  default:
    'Natural storytelling energy. Clear and conversational — not flat, not overacted.',
  cheerful:
    'Warm, upbeat, smiling through the words. Light bounce; keep it genuine, not cartoonish.',
  excited:
    'High energy and urgency. Punchy short sentences, as if this just happened.',
  calm: 'Steady, unhurried, reassuring. Longer breaths via commas and full stops.',
  empathetic:
    'Soft, caring, close to the listener. Acknowledge feeling without melodrama.',
  sad: 'Lower energy, slower cadence, weight on key words. Respectful, not theatrical weeping.',
  angry: 'Tight, clipped, intense. Controlled heat — do not shout every line.',
  newscast:
    'Crisp, authoritative, even pacing. Report the facts; let stakes live in the wording.',
};

/** Prosody offsets merged with the channel rate/pitch/speed at synth time. */
export const TTS_EMOTION_PROSODY: Record<
  TtsEmotion,
  { ratePercent: number; pitchHz: number; speedMul: number }
> = {
  default: { ratePercent: 0, pitchHz: 0, speedMul: 1 },
  cheerful: { ratePercent: 12, pitchHz: 8, speedMul: 1.08 },
  excited: { ratePercent: 18, pitchHz: 14, speedMul: 1.14 },
  calm: { ratePercent: -10, pitchHz: -4, speedMul: 0.92 },
  empathetic: { ratePercent: -6, pitchHz: -2, speedMul: 0.94 },
  sad: { ratePercent: -12, pitchHz: -8, speedMul: 0.9 },
  angry: { ratePercent: 10, pitchHz: 6, speedMul: 1.08 },
  newscast: { ratePercent: 6, pitchHz: 0, speedMul: 1.04 },
};

export function parseTtsEmotion(raw: unknown): TtsEmotion {
  if (typeof raw === 'string' && (TTS_EMOTIONS as readonly string[]).includes(raw)) {
    return raw as TtsEmotion;
  }
  return 'default';
}

export function ttsEmotionFromVoiceSettings(raw: unknown): TtsEmotion {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'default';
  return parseTtsEmotion((raw as Record<string, unknown>).emotion);
}

/** Fallback when the model omits emotion — keyword match on situation text. */
export function inferTtsEmotionFromSituation(
  ...parts: Array<string | null | undefined>
): TtsEmotion {
  const t = parts.filter(Boolean).join(' ').toLowerCase();
  if (!t.trim()) return 'default';
  if (/\b(furious|enraged|rage|yell|shout|scream|argument|fight|insult|betray|how dare)\b/.test(t)) {
    return 'angry';
  }
  if (/\b(cry|tears|grief|funeral|death|loss|heartbroken|mourn|goodbye)\b/.test(t)) {
    return 'sad';
  }
  if (/\b(wow|reveal|shock|win|victory|can't believe|just happened)\b/.test(t)) {
    return 'excited';
  }
  if (/\b(laugh|joke|happy|smile|reunion|cheerful|celebrate)\b/.test(t)) {
    return 'cheerful';
  }
  if (/\b(comfort|gentle|hug|care|empath|it's okay|i'm sorry)\b/.test(t)) {
    return 'empathetic';
  }
  if (/\b(news|report|headline|according to|official|breaking)\b/.test(t)) {
    return 'newscast';
  }
  if (/\b(calm|wait|quiet|still|breathe|plan|steady)\b/.test(t)) {
    return 'calm';
  }
  return 'default';
}

/**
 * Prefer a model-tagged emotion, then situation inference, then the channel
 * Voice-tab fallback. `default` from the model still yields to inference.
 */
export function resolveSpokenEmotion(
  tagged: unknown,
  fallback: TtsEmotion = 'default',
  ...situationParts: Array<string | null | undefined>
): TtsEmotion {
  const fromTag = parseTtsEmotion(tagged);
  if (fromTag !== 'default') return fromTag;
  const inferred = inferTtsEmotionFromSituation(...situationParts);
  if (inferred !== 'default') return inferred;
  return fallback;
}

export interface SpokenNarrationLine {
  text: string;
  emotion: TtsEmotion;
}

/**
 * Spoken lines with a situation emotion. Used for UI labels and Edge rate/pitch;
 * never interpolate emotion names into the TTS utterance.
 */
export function parseSpokenNarrationLines(raw: unknown): SpokenNarrationLine[] {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      return parseSpokenNarrationLines(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: SpokenNarrationLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const o = entry as Record<string, unknown>;
    const text =
      typeof o.text === 'string'
        ? o.text.trim()
        : typeof o.line === 'string'
          ? o.line.trim()
          : '';
    if (!text) continue;
    const tagged = o.emotion ?? o.mood ?? o.tone;
    if (typeof tagged !== 'string' || !tagged.trim()) continue;
    out.push({ text, emotion: parseTtsEmotion(tagged) });
  }
  return out;
}

export function serializeSpokenNarrationLines(lines: SpokenNarrationLine[]): string {
  return JSON.stringify(
    lines
      .filter((l) => l.text.trim())
      .map((l) => ({ text: l.text.trim(), emotion: parseTtsEmotion(l.emotion) })),
  );
}

function parseSignedPercent(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.trim().match(/^([+-]?\d+(?:\.\d+)?)%$/);
  return m ? Number(m[1]) : 0;
}

function parseSignedHz(raw: string | undefined): number {
  if (!raw) return 0;
  const m = raw.trim().match(/^([+-]?\d+(?:\.\d+)?)Hz$/i);
  return m ? Number(m[1]) : 0;
}

function formatSignedPercent(n: number): string {
  const clamped = Math.max(-50, Math.min(50, Math.round(n)));
  return `${clamped >= 0 ? '+' : ''}${clamped}%`;
}

function formatSignedHz(n: number): string {
  const clamped = Math.max(-50, Math.min(50, Math.round(n)));
  return `${clamped >= 0 ? '+' : ''}${clamped}Hz`;
}

/**
 * Combine owner rate/pitch/speed with the selected emotion. Emotion offsets are
 * applied at synth time — they are not written back into saved settings.
 */
export function mergeEmotionProsody(
  voice: { rate?: string; pitch?: string; speed?: number },
  emotion: TtsEmotion = 'default',
): { rate?: string; pitch?: string; speed: number } {
  const preset = TTS_EMOTION_PROSODY[emotion];
  const rateSum = parseSignedPercent(voice.rate) + preset.ratePercent;
  const pitchSum = parseSignedHz(voice.pitch) + preset.pitchHz;
  const speed = Math.max(0.5, Math.min(2, (voice.speed ?? 1) * preset.speedMul));
  const emitRate = Boolean(voice.rate) || emotion !== 'default';
  const emitPitch = Boolean(voice.pitch) || emotion !== 'default';
  return {
    ...(emitRate ? { rate: formatSignedPercent(rateSum) } : {}),
    ...(emitPitch ? { pitch: formatSignedHz(pitchSum) } : {}),
    speed,
  };
}

/** Injected into narration + dialogue prompts: emotion is per line from the situation. */
export function formatSituationalSpeechEmotionRules(): string {
  const allowed = TTS_EMOTIONS.join(', ');
  return `Spoken emotion (mandatory, per line, from the SITUATION — never one mood for the whole video):
- Allowed emotion values: ${allowed}.
- For EVERY dialogue line and every narration lines[] beat, set emotion to match what is happening in THAT beat only. Examples: argument/insult/betrayal → angry; loss/goodbye/grief → sad; win/reveal/shock → excited; joke/reunion/warmth → cheerful; comfort/apology → empathetic; waiting/planning/quiet → calm; report/facts/headline → newscast; otherwise default.
- Different speakers in the same scene can have different emotions. Emotion may change from line to line as the situation changes.
- Spoken words must NOT include the emotion name, stage directions, or brackets.
- In animationPrompt, label each spoken line with its emotion: "Dialogue (angry): Name: line".`;
}

/**
 * Injected into every withChannelStyle path: per-line situation rules, TTS
 * wording hints, and the optional channel Voice-tab fallback.
 */
export function formatNarrationEmotionBlock(fallback?: TtsEmotion | null): string {
  const situational = formatSituationalSpeechEmotionRules();
  const fb = parseTtsEmotion(fallback);
  const wording = TTS_EMOTIONS.map((e) => `  - ${e}: ${TTS_EMOTION_NARRATION_HINTS[e]}`).join('\n');
  const fallbackLine =
    fb !== 'default'
      ? `- If a beat's situation is unclear, use "${fb}" as the fallback emotion (channel Voice-tab default).`
      : `- If a beat's situation is unclear, use "default".`;
  return `${situational}
- Write spoken wording TTS can deliver for that emotion (rhythm and punctuation only — never name the emotion in spoken text):
${wording}
${fallbackLine}`;
}

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
  /**
   * Channel fallback emotion when a spoken line has no situation tag.
   * Per-line situation emotion on scripts is the primary delivery.
   */
  emotion: z.enum(TTS_EMOTIONS).optional(),
  language: z.string().optional(),
  /**
   * Background bed / ambience level for VO mix (1–100%).
   * 100 = same loudness as voiceover; lower quietens music/ambience under VO.
   */
  backgroundBedPercent: z.number().int().min(1).max(100).optional(),
  /**
   * Final-video effects (captions / flip / color / lead-in trim). Nested object;
   * see render-settings.ts. Stored as-is on the profile JSON.
   */
  renderSettings: z.record(z.string(), z.unknown()).optional(),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;

/** Default bed level in channel settings (maps to full VO_MIX_*_BED_GAIN). */
export const DEFAULT_BACKGROUND_BED_PERCENT = 100;

export function clampBackgroundBedPercent(raw: unknown): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim()
        ? Number(raw)
        : NaN;
  if (!Number.isFinite(n)) return DEFAULT_BACKGROUND_BED_PERCENT;
  return Math.max(1, Math.min(100, Math.round(n)));
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  provider: 'edge',
  voiceId: EDGE_DEFAULT_VOICE,
  locale: EDGE_DEFAULT_LOCALE,
  backgroundBedPercent: DEFAULT_BACKGROUND_BED_PERCENT,
};

/** Locale-aware Edge default when the channel language is known. */
export function defaultVoiceForLanguage(language?: string | null): VoiceSettings {
  const hit = resolveContentLanguage(language);
  return {
    provider: 'edge',
    voiceId: hit.voiceId,
    locale: hit.locale,
    language: hit.code,
    backgroundBedPercent: DEFAULT_BACKGROUND_BED_PERCENT,
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
    ...(row.emotion !== undefined ? { emotion: parseTtsEmotion(row.emotion) } : {}),
    backgroundBedPercent: clampBackgroundBedPercent(
      row.backgroundBedPercent ?? DEFAULT_BACKGROUND_BED_PERCENT,
    ),
    ...(row.renderSettings && typeof row.renderSettings === 'object' && !Array.isArray(row.renderSettings)
      ? { renderSettings: row.renderSettings as Record<string, unknown> }
      : {}),
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
