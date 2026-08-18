import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT,
  DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT,
  DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT,
  DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT,
  STYLE_QUESTIONS,
  composeChannelStyles,
  dramaImageNegativePromptFor,
  dramaVideoNegativePromptFor,
  embedNegativeGuidanceInPrompt,
  expandCharacterReferencesInText,
  formatCharacterReference,
  formatDramaDialoguePackageRules,
  formatSceneVisualPromptRules,
  formatChannelStyleBlock,
  formatOurChannelAboutBlock,
  formatLockedCharactersPrompt,
  isCartoonPackage,
  isUltraRealisticPackage,
  isKidsRhymePackage,
  isDramaOrDialoguePackage,
  isNarrationVoiceoverPackage,
  presentationNeedsVoiceover,
  NEGATIVE_PROMPT_INLINE_PREFIX,
  parseStyleProfile,
  stripCartoonAnimeNegatives,
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

  it('keeps idea angle/hook/rationale in English while titles follow the channel language', () => {
    const about = formatOurChannelAboutBlock(
      {
        language: 'hi',
        styleProfile: { version: 1, answers: { niche: 'history shorts' } },
      },
      'Our Channel',
    );
    expect(about).toContain('mix Hindi (Devanagari) and English');
    expect(about).not.toContain('Idea language: English');
    expect(about).toContain('Hindi');
    expect(about).toContain('Angle/hook/rationale stay English');

    const block = formatChannelStyleBlock({ language: 'ur' });
    expect(block).toContain('LANGUAGE POLICY');
    expect(block).toContain('Urdu');
    expect(block).toContain('Roman Urdu');
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
    expect(narration).toContain('impact hits');
    expect(narration).toContain('whooshes');
    expect(narration).toContain('tension risers');
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
    expect(drama).toContain('impact hits');
    expect(drama).not.toContain('sound design / audio layer');
  });

  it('injects documentary per-line emotion and repurposed calm into the channel style block', () => {
    const block = formatChannelStyleBlock({ language: 'en', ttsEmotion: 'calm' });
    expect(block).toContain('Voice delivery');
    expect(block).toContain('newscast');
    expect(block).toContain('calm');
    expect(block).toContain('Do not stamp every line newscast');
    expect(block).not.toContain('SITUATION');
  });
});

