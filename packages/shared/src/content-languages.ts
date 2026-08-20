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
export const OUTPUT_LANGUAGE_POLICY_REV = 8;

/**
 * Conversational dialogue pace (words per minute). Keeps character clips talk-dense
 * for baked-in video speech — ~3 words/sec at 1.0× (full clip, not sparse beats).
 */
export const DIALOGUE_SPEAKING_WPM = 180;

/**
 * Hindi/Urdu dialogue-in-prompt fill vs English. Video models under-write native-script
 * speech (~half a clip); require ~2× English word volume so talk fills the full duration.
 */
export const DIALOGUE_INDIC_FILL_MULTIPLIER = 2;

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

/** Effective dialogue WPM for baked-in video speech (not TTS wall-clock). */
export function dialogueWpmForLanguage(language?: string | null, speed?: number | null): number {
  // Explicit speed override (legacy / tests) still honors a custom multiplier.
  if (typeof speed === 'number' && Number.isFinite(speed) && speed > 0) {
    const s = clampOpenAiTtsSpeed(speed);
    return Math.max(60, Math.round(DIALOGUE_SPEAKING_WPM * s));
  }
  const fill = dialogueFillMultiplierForLanguage(language);
  return Math.max(60, Math.round(DIALOGUE_SPEAKING_WPM * fill));
}

/** Extra dialogue volume for Hindi/Urdu prompt speech (1 for other languages). */
export function dialogueFillMultiplierForLanguage(language?: string | null): number {
  return isIndicContentLanguage(language) ? DIALOGUE_INDIC_FILL_MULTIPLIER : 1;
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
export function dialogueExchangesForClip(
  clipDurationSec: number,
  language?: string | null,
  options?: { targetWords?: number | null },
): number {
  const clip = Math.max(1, Math.round(clipDurationSec));
  // Roughly one exchange every ~2.5s; at least three for an 8s English clip.
  const base = Math.max(3, Math.round(clip / 2.5));
  const ownerTarget =
    typeof options?.targetWords === 'number' && options.targetWords > 0
      ? Math.round(options.targetWords)
      : null;
  // Owner word budget wins — do not force Indic 2× exchanges that blow past the target.
  if (ownerTarget != null) {
    const maxFromBudget = Math.max(2, Math.floor(ownerTarget / 10));
    return Math.min(base, maxFromBudget);
  }
  // Hindi/Urdu default: ~2× exchanges so native-script talk fills the full clip.
  if (isIndicContentLanguage(language)) {
    return Math.max(base * 2, Math.round(clip / 1.25));
  }
  return base;
}

/** Supported clip lengths for owner dialogue word targets. */
export const DIALOGUE_CLIP_DURATION_OPTIONS = [8, 10, 15, 30] as const;
export type DialogueClipDurationSec = (typeof DIALOGUE_CLIP_DURATION_OPTIONS)[number];

/** Count whitespace-separated spoken words (works for English / Hindi / Urdu script). */
export function countSpokenWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0).length;
}

