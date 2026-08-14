import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT,
  DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT,
  DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT,
  DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT,
  embedNegativeGuidanceInPrompt,
  expandCharacterReferencesInText,
  formatCharacterReference,
  formatSceneVisualPromptRules,
  formatChannelStyleBlock,
  formatOurChannelAboutBlock,
  isDramaOrDialoguePackage,
  isNarrationVoiceoverPackage,
  NEGATIVE_PROMPT_INLINE_PREFIX,
} from './style-profile.js';
import { languageDisplayName } from './content-languages.js';

describe('drama/dialogue style helpers', () => {
  it('detects drama format or dialogue presentation', () => {
    expect(
      isDramaOrDialoguePackage({
        version: 1,
        answers: { formats: ['drama'], presentation: 'voiceover' },
      }),
    ).toBe(true);
    expect(
      isDramaOrDialoguePackage({
        version: 1,
        answers: { formats: ['explainer'], presentation: 'dialogue' },
      }),
    ).toBe(true);
    expect(
      isDramaOrDialoguePackage({
        version: 1,
        answers: { formats: ['explainer'], presentation: 'voiceover' },
      }),
    ).toBe(false);
  });

  it('detects pure narration voiceover (not drama/dialogue)', () => {
    expect(
      isNarrationVoiceoverPackage({
        version: 1,
        answers: { formats: ['explainer'], presentation: 'voiceover' },
      }),
    ).toBe(true);
    expect(
      isNarrationVoiceoverPackage({
        version: 1,
        answers: { formats: ['drama'], presentation: 'voiceover' },
      }),
    ).toBe(false);
    expect(
      isNarrationVoiceoverPackage({
        version: 1,
        answers: { formats: ['explainer'], presentation: 'dialogue' },
      }),
    ).toBe(false);
  });

  it('maps language codes to display names', () => {
    expect(languageDisplayName('ur')).toBe('Urdu');
    expect(languageDisplayName('hi')).toBe('Hindi');
    expect(languageDisplayName('en')).toBe('English');
  });

  it('keeps ideas in English while sending spoken/publish copy to the channel language', () => {
    const about = formatOurChannelAboutBlock(
      {
        language: 'hi',
        styleProfile: { version: 1, answers: { niche: 'history shorts' } },
      },
      'Our Channel',
    );
    expect(about).toContain('Idea language: English');
    expect(about).toContain('Hindi');

    const block = formatChannelStyleBlock({ language: 'ur' });
    expect(block).toContain('LANGUAGE POLICY');
    expect(block).toContain('Urdu');
    expect(block).toContain('Ideas');
    expect(block).toContain('imagePrompt');
  });

  it('builds expanded character references', () => {
    expect(
      formatCharacterReference({
        name: 'Hina',
        appearance: 'A girl in Cozy knit sweater',
        wardrobe: 'a denim apron for painting tasks',
      }),
    ).toBe('Hina (A girl in Cozy knit sweater with a denim apron for painting tasks)');

    expect(
      formatCharacterReference({
        name: 'Hina',
        appearance: 'A girl',
        wardrobe: 'in Cozy knit sweater with a denim apron for painting tasks',
      }),
    ).toBe('Hina (A girl with Cozy knit sweater with a denim apron for painting tasks)');
  });

  it('expands bare names without double-wrapping', () => {
    const characters = [
      {
        name: 'Hina',
        appearance: 'A girl in Cozy knit sweater',
        wardrobe: 'a denim apron for painting tasks',
      },
    ];
    const ref = formatCharacterReference(characters[0]!);
    const expanded = expandCharacterReferencesInText(
      `Hina looks at ${ref} across the room`,
      characters,
    );
    expect(expanded.startsWith(`${ref} looks at ${ref}`)).toBe(true);
  });

  it('embeds negative guidance into prompts without duplicating', () => {
    const withNeg = embedNegativeGuidanceInPrompt('Wide shot of a harbor', 'blurry, watermark');
    expect(withNeg).toContain('Wide shot of a harbor');
    expect(withNeg).toContain(`${NEGATIVE_PROMPT_INLINE_PREFIX} blurry, watermark`);
    expect(embedNegativeGuidanceInPrompt(withNeg, 'blurry, watermark')).toBe(withNeg);
  });

  it('keeps distinct image vs video narration defaults', () => {
    expect(DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT).toContain('talking characters');
    expect(DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT).toContain('deformed face');
    expect(DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT).not.toContain('jittery motion');
    expect(DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT).toContain('lip-sync speech');
    expect(DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT).toContain('jittery motion');
    expect(DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT).toContain('speech on the video track');
    expect(DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT).not.toBe(DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT);
    expect(DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT).not.toBe(DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT);
    expect(DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT).toContain('morphing faces');
  });

  it('requires self-contained distinct negatives and narration sound design in scene rules', () => {
    const narration = formatSceneVisualPromptRules(4, { narrationVoiceover: true });
    expect(narration).toContain(NEGATIVE_PROMPT_INLINE_PREFIX);
    expect(narration).toContain('sound design');
    expect(narration).toContain(DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT);
    expect(narration).toContain(DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT);
    expect(narration).toContain('animationNegativePrompt');
    expect(narration).toContain('talking characters');
    expect(narration).toContain('forbid');

    const drama = formatSceneVisualPromptRules(4, {
      dramaOrDialogue: true,
      narrationVoiceover: true,
      clipDurationSec: 10,
    });
    expect(drama).toContain('ultra realistic');
    expect(drama).toContain('do NOT add "no dialogue"');
    expect(drama).toContain('animationNegativePrompt');
    expect(drama).not.toContain('sound design / audio layer');
  });
});
