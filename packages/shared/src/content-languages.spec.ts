import { describe, expect, it } from 'vitest';
import {
  CONTENT_LANGUAGES,
  contentLanguageOptionLabel,
  contentLanguageSelectOptions,
  formatOutputLanguagePolicy,
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
    expect(policy).toContain('Ideas');
    expect(policy).toContain('English');
    expect(policy).toContain('Urdu');
    expect(policy).toContain('narrationScript');
    expect(policy).toContain('imagePrompt');
    expect(policy).toContain('videoTitle');
  });
});
