import { describe, expect, it } from 'vitest';
import {
  CONTENT_LANGUAGES,
  contentLanguageOptionLabel,
  contentLanguageSelectOptions,
  formatIdeaTitleLanguageRules,
  formatOutputLanguagePolicy,
  formatSpokenLanguageRules,
  formatPublishCopyLanguageRules,
  isEnglishContentLanguage,
  languageDisplayName,
  resolveContentLanguage,
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
    expect(formatSpokenLanguageRules('ur')).toContain('not Roman Urdu');
    expect(formatPublishCopyLanguageRules('ur')).toContain('Roman Urdu');
    expect(formatPublishCopyLanguageRules('ur')).toContain('No Arabic/Urdu');
    expect(formatSpokenLanguageRules('hi')).toContain('Devanagari');
    expect(formatSpokenLanguageRules('hi')).toContain('not Roman/Latin Hindi');
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
});
