/**
 * First-class channel output language (ChannelProfile.language).
 * Idea titles (and publish titles) follow title-language rules; idea angle/hook/
 * rationale, stories, and image+video prompts stay English. Spoken/on-screen copy
 * and non-title publish metadata use the selected language. Locales/voices match
 * Edge Neural defaults.
 */
export interface ContentLanguage {
  /** ISO 639-1 code stored on ChannelProfile.language. */
  code: string;
  englishName: string;
  nativeName: string;
  /** BCP-47 locale for Edge TTS filtering. */
  locale: string;
  /** Default Edge Neural voice for this language. */
  voiceId: string;
}

/**
 * Settings picker: 15 tier-1 market languages (US/UK/CA/AU/NZ, Western/Northern
 * Europe, JP, KR, plus Arabic) then Hindi and Urdu as extras. English is default.
 * Locales/voices are Edge Neural shorts used by defaultVoiceForLanguage.
 */
export const CONTENT_LANGUAGES: readonly ContentLanguage[] = [
  { code: 'en', englishName: 'English', nativeName: 'English', locale: 'en-US', voiceId: 'en-US-AriaNeural' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español', locale: 'es-ES', voiceId: 'es-ES-ElviraNeural' },
  { code: 'fr', englishName: 'French', nativeName: 'Français', locale: 'fr-FR', voiceId: 'fr-FR-DeniseNeural' },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch', locale: 'de-DE', voiceId: 'de-DE-KatjaNeural' },
  { code: 'it', englishName: 'Italian', nativeName: 'Italiano', locale: 'it-IT', voiceId: 'it-IT-ElsaNeural' },
  { code: 'pt', englishName: 'Portuguese', nativeName: 'Português', locale: 'pt-BR', voiceId: 'pt-BR-FranciscaNeural' },
  { code: 'nl', englishName: 'Dutch', nativeName: 'Nederlands', locale: 'nl-NL', voiceId: 'nl-NL-ColetteNeural' },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語', locale: 'ja-JP', voiceId: 'ja-JP-NanamiNeural' },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어', locale: 'ko-KR', voiceId: 'ko-KR-SunHiNeural' },
  { code: 'zh', englishName: 'Mandarin Chinese', nativeName: '中文', locale: 'zh-CN', voiceId: 'zh-CN-XiaoxiaoNeural' },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский', locale: 'ru-RU', voiceId: 'ru-RU-SvetlanaNeural' },
  { code: 'pl', englishName: 'Polish', nativeName: 'Polski', locale: 'pl-PL', voiceId: 'pl-PL-ZofiaNeural' },
  { code: 'sv', englishName: 'Swedish', nativeName: 'Svenska', locale: 'sv-SE', voiceId: 'sv-SE-SofieNeural' },
  { code: 'tr', englishName: 'Turkish', nativeName: 'Türkçe', locale: 'tr-TR', voiceId: 'tr-TR-EmelNeural' },
  { code: 'ar', englishName: 'Arabic', nativeName: 'العربية', locale: 'ar-SA', voiceId: 'ar-SA-ZariyahNeural' },
  { code: 'hi', englishName: 'Hindi', nativeName: 'हिन्दी', locale: 'hi-IN', voiceId: 'hi-IN-SwaraNeural' },
  { code: 'ur', englishName: 'Urdu', nativeName: 'اردو', locale: 'ur-PK', voiceId: 'ur-PK-UzmaNeural' },
] as const;

/** Locales kept for existing channels / voice defaults (not in the settings picker). */
export const EXTRA_CONTENT_LANGUAGES: readonly ContentLanguage[] = [
  { code: 'bn', englishName: 'Bengali', nativeName: 'বাংলা', locale: 'bn-IN', voiceId: 'bn-IN-TanishaaNeural' },
] as const;

const ALL_LANGUAGES: readonly ContentLanguage[] = [
  ...CONTENT_LANGUAGES,
  ...EXTRA_CONTENT_LANGUAGES,
];

const BY_CODE = new Map(ALL_LANGUAGES.map((lang) => [lang.code, lang]));

export const DEFAULT_CONTENT_LANGUAGE = 'en';

/** Bump when language-split prompt rules change so AI cache keys move. */
export const OUTPUT_LANGUAGE_POLICY_REV = 6;

/**
 * Conversational dialogue pace (words per minute). Keeps character clips full
 * without sounding rushed — ~2.67 words/sec at 1.0× TTS.
 */
export const DIALOGUE_SPEAKING_WPM = 160;

/**
 * Narration / voiceover pace (words per minute) — ~2.5 words/sec at 1.0× TTS.
 * Matches documentary Fern targets.
 */
export const NARRATION_SPEAKING_WPM = 150;

