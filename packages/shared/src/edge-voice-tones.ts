/**
 * Curated tone labels for Edge Neural voices.
 *
 * `GET /ai/tts/voices` (edge-tts --list-voices) only returns name / gender / locale.
 * These labels mirror Microsoft Edge/Azure VoicePersonalities + content categories
 * where known (e.g. Aria → Engaging, Jenny → Friendly, Guy → News).
 */

/** Short marketing-style tones shown in the voice picker. */
export const EDGE_VOICE_TONE_LABELS = [
  'Engaging',
  'Calm',
  'Professional',
  'Friendly',
  'Narration',
  'News',
  'Cheerful',
  'Serious',
  'Warm',
  'Casual',
  'Cute',
] as const;

export type EdgeVoiceToneLabel = (typeof EDGE_VOICE_TONE_LABELS)[number];

/**
 * Primary tone by Edge shortName (voiceId). Multilingual twins share the base tone.
 * Prefer one label so the list stays scannable.
 */
const EDGE_VOICE_TONE_BY_ID: Record<string, EdgeVoiceToneLabel> = {
  // en-US — common defaults / gallery personalities
  'en-US-AriaNeural': 'Engaging',
  'en-US-JennyNeural': 'Friendly',
  'en-US-JennyMultilingualNeural': 'Friendly',
  'en-US-GuyNeural': 'News',
  'en-US-SaraNeural': 'Cheerful',
  'en-US-DavisNeural': 'Casual',
  'en-US-JaneNeural': 'Cheerful',
  'en-US-JasonNeural': 'Cheerful',
  'en-US-NancyNeural': 'Friendly',
  'en-US-TonyNeural': 'Cheerful',
  'en-US-AnaNeural': 'Cute',
  'en-US-AndrewNeural': 'Warm',
  'en-US-AndrewMultilingualNeural': 'Warm',
  'en-US-AvaNeural': 'Friendly',
  'en-US-AvaMultilingualNeural': 'Friendly',
  'en-US-BrianNeural': 'Casual',
  'en-US-BrianMultilingualNeural': 'Casual',
  'en-US-ChristopherNeural': 'Professional',
  'en-US-EmmaNeural': 'Cheerful',
  'en-US-EmmaMultilingualNeural': 'Cheerful',
  'en-US-EricNeural': 'Serious',
  'en-US-MichelleNeural': 'Friendly',
  'en-US-RogerNeural': 'Engaging',
  'en-US-SteffanNeural': 'Narration',
  'en-US-AmberNeural': 'Warm',
  'en-US-AshleyNeural': 'Friendly',
  'en-US-BrandonNeural': 'Casual',
  'en-US-CoraNeural': 'Calm',
  'en-US-ElizabethNeural': 'Professional',
  'en-US-MonicaNeural': 'Friendly',
  'en-US-AIGenerate1Neural': 'Serious',
  'en-US-AIGenerate2Neural': 'Serious',

  // Other English locales
  'en-GB-LibbyNeural': 'Friendly',
  'en-GB-MaisieNeural': 'Friendly',
  'en-GB-RyanNeural': 'Friendly',
  'en-GB-SoniaNeural': 'Friendly',
  'en-GB-ThomasNeural': 'Friendly',
  'en-AU-NatashaNeural': 'Friendly',
  'en-AU-WilliamNeural': 'Friendly',
  'en-CA-ClaraNeural': 'Friendly',
  'en-CA-LiamNeural': 'Friendly',
  'en-IN-NeerjaNeural': 'News',
  'en-IN-PrabhatNeural': 'Professional',
  'en-HK-SamNeural': 'Friendly',
  'en-HK-YanNeural': 'Friendly',

  // Channel language defaults (content-languages.ts)
  'es-ES-ElviraNeural': 'Friendly',
  'es-ES-AlvaroNeural': 'Cheerful',
  'es-MX-DaliaNeural': 'Cheerful',
  'es-MX-JorgeNeural': 'Casual',
  'fr-FR-DeniseNeural': 'Friendly',
  'fr-FR-HenriNeural': 'Friendly',
  'de-DE-KatjaNeural': 'Friendly',
  'de-DE-ConradNeural': 'Cheerful',
  'it-IT-ElsaNeural': 'Friendly',
  'it-IT-IsabellaNeural': 'Cheerful',
  'it-IT-DiegoNeural': 'Cheerful',
  'pt-BR-FranciscaNeural': 'Friendly',
  'pt-BR-AntonioNeural': 'Friendly',
  'nl-NL-ColetteNeural': 'Friendly',
  'nl-NL-MaartenNeural': 'Friendly',
  'ja-JP-NanamiNeural': 'Friendly',
  'ja-JP-KeitaNeural': 'Friendly',
  'ko-KR-SunHiNeural': 'Friendly',
  'ko-KR-InJoonNeural': 'Friendly',
  'zh-CN-XiaoxiaoNeural': 'Warm',
  'zh-CN-YunxiNeural': 'Casual',
  'zh-CN-YunjianNeural': 'Engaging',
  'zh-CN-XiaoyiNeural': 'Friendly',
  'ru-RU-SvetlanaNeural': 'Friendly',
  'ru-RU-DmitryNeural': 'Professional',
  'pl-PL-ZofiaNeural': 'Friendly',
  'pl-PL-MarekNeural': 'Friendly',
  'sv-SE-SofieNeural': 'Friendly',
  'sv-SE-MattiasNeural': 'Friendly',
  'tr-TR-EmelNeural': 'Friendly',
  'tr-TR-AhmetNeural': 'Friendly',
  'ar-SA-ZariyahNeural': 'Friendly',
  'ar-SA-HamedNeural': 'Professional',
  'hi-IN-SwaraNeural': 'Friendly',
  'hi-IN-MadhurNeural': 'Professional',
  'ur-PK-UzmaNeural': 'Friendly',
  'ur-PK-AsadNeural': 'Professional',
  'bn-IN-TanishaaNeural': 'Friendly',
  'bn-IN-BashkarNeural': 'Friendly',
};

/** Resolve a single tone label for an Edge voiceId, or null if unknown. */
export function edgeVoiceTone(voiceId: string | null | undefined): EdgeVoiceToneLabel | null {
  const id = voiceId?.trim();
  if (!id) return null;
  return EDGE_VOICE_TONE_BY_ID[id] ?? null;
}
