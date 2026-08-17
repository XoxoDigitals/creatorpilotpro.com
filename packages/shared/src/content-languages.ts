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
export const OUTPUT_LANGUAGE_POLICY_REV = 2;

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
 * Idea/publish title language for ChannelProfile.language.
 * Angle, hook, and rationale stay English for operator review.
 */
export function formatIdeaTitleLanguageRules(language?: string | null): string {
  const code = parseLanguageCode(language);
  const lang = languageDisplayName(language);
  if (code === 'hi') {
    return 'Titles MUST mix Hindi (Devanagari) and English in roughly equal parts in ONE title, like Indian YouTube: Hindi words + English keywords (Secret, Never, Why, Exposed). Not fully Hindi, not fully English. Angle/hook/rationale stay English.';
  }
  if (code === 'ur') {
    return 'Titles MUST be Roman Urdu (Latin letters only), natural spoken Urdu romanization. No Arabic/Urdu script. Angle/hook/rationale stay English.';
  }
  if (!isEnglishContentLanguage(language)) {
    return `Titles MUST be written in ${lang} (native script OK). Angle/hook/rationale stay English.`;
  }
  return 'Titles MUST be written in English. Angle/hook/rationale stay English.';
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
    return `LANGUAGE POLICY: English for idea titles, angle/hook/rationale, stories, image/video prompts, voiceover, dialogue, on-screen text, and publish title/description/tags.`;
  }
  return `LANGUAGE POLICY (mandatory; overrides any earlier "write everything in ${lang}" instruction):
- Keep these instructions and all AI system prompts in English.
- Idea title (and publish videoTitle/title): ${titleRules}
- Idea angle, hook, and rationale MUST stay in English (topicSummary if present stays English).
- Story drafts / storySummary / bible / episode summaries MUST be written in English.
- imagePrompt, animationPrompt, thumbnailPrompt, videoPrompt, and negative-prompt bodies MUST stay in English (camera, lighting, composition, motion).
- Voiceover / narrationScript: write EVERY spoken narrator word in ${lang}.
- Dialogue: write EVERY spoken character line in ${lang} (dialogue[].line and quoted speech in animationPrompt).
- On-screen text: captions, overlay lettering, thumbnail type, and any text that will appear in the image/video MUST be in ${lang}. Quote that ${lang} text inside otherwise-English prompts.
- Publish metadata: videoDescription, description, tags, and hashtags MUST be in ${lang}. Publish titles follow the idea-title language rules above, not a fully English or fully ${lang} title unless those rules say so.`.trim();
}