/**
 * OpenAI `/audio/speech` speed for Hindi and Urdu — native-script TTS at 1.0
 * reads slow; 1.5× keeps delivery natural. Write more words so wall-clock
 * duration still fills (words ≈ baseWpm × speed × seconds / 60).
 */
export const OPENAI_INDIC_TTS_SPEED = 1.5;

export function isIndicContentLanguage(language?: string | null): boolean {
  const code = parseLanguageCode(language);
  return code === 'hi' || code === 'ur';
}

/** OpenAI speech speed for the channel language (1.5 for hi/ur, else 1). */
export function openAiTtsSpeedForLanguage(language?: string | null): number {
  return isIndicContentLanguage(language) ? OPENAI_INDIC_TTS_SPEED : 1;
}

export function clampOpenAiTtsSpeed(speed?: number | null): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) return 1;
  return Math.min(4, Math.max(0.25, speed));
}

/** Effective narration WPM when TTS will play at `speed` (default: language policy). */
export function narrationWpmForLanguage(language?: string | null, speed?: number | null): number {
  const s = clampOpenAiTtsSpeed(speed ?? openAiTtsSpeedForLanguage(language));
  return Math.max(60, Math.round(NARRATION_SPEAKING_WPM * s));
}

/** Effective dialogue WPM when TTS will play at `speed`. */
export function dialogueWpmForLanguage(language?: string | null, speed?: number | null): number {
  const s = clampOpenAiTtsSpeed(speed ?? openAiTtsSpeedForLanguage(language));
  return Math.max(60, Math.round(DIALOGUE_SPEAKING_WPM * s));
}

export function spokenWordsForDuration(
  durationSec: number,
  wpm: number,
): { target: number; min: number; max: number; wpm: number; durationSec: number } {
  const sec = Math.max(1, Math.round(durationSec));
  const pace = Math.max(60, Math.round(wpm));
  const target = Math.max(1, Math.round((pace / 60) * sec));
  return {
    target,
    min: Math.max(1, Math.round(target * 0.9)),
    max: Math.max(target + 1, Math.round(target * 1.1)),
    wpm: pace,
    durationSec: sec,
  };
}

/** How many back-and-forth dialogue exchanges should fill one clip. */
export function dialogueExchangesForClip(clipDurationSec: number): number {
  const clip = Math.max(1, Math.round(clipDurationSec));
  // Roughly one exchange every ~3.5s; at least two for an 8s clip.
  return Math.max(2, Math.round(clip / 3.5));
}

export function formatDialogueClipDensityRules(
  clipDurationSec: number,
  language?: string | null,
): string {
  const speed = openAiTtsSpeedForLanguage(language);
  const words = spokenWordsForDuration(clipDurationSec, dialogueWpmForLanguage(language, speed));
  const exchanges = dialogueExchangesForClip(clipDurationSec);
  const minLines = exchanges * 2;
  const speedNote =
    speed > 1
      ? ` TTS for this language plays at ${speed}×, so write ~${speed}× more words than a 1.0× English read to fill the same ${words.durationSec}s.`
      : '';
  return `Clip dialogue density (mandatory for every dialogue / character scene of ~${words.durationSec}s):
- Pace: ${words.wpm} words per minute (≈ ${(words.wpm / 60).toFixed(2)} words/sec). Formula: words = round(WPM / 60 × clipSeconds).${speedNote}
- Spoken words in dialogue[] for THIS scene: about ${words.target} (acceptable ${words.min}-${words.max}). Never one short line then silence.
- At least ${exchanges} dialogue exchanges (about ${minLines}+ spoken lines alternating speakers) timed across the full ${words.durationSec}s.
- Keep the clip feeling lively and full of talk — not sparse, not a breathless dump. Match action/blocking in animationPrompt to the same ${words.durationSec}s.`;
}

export function formatNarrationDurationDensityRules(
  durationSec: number,
  language?: string | null,
): string {
  const speed = openAiTtsSpeedForLanguage(language);
  const words = spokenWordsForDuration(durationSec, narrationWpmForLanguage(language, speed));
  const speedNote =
    speed > 1
      ? ` Channel TTS speed is ${speed}× for this language — write about ${speed}× more words so the finished audio still fills ${words.durationSec}s of wall-clock time.`
      : '';
  return `Narration length (mandatory):
- Pace: ${words.wpm} words per minute (≈ ${(words.wpm / 60).toFixed(2)} words/sec). Formula: words = round(WPM / 60 × seconds).${speedNote}
- narrationScript must cover the full ${words.durationSec}s with about ${words.target} spoken words (acceptable ${words.min}-${words.max}, within ~10%).
- Do not under-write (feels empty/boring) or heavily over-write (rushed). narrationLines[].text concatenated must equal narrationScript.`;
}