/** Snap an arbitrary clip length to the nearest configured bucket (8/10/15/30). */
export function nearestDialogueClipDuration(clipDurationSec: number): DialogueClipDurationSec {
  const clip = Math.max(1, Math.round(clipDurationSec));
  let best: DialogueClipDurationSec = 8;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const option of DIALOGUE_CLIP_DURATION_OPTIONS) {
    const dist = Math.abs(option - clip);
    if (dist < bestDist || (dist === bestDist && option > best)) {
      best = option;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Resolve spoken-word target for a clip. Owner overrides in `customByClipSec`
 * (keys "8"|"10"|"15"|"30") win when > 0; otherwise language default density.
 */
export function dialogueWordsTargetForClip(
  clipDurationSec: number,
  language?: string | null,
  customByClipSec?: Record<string, number> | null,
): number {
  const bucket = nearestDialogueClipDuration(clipDurationSec);
  const map = customByClipSec ?? {};
  const raw = map[String(bucket)] ?? map[bucket as unknown as string];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(800, Math.round(raw));
  }
  const asNum = Number(raw);
  if (Number.isFinite(asNum) && asNum > 0) {
    return Math.min(800, Math.round(asNum));
  }
  return spokenWordsForDuration(clipDurationSec, dialogueWpmForLanguage(language)).target;
}

/** Loud owner/channel dialogue word banner for system prompts. */
export function formatOwnerDialogueWordTargetBlock(
  clipDurationSec: number,
  targetWords: number,
): string {
  const clip = Math.max(1, Math.round(clipDurationSec));
  const target = Math.max(1, Math.round(targetWords));
  const min = Math.max(1, Math.round(target * 0.85));
  const max = target;
  return `## OWNER DIALOGUE WORD TARGET (HARD — from Content pipeline settings)
- This channel requires about ${target} spoken words in dialogue[] for EVERY talking scene of ~${clip}s (acceptable ${min}-${max}; do not exceed ${max}).
- Count whitespace-separated words across ALL dialogue[].line strings in that scene.
- HARD FAIL if a scene has fewer than ${min} words (e.g. only 10–12 words is wrong). Aim for ${target} words; do not stop at one short sentence.
- animationPrompt must paste every line in full. Fill the full ${clip}s with talk — no long silent gaps.`;
}

export function formatDialogueClipDensityRules(
  clipDurationSec: number,
  language?: string | null,
  options?: { targetWords?: number | null; ownerOverride?: boolean },
): string {
  const fill = dialogueFillMultiplierForLanguage(language);
  const auto = spokenWordsForDuration(clipDurationSec, dialogueWpmForLanguage(language));
  const ownerOverride = options?.ownerOverride === true;
  const target =
    typeof options?.targetWords === 'number' && options.targetWords > 0
      ? Math.round(options.targetWords)
      : auto.target;
  const min = Math.max(1, Math.round(target * (ownerOverride ? 0.85 : 0.9)));
  const max = ownerOverride ? target : Math.max(target + 1, Math.round(target * 1.1));
  const wpm = Math.max(60, Math.round((target / Math.max(1, auto.durationSec)) * 60));
  // Only pass targetWords when the owner set Content pipeline overrides — otherwise
  // Indic languages keep the 2× exchange default (passing target always would cap that away).
  const exchanges = dialogueExchangesForClip(
    clipDurationSec,
    language,
    ownerOverride ? { targetWords: target } : undefined,
  );
  const minLines = exchanges * 2;
  const minWordsPerLine = Math.max(
    ownerOverride ? 4 : 6,
    Math.round(min / Math.max(1, minLines)),
  );
  const ownerBanner = ownerOverride
    ? `${formatOwnerDialogueWordTargetBlock(auto.durationSec, target)}\n`
    : '';
  const indicNote =
    fill > 1 && !ownerOverride
      ? ` Hindi/Urdu MUST write about ${fill}× an English clip (≈${target} words / ${minLines}+ lines for ${auto.durationSec}s). One short line (~3–4s) then silence is a HARD FAIL — keep speaking across the full ${auto.durationSec}s in native script.`
      : '';
  return `${ownerBanner}Clip dialogue density (mandatory for every dialogue / character scene of ~${auto.durationSec}s):
- Pace: ~${wpm} words per minute (≈ ${(wpm / 60).toFixed(2)} words/sec). Target ${target} words for ${auto.durationSec}s (acceptable ${min}-${max}).${indicNote}
- Spoken words in dialogue[] for THIS scene MUST be ${min}-${max} (aim ${target}). HARD FAIL if under ${min} words or if the clip has long silent gaps with no talk.
- About ${exchanges} dialogue exchanges (about ${minLines} spoken lines alternating speakers) timed across the FULL ${auto.durationSec}s — talk from start to end, not one short beat then silence.
- Each spoken line must be a real sentence (about ${minWordsPerLine}+ words), not a 2–3 word stub ("Haan", "Kya?", "Wait.", "اتنی صبح؟").
- animationPrompt MUST paste EVERY dialogue[].line in full as "Dialogue: Speaker: line" — never shorten, paraphrase, or drop lines. ImagePrompt may quote the same lines when a talking still is shown.
- Keep the clip feeling lively and full of talk — not sparse. Match action/blocking in animationPrompt to the same ${auto.durationSec}s.`;
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
