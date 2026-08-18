import { describe, expect, it } from 'vitest';
import {
  CONTENT_LANGUAGES,
  contentLanguageOptionLabel,
  contentLanguageSelectOptions,
  dialogueExchangesForClip,
  formatDialogueClipDensityRules,
  formatIdeaTitleLanguageRules,
  formatNarrationDurationDensityRules,
  formatOnScreenTextLanguageRules,
  formatOutputLanguagePolicy,
  formatSpokenLanguageRules,
  formatPublishCopyLanguageRules,
  isEnglishContentLanguage,
  languageDisplayName,
  narrationWpmForLanguage,
  openAiTtsSpeedForLanguage,
  resolveContentLanguage,
  spokenWordsForDuration,
  DIALOGUE_SPEAKING_WPM,
  NARRATION_SPEAKING_WPM,
  thumbnailOverlayLanguageLabel,
} from './content-languages.js';
import { defaultVoiceForLanguage } from './voice-settings.js';

const PICKER_CODES = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'nl',
  'ja',
  'ko',
  'zh',
  'ru',
  'pl',
  'sv',
  'tr',
  'ar',
  'hi',
  'ur',
] as const;

describe('content languages', () => {
  it('exposes the tier-1 picker with Hindi/Urdu extras and English first', () => {
    expect(CONTENT_LANGUAGES).toHaveLength(17);
    expect(CONTENT_LANGUAGES[0]?.code).toBe('en');
    expect(CONTENT_LANGUAGES.map((l) => l.code)).toEqual([...PICKER_CODES]);
  });

  it('maps codes to English display names and Edge locales', () => {
    expect(languageDisplayName('ur')).toBe('Urdu');
    expect(languageDisplayName('hi')).toBe('Hindi');
    expect(languageDisplayName('en')).toBe('English');
    expect(languageDisplayName('zh-CN')).toBe('Mandarin Chinese');
    expect(languageDisplayName('it')).toBe('Italian');
    expect(languageDisplayName('nl')).toBe('Dutch');
    expect(languageDisplayName('pl')).toBe('Polish');
    expect(languageDisplayName('sv')).toBe('Swedish');
    expect(languageDisplayName('tr')).toBe('Turkish');
    expect(languageDisplayName('bn')).toBe('Bengali');
    expect(resolveContentLanguage('ru').locale).toBe('ru-RU');
    expect(resolveContentLanguage('it').voiceId).toBe('it-IT-ElsaNeural');
    expect(resolveContentLanguage('bn').voiceId).toBe('bn-IN-TanishaaNeural');
  });

  it('keeps Bengali available for voice defaults without adding it to the picker', () => {
    expect(contentLanguageSelectOptions().map((l) => l.code)).toEqual([...PICKER_CODES]);
    expect(contentLanguageSelectOptions().map((l) => l.code)).not.toContain('bn');
    expect(contentLanguageSelectOptions('bn').some((l) => l.code === 'bn')).toBe(true);
    expect(defaultVoiceForLanguage('ja').voiceId).toBe('ja-JP-NanamiNeural');
    expect(defaultVoiceForLanguage('hi').locale).toBe('hi-IN');
    const hindi = CONTENT_LANGUAGES.find((l) => l.code === 'hi')!;
    expect(contentLanguageOptionLabel(hindi)).toContain('हिन्दी');
  });

  it('gives every picker language a matching Edge Neural default', () => {
    for (const lang of CONTENT_LANGUAGES) {
      const voice = defaultVoiceForLanguage(lang.code);
      expect(voice.provider).toBe('edge');
      expect(voice.locale).toBe(lang.locale);
      expect(voice.voiceId).toBe(lang.voiceId);
      expect(voice.language).toBe(lang.code);
      expect(lang.voiceId.startsWith(`${lang.locale}-`)).toBe(true);
    }
  });

  it('splits English creative work from selected-language spoken/publish copy', () => {
    expect(isEnglishContentLanguage('en-US')).toBe(true);
    const policy = formatOutputLanguagePolicy('ur');
    expect(policy).toContain('Idea title');
    expect(policy).toContain('English');
    expect(policy).toContain('Urdu');
    expect(policy).toContain('narrationScript');
    expect(policy).toContain('imagePrompt');
    expect(policy).toContain('videoTitle');
    expect(policy).toContain('Roman Urdu');
    expect(policy).toContain('topicSummary');
    expect(policy).not.toContain('Ideas (title, angle, hook, rationale) MUST be written in English');
    expect(policy).toContain('Voiceover / narrationScript / narrationLines');
    expect(policy).toContain('Urdu (Nastaliq/Arabic)');
    expect(policy).toContain('thumbnail labels');
    expect(policy).toMatch(/Roman Urdu only/i);
    expect(formatSpokenLanguageRules('ur')).toMatch(/FORBIDDEN: Roman Urdu/i);
    expect(formatPublishCopyLanguageRules('ur')).toContain('Roman Urdu');
    expect(formatPublishCopyLanguageRules('ur')).toContain('No Arabic/Urdu');
    expect(formatSpokenLanguageRules('hi')).toContain('Devanagari');
    expect(formatSpokenLanguageRules('hi')).toMatch(/FORBIDDEN: Roman\/Latin Hindi/i);
    expect(formatSpokenLanguageRules('de')).toContain('German');
    expect(formatSpokenLanguageRules('de')).toContain('umlauts');
  });

  it('formats idea title language rules per channel language', () => {
    expect(formatIdeaTitleLanguageRules('en')).toContain('Titles MUST be written in English');
    expect(formatIdeaTitleLanguageRules('hi')).toContain('mix Hindi (Devanagari) and English');
    expect(formatIdeaTitleLanguageRules('hi')).toContain('Not fully Hindi, not fully English');
    expect(formatIdeaTitleLanguageRules('ur')).toContain('Roman Urdu');
    expect(formatIdeaTitleLanguageRules('ur')).toContain('No Arabic/Urdu script');
    expect(formatIdeaTitleLanguageRules('es')).toContain('Titles MUST be written in Spanish');
    expect(formatIdeaTitleLanguageRules('ja')).toContain('native script OK');
    expect(formatIdeaTitleLanguageRules('hi')).toContain('Angle/hook/rationale stay English');
    expect(formatIdeaTitleLanguageRules('ur')).toContain('Angle/hook/rationale stay English');
    expect(formatIdeaTitleLanguageRules('es')).toContain('Angle/hook/rationale stay English');
  });

  it('uses WPM formula for dialogue and narration density', () => {
    const dialogue = spokenWordsForDuration(8, DIALOGUE_SPEAKING_WPM);
    expect(dialogue.target).toBe(Math.round((160 / 60) * 8));
    expect(dialogue.min).toBeLessThanOrEqual(dialogue.target);
    expect(dialogue.max).toBeGreaterThanOrEqual(dialogue.target);
    expect(dialogueExchangesForClip(8)).toBeGreaterThanOrEqual(2);
    expect(formatDialogueClipDensityRules(8)).toContain('160');
    expect(formatDialogueClipDensityRules(8)).toContain(String(dialogue.target));

    const narration = spokenWordsForDuration(60, NARRATION_SPEAKING_WPM);
    expect(narration.target).toBe(150);
    expect(formatNarrationDurationDensityRules(60)).toContain('150');
    expect(formatNarrationDurationDensityRules(60)).toContain(String(narration.target));

    // Hindi/Urdu OpenAI TTS at 1.5× needs ~1.5× more words for the same duration.
    expect(openAiTtsSpeedForLanguage('ur')).toBe(1.5);
    expect(openAiTtsSpeedForLanguage('hi')).toBe(1.5);
    expect(openAiTtsSpeedForLanguage('en')).toBe(1);
    const urduWords = spokenWordsForDuration(60, narrationWpmForLanguage('ur'));
    expect(urduWords.target).toBe(Math.round(150 * 1.5));
    expect(formatNarrationDurationDensityRules(60, 'ur')).toContain(String(urduWords.target));
    expect(formatNarrationDurationDensityRules(60, 'ur')).toContain('1.5');
  });

  it('forces Roman Urdu for Urdu thumbnail / on-screen lettering', () => {
    expect(thumbnailOverlayLanguageLabel('ur')).toMatch(/Roman Urdu/i);
    expect(formatOnScreenTextLanguageRules('ur')).toMatch(/Roman Urdu only/i);
    expect(formatOnScreenTextLanguageRules('ur')).toMatch(/Never Arabic\/Urdu Nastaliq/i);
    expect(formatOnScreenTextLanguageRules('en')).toContain('English');
  });

  it('forbids Roman Urdu in spoken voiceover rules', () => {
    expect(formatSpokenLanguageRules('ur')).toMatch(/FORBIDDEN: Roman Urdu/i);
    expect(formatSpokenLanguageRules('ur')).toMatch(/Nastaliq/i);
    expect(formatSpokenLanguageRules('hi')).toMatch(/FORBIDDEN: Roman\/Latin Hindi/i);
    expect(formatSpokenLanguageRules('hi')).toMatch(/Devanagari/i);
  });
});