export function parseLanguageCode(raw?: string | null): string {
  return (raw ?? DEFAULT_CONTENT_LANGUAGE).trim().toLowerCase().split(/[-_]/)[0] || DEFAULT_CONTENT_LANGUAGE;
}

export function resolveContentLanguage(raw?: string | null): ContentLanguage {
  const code = parseLanguageCode(raw);
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_CONTENT_LANGUAGE)!;
}

export function isEnglishContentLanguage(raw?: string | null): boolean {
  return parseLanguageCode(raw) === 'en';
}

/** English display name for prompts ("Urdu", "Hindi"). */
export function languageDisplayName(language: string | null | undefined): string {
  const code = (language ?? DEFAULT_CONTENT_LANGUAGE).trim() || DEFAULT_CONTENT_LANGUAGE;
  const parsed = parseLanguageCode(code);
  return BY_CODE.get(parsed)?.englishName ?? BY_CODE.get(code)?.englishName ?? code;
}

export function contentLanguageOptionLabel(lang: ContentLanguage): string {
  if (lang.code === 'en' || lang.nativeName === lang.englishName) return lang.englishName;
  return `${lang.englishName} — ${lang.nativeName}`;
}

/** Settings picker options, plus the current code when it is outside the list. */
export function contentLanguageSelectOptions(current?: string | null): ContentLanguage[] {
  const options = [...CONTENT_LANGUAGES];
  const code = parseLanguageCode(current);
  if (options.some((lang) => lang.code === code)) return options;
  const extra = EXTRA_CONTENT_LANGUAGES.find((lang) => lang.code === code);
  if (extra) return [...options, extra];
  if (code && code !== DEFAULT_CONTENT_LANGUAGE) {
    const resolved = resolveContentLanguage(code);
    options.push({
      code,
      englishName: languageDisplayName(code),
      nativeName: languageDisplayName(code),
      locale: resolved.locale,
      voiceId: resolved.voiceId,
    });
  }
  return options;
}

/**
 * Spoken VO / dialogue must be pure native-script language.
 * Independent of title rules (Hindi titles may mix English; Urdu titles stay Roman Urdu).
 */
export function formatSpokenLanguageRules(language?: string | null): string {
  const code = parseLanguageCode(language);
  const lang = languageDisplayName(language);
  const native = resolveContentLanguage(language).nativeName;
  if (isEnglishContentLanguage(language)) {
    return `Spoken voiceover and dialogue: write in natural English. Native English spelling — not a mix of other languages.`;
  }
  const scriptRule =
    code === 'hi'
      ? `Write EVERY spoken word in Hindi using Devanagari script (${native}). Pure Hindi only — FORBIDDEN: Roman/Latin Hindi, Hinglish transliteration (e.g. "ek phone call"), English sentences. Proper nouns may stay Latin only when they have no standard Hindi spelling.`
      : code === 'ur'
        ? `Write EVERY spoken word in Urdu using Urdu (Nastaliq/Arabic) script (${native}). Pure Urdu only — FORBIDDEN: Roman Urdu / Latin transliteration (e.g. "Aik phone call par beti ki aawaz"), Hindi Devanagari, English sentences. Example shape: "ایک فون کال پر بیٹی کی آواز سن کر ماں کا دل دہل گیا۔" Proper nouns may stay Latin only when they have no standard Urdu spelling.`
        : code === 'ar'
          ? `Write EVERY spoken word in Arabic script (${native}). Pure Arabic — not Latin transliteration.`
          : code === 'de'
            ? `Write EVERY spoken word in German (${native}) with correct umlauts and ß. Pure German — not English mixed sentences.`
            : `Write EVERY spoken word in ${lang} using its native script (${native}). Pure ${lang} — never Latin/English transliteration of the whole voiceover.`;
  return `Spoken language (mandatory for narrationScript, narrationLines[].text, and dialogue[].line):
- ${scriptRule}
- Title / description / thumbnail rules do NOT apply here. Publish titles may be Roman Urdu; voiceover must NEVER be Roman Urdu or Latin transliteration.
- Voiceover is what TTS reads: it must be pure native-script ${lang} so the audience hears the correct language.
- Do not write the voiceover in English and do not romanize it. If you output Latin letters for spoken lines, that is a hard failure.`;
}

/**
 * Idea/publish title language for ChannelProfile.language.
 * Angle, hook, rationale, and topicSummary stay English for operator review.
 */
