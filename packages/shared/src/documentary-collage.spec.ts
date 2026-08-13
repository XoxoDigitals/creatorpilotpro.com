import { describe, expect, it } from 'vitest';
import {
  DOCUMENTARY_COLLAGE_CLOSER,
  DOCUMENTARY_COLLAGE_STYLE_BLOCK,
  DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT,
  documentaryBeatSceneCount,
  documentaryTargetWordCount,
  ensureDocumentaryCollageImagePrompt,
  isDocumentaryIdeaGeneration,
  isDocumentaryLikeFormat,
  isDocumentaryVoiceoverPackage,
  joinProductionBriefEditingExtras,
  splitProductionBriefEditingExtras,
} from './documentary-collage.js';

describe('documentary collage detection', () => {
  it('detects documentary-like formats', () => {
    expect(isDocumentaryLikeFormat('documentary')).toBe(true);
    expect(isDocumentaryLikeFormat('short_documentary')).toBe(true);
    expect(isDocumentaryLikeFormat('explainer')).toBe(false);
  });

  it('activates for documentary + voiceover / mixed, not drama or dialogue', () => {
    expect(
      isDocumentaryVoiceoverPackage({
        version: 1,
        answers: { formats: ['documentary'], presentation: 'voiceover' },
      }),
    ).toBe(true);
    expect(
      isDocumentaryVoiceoverPackage({
        version: 1,
        answers: { formats: ['documentary'], presentation: 'mixed' },
      }),
    ).toBe(true);
    expect(
      isDocumentaryVoiceoverPackage({
        version: 1,
        answers: { formats: ['documentary'], presentation: 'dialogue' },
      }),
    ).toBe(false);
    expect(
      isDocumentaryVoiceoverPackage({
        version: 1,
        answers: { formats: ['drama', 'documentary'], presentation: 'voiceover' },
      }),
    ).toBe(false);
    expect(
      isDocumentaryVoiceoverPackage({
        version: 1,
        answers: { formats: ['explainer'], presentation: 'voiceover' },
      }),
    ).toBe(false);
  });

  it('activates idea rules when formats include documentary', () => {
    expect(
      isDocumentaryIdeaGeneration({
        version: 1,
        answers: { formats: ['documentary'], presentation: 'on_camera' },
      }),
    ).toBe(true);
  });
});

describe('documentary collage helpers', () => {
  it('targets ~2.5 words per second', () => {
    expect(documentaryTargetWordCount(30)).toBe(75);
    expect(documentaryTargetWordCount(60)).toBe(150);
    expect(documentaryTargetWordCount(120)).toBe(300);
  });

  it('prefers tighter beat counts when clips are long', () => {
    expect(documentaryBeatSceneCount(60, 10)).toBe(24);
    expect(documentaryBeatSceneCount(60, 2)).toBe(30);
  });

  it('universal video prompt forbids dialogue and includes scene ASMR audio', () => {
    expect(DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT).toMatch(/no dialogue/i);
    expect(DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT).toMatch(/lip-sync/i);
    expect(DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT).toMatch(/paper ASMR/i);
    expect(DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT).toMatch(/Voiceover is external/i);
  });

  it('appends style block and closer to image prompts', () => {
    const prompt = ensureDocumentaryCollageImagePrompt('A torn passport on newsprint');
    expect(prompt).toContain('A torn passport on newsprint');
    expect(prompt).toContain(DOCUMENTARY_COLLAGE_STYLE_BLOCK);
    expect(prompt).toContain(DOCUMENTARY_COLLAGE_CLOSER);
  });

  it('round-trips editing extras including universal video prompt', () => {
    const joined = joinProductionBriefEditingExtras({
      editingInstructions: 'Keep cuts dry.',
      universalVideoPrompt: DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT,
      thumbnailPromptVariants: 'Variant A\n\nVariant B',
      thumbnailNegativePrompt: 'blurry, watermark',
    });
    const split = splitProductionBriefEditingExtras(joined);
    expect(split.editingInstructions).toBe('Keep cuts dry.');
    expect(split.universalVideoPrompt).toBe(DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT);
    expect(split.thumbnailPromptVariants).toContain('Variant A');
    expect(split.thumbnailNegativePrompt).toBe('blurry, watermark');
  });

  it('parses universal video prompt when it is the only editing section', () => {
    const joined = joinProductionBriefEditingExtras({
      universalVideoPrompt: DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT,
    });
    const split = splitProductionBriefEditingExtras(joined);
    expect(split.editingInstructions).toBe('');
    expect(split.universalVideoPrompt).toBe(DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT);
  });
});