describe('brand questionnaire & master prompt', () => {
  it('puts presentation first in STYLE_QUESTIONS', () => {
    expect(STYLE_QUESTIONS[0]?.id).toBe('presentation');
  });

  it('keeps voiceover / dialogue / mixed voiceover flags unchanged', () => {
    const voiceover = { version: 1 as const, answers: { presentation: 'voiceover' } };
    const dialogue = { version: 1 as const, answers: { presentation: 'dialogue' } };
    const mixed = { version: 1 as const, answers: { presentation: 'mixed' } };
    expect(isNarrationVoiceoverPackage(voiceover)).toBe(true);
    expect(isNarrationVoiceoverPackage(dialogue)).toBe(false);
    expect(isNarrationVoiceoverPackage(mixed)).toBe(false);
    expect(presentationNeedsVoiceover(voiceover)).toBe(true);
    expect(presentationNeedsVoiceover(dialogue)).toBe(false);
    expect(presentationNeedsVoiceover(mixed)).toBe(true);
    expect(isDramaOrDialoguePackage(mixed)).toBe(false);
  });

  it('parses old profiles without retentionStyle', () => {
    const parsed = parseStyleProfile({
      version: 1,
      answers: { presentation: 'voiceover', niche: 'history shorts' },
    });
    expect(parsed.answers.presentation).toBe('voiceover');
    expect(parsed.answers.retentionStyle).toBe('');
  });

  it('composeChannelStyles includes Hook & retention and Visual prompt DNA', () => {
    const composed = composeChannelStyles(
      parseStyleProfile({
        version: 1,
        answers: {
          presentation: 'voiceover',
          niche: 'forgotten inventors',
          visualStyles: ['fast_motion_graphics'],
          pacing: 'high',
          hookStyle: 'shock_fact',
          retentionStyle: 'rehook_8s',
        },
      }).answers,
      'en',
    );
    expect(composed.masterPrompt).toContain('## 2. Hook & retention engine');
    expect(composed.masterPrompt).toContain('## 3. Visual prompt DNA');
    expect(composed.masterPrompt).toContain('re-hook about every ~8 seconds');
    expect(composed.masterPrompt).toContain('AI stills + AI animation only');
    expect(composed.masterPrompt).not.toContain('VO LAYUP TIMELINE');
  });

  it('visual and animation options are AI-only (no stock or screen recording)', () => {
    const visual = STYLE_QUESTIONS.find((q) => q.id === 'visualStyles');
    const anim = STYLE_QUESTIONS.find((q) => q.id === 'animationStyle');
    const visualValues = (visual?.options ?? []).map((o) => o.value);
    const animValues = (anim?.options ?? []).map((o) => o.value);
    for (const banned of ['screen_recording', 'stock_collage', 'broll_doc', 'green_screen', 'minimal_stills']) {
      expect(visualValues).not.toContain(banned);
    }
    expect(animValues).not.toContain('none');
    expect(visual?.options?.every((o) => o.hint && o.hint.length > 20)).toBe(true);
    expect(anim?.options?.every((o) => o.hint && o.hint.length > 20)).toBe(true);
    expect(visualValues).toContain('fast_motion_graphics');
    expect(visualValues).toContain('ultra_realistic');
    expect(animValues).toContain('ai_scene');
  });

  it('mixed compose includes VO LAYUP TIMELINE guidance', () => {
    const composed = composeChannelStyles(
      parseStyleProfile({
        version: 1,
        answers: {
          presentation: 'mixed',
          niche: 'story channel',
          formats: ['storytime'],
        },
      }).answers,
      'en',
    );
    expect(composed.masterPrompt).toContain('## 5. Mixed VO timeline');
    expect(composed.masterPrompt).toContain('VO LAYUP TIMELINE');
    expect(composed.masterPrompt).toContain('NARRATION (lay generated VO here)');
    expect(composed.masterPrompt).toContain('DIALOGUE (no VO; speech is in animationPrompt)');
  });

  it('does not overwrite owner-pasted animation guidelines', () => {
    const composed = composeChannelStyles(
      parseStyleProfile({
        version: 1,
        answers: { presentation: 'voiceover', visualStyles: ['fast_motion_graphics'] },
      }).answers,
      'en',
      { animationReferencePrompt: 'OWNER MOTION: always dolly left' },
    );
    expect(composed.masterPrompt).toContain('OWNER MOTION: always dolly left');
    expect(composed.masterPrompt).not.toContain('Seeded motion DNA from brand answers');
  });

  it('cartoon package does not forbid cartoon in default drama negatives helper', () => {
    const cartoon = {
      version: 1 as const,
      answers: { visualStyles: ['2d_cartoon'], animationStyle: '2d_cartoon' },
    };
    expect(isCartoonPackage(cartoon)).toBe(true);
    expect(DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT).toContain('cartoon');
    expect(dramaImageNegativePromptFor(cartoon)).not.toMatch(/\bcartoon\b/i);
    expect(dramaImageNegativePromptFor(cartoon)).not.toMatch(/\banime\b/i);
    expect(dramaVideoNegativePromptFor(cartoon)).not.toMatch(/\bcartoon\b/i);
    expect(stripCartoonAnimeNegatives(DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT)).not.toMatch(
      /\bcartoon\b/i,
    );
    const rules = formatDramaDialoguePackageRules({
      clipDurationSec: 8,
      cartoonPackage: true,
    });
    expect(rules).not.toMatch(/Start from:.*\bcartoon\b/i);
    expect(rules).not.toContain('include the exact phrase "ultra realistic"');

    const sceneRules = formatSceneVisualPromptRules(3, {
      dramaOrDialogue: true,
      cartoonPackage: true,
    });
    expect(sceneRules).toContain('Do NOT add cartoon or anime');
    expect(sceneRules).not.toContain('include the quality phrase "ultra realistic"');
  });

  it('locks the same characters across videos in the composed prompt', () => {
    const composed = composeChannelStyles(
      { presentation: 'dialogue', visualStyles: ['2d_cartoon'], niche: 'moral stories' },
      'hi',
      {
        lockedCharacters: [
          {
            name: 'Hina',
            appearance: 'round face, short black hair',
            wardrobe: 'knit sweater',
            age: '24',
            personality: 'kind',
            consistencyDetails: 'mole on left cheek',
            look: 'cartoon_2d',
          },
        ],
      },
    );
    expect(composed.masterPrompt).toContain('CHARACTER LOCK');
    expect(composed.masterPrompt).toContain('Hina');
    expect(composed.masterPrompt).toContain('2D cartoon');
    expect(composed.masterPrompt).toContain('Devanagari');
  });

  it('puts owner custom visual style into Visual prompt DNA', () => {
    const composed = composeChannelStyles(
      {
        presentation: 'voiceover',
        customVisualStyle: 'LOOK: grainy 2D newsprint maps, red string, punch-in every 2s.',
      },
      'en',
    );
    expect(composed.masterPrompt).toContain('OWNER / ANALYZED VISUAL STYLE');
    expect(composed.masterPrompt).toContain('grainy 2D newsprint maps');
  });

  it('treats ultra realistic visual style as photoreal, not cartoon', () => {
    const profile = {
      version: 1 as const,
      answers: { visualStyles: ['ultra_realistic'] },
    };
    expect(isCartoonPackage(profile)).toBe(false);
    expect(isUltraRealisticPackage(profile)).toBe(true);
    const lock = formatLockedCharactersPrompt([
      {
        name: 'Ayaan',
        appearance: 'sharp jaw, stubble',
        wardrobe: 'black shirt',
        age: '30',
        personality: '',
        consistencyDetails: '',
        look: 'ultra_realistic',
      },
    ]);
    expect(lock).toContain('Ayaan');
    expect(lock).toContain('Ultra realistic');
  });

  it('detects kids rhyme niche or nursery format', () => {
    expect(
      isKidsRhymePackage({
        version: 1,
        answers: { nicheTags: ['kids_rhymes'], presentation: 'voiceover' },
      }),
    ).toBe(true);
    expect(
      isKidsRhymePackage({
        version: 1,
        answers: { formats: ['nursery_rhyme'], presentation: 'voiceover' },
      }),
    ).toBe(true);
    expect(
      isKidsRhymePackage({
        version: 1,
        answers: { nicheTags: ['history'], formats: ['documentary'] },
      }),
    ).toBe(false);
  });
});