export function formatIdeaTitleLanguageRules(language?: string | null): string {
  const code = parseLanguageCode(language);
  const lang = languageDisplayName(language);
  if (code === 'hi') {
    return 'Titles MUST mix Hindi (Devanagari) and English in roughly equal parts in ONE title, like Indian YouTube: Hindi words + English keywords (Secret, Never, Why, Exposed). Not fully Hindi, not fully English. Angle/hook/rationale stay English. topicSummary stays English.';
  }
  if (code === 'ur') {
    return 'Titles MUST be Roman Urdu (Latin letters only), natural spoken Urdu romanization. No Arabic/Urdu script. Angle/hook/rationale stay English. topicSummary stays English.';
  }
  if (!isEnglishContentLanguage(language)) {
    return `Titles MUST be written in ${lang} (native script OK). Angle/hook/rationale stay English. topicSummary stays English.`;
  }
  return 'Titles MUST be written in English. Angle/hook/rationale stay English. topicSummary stays English.';
}

/**
 * Publish description / tags / hashtags. Urdu uses Roman Urdu like titles,
 * not Nastaliq — that script is only for spoken voiceover.
 */
export function formatPublishCopyLanguageRules(language?: string | null): string {
  const code = parseLanguageCode(language);
  const lang = languageDisplayName(language);
  if (code === 'ur') {
    return 'Write videoDescription, description, tags, keywords, and hashtags in Roman Urdu (Latin letters only), natural spoken Urdu romanization. No Arabic/Urdu (Nastaliq) script in the description or tags.';
  }
  if (code === 'hi') {
    return `Write videoDescription, description, tags, keywords, and hashtags in Hindi. Devanagari is OK; English search keywords are OK in tags.`;
  }
  if (isEnglishContentLanguage(language)) {
    return 'Write videoDescription, description, tags, keywords, and hashtags in English.';
  }
  return `Write videoDescription, description, tags, keywords, and hashtags in ${lang}.`;
}

/**
 * Burned-in / thumbnail lettering. Urdu thumbnails stay Roman Urdu (readable
 * Latin) even though spoken VO uses Nastaliq.
 */
export function formatOnScreenTextLanguageRules(language?: string | null): string {
  const code = parseLanguageCode(language);
  const lang = languageDisplayName(language);
  if (code === 'ur') {
    return 'On-screen text (captions, overlays, thumbnail labels/lettering, any burned-in words): Roman Urdu only (Latin letters). Never Arabic/Urdu Nastaliq script on the thumbnail or in image/video text overlays.';
  }
  if (code === 'hi') {
    return `On-screen text (captions, overlays, thumbnail labels/lettering): Hindi (Devanagari OK; short English keywords OK when they read well at thumbnail size).`;
  }
  if (isEnglishContentLanguage(language)) {
    return 'On-screen text (captions, overlays, thumbnail labels/lettering): English.';
  }
  return `On-screen text (captions, overlays, thumbnail labels/lettering): ${lang}.`;
}

/**
 * Language label to quote inside thumbnail prompts for on-image lettering.
 */
export function thumbnailOverlayLanguageLabel(language?: string | null): string {
  const code = parseLanguageCode(language);
  if (code === 'ur') return 'Roman Urdu (Latin letters only — never Nastaliq/Arabic script)';
  return languageDisplayName(language);
}

/**
 * Mandatory split: idea titles follow title-language rules; idea angle/hook/
 * rationale, stories, and visual prompts stay English; spoken, on-screen, and
 * non-title publish metadata use the channel language.
 */
export function formatOutputLanguagePolicy(language?: string | null): string {
  const lang = languageDisplayName(language);
  const titleRules = formatIdeaTitleLanguageRules(language);
  if (isEnglishContentLanguage(language)) {
    return `LANGUAGE POLICY: English for idea titles, angle/hook/rationale/topicSummary, stories, image/video prompts, voiceover, dialogue, on-screen text, and publish title/description/tags.`;
  }
  return `LANGUAGE POLICY (mandatory; overrides any earlier "write everything in ${lang}" instruction):
- Keep these instructions and all AI system prompts in English.
- Idea title (and publish videoTitle/title): ${titleRules}
- Idea angle, hook, rationale, and topicSummary MUST stay in English.
- Story drafts / storySummary / bible / episode summaries MUST be written in English.
- imagePrompt, animationPrompt, thumbnailPrompt, videoPrompt, and negative-prompt bodies MUST stay in English (camera, lighting, composition, motion).
- Voiceover / narrationScript / narrationLines: ${formatSpokenLanguageRules(language)}
- Dialogue: same spoken-language rules as voiceover (dialogue[].line and quoted speech in animationPrompt).
- On-screen text: ${formatOnScreenTextLanguageRules(language)} Quote that text inside otherwise-English prompts.
- Publish metadata: ${formatPublishCopyLanguageRules(language)} Publish titles follow the idea-title language rules above.`.trim();
}
