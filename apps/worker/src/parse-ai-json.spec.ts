import { describe, expect, it } from 'vitest';
import {
  IDEA_TITLE_ACCEPTED_MAX,
  IDEA_TITLE_ACCEPTED_MIN,
  fitIdeaTitleLength,
  ideaGenerationSchema,
  ideaTitleLength,
  isAcceptableIdeaTitle,
  normalizeGeneratedIdea,
  normalizeIdeaTitle,
  normalizeProductionBriefOutput,
  parseAiJson,
} from './ai-phase4.js';

describe('parseAiJson', () => {
  it('parses a bare JSON array', () => {
    expect(parseAiJson('[{"title":"A"}]')).toEqual([{ title: 'A' }]);
  });

  it('parses the ```json fence Gemini emits without responseMimeType', () => {
    const fenced =
      '```json\n[\n  {\n    "title": "The Plane That Vanished",\n    "viralScore": 88\n  }\n]\n```';
    expect(parseAiJson(fenced)).toEqual([{ title: 'The Plane That Vanished', viralScore: 88 }]);
  });

  it('parses a bare ``` fence with no language tag', () => {
    expect(parseAiJson('```\n{"title":"B"}\n```')).toEqual({ title: 'B' });
  });

  it('recovers JSON wrapped in explanatory prose', () => {
    expect(parseAiJson('Sure! Here are the ideas:\n[{"title":"C"}]\nHope this helps.')).toEqual([
      { title: 'C' },
    ]);
  });

  it('passes through objects untouched', () => {
    const obj = { title: 'D' };
    expect(parseAiJson(obj)).toBe(obj);
  });

  it('returns null when there is no JSON at all', () => {
    expect(parseAiJson('I cannot help with that.')).toBeNull();
    expect(parseAiJson('')).toBeNull();
  });

  it('normalizes clean fields and viral score from a fenced model payload', () => {
    const parsed = parseAiJson(
      '```json\n[{"title":"Plain title","angle":"Fresh angle","hook":"Watch this","rationale":"Strong fit","category":"UNIQUE","viralScore":"91"}]\n```',
    ) as unknown[];
    expect(normalizeGeneratedIdea(parsed[0])).toEqual({
      title: 'Plain title',
      angle: 'Fresh angle',
      hook: 'Watch this',
      rationale: 'Strong fit',
      topicSummary: '',
      category: 'UNIQUE',
      viralScore: 91,
    });
  });

  it('extracts topicSummary from generated ideas', () => {
    const parsed = parseAiJson(
      '[{"title":"Plain title","angle":"Fresh angle","hook":"Watch this","rationale":"Strong fit","topicSummary":"The episode explains a 90-second reset used before meetings. It covers who it helps, why the pause matters, and the core claim that a short ritual beats scrolling."}]',
    ) as unknown[];
    expect(normalizeGeneratedIdea(parsed[0]).topicSummary).toContain('90-second reset');
  });
});

describe('creative package normalization', () => {
  const baseOptions = {
    clipDurationSec: 10,
    videoDurationSec: 20,
    fallbackTitle: 'Fallback title',
  };

  it('keeps a complete voiceover script and scene-aligned prompts', () => {
    const normalized = normalizeProductionBriefOutput(
      {
        videoTitle: 'A narrated story',
        storySummary: 'A two-scene journey.',
        narrationScript:
          'At sunrise, Maya opens the workshop. Ten seconds later, her invention finally comes alive.',
        characters: [
          {
            name: 'Maya',
            appearance: 'Round face, brown eyes, black curls',
            wardrobe: 'Blue mechanic coveralls',
            age: '28',
            personality: 'Patient and inventive',
            consistencyDetails: 'Same curls, coveralls, and brass goggles in every scene',
          },
        ],
        sceneBreakdown: [
          {
            sceneIndex: 1,
            durationSec: 10,
            imagePrompt: 'Sunrise workshop',
            animationPrompt: 'Slow dolly in',
            dialogue: [],
          },
          {
            sceneIndex: 2,
            durationSec: 10,
            imagePrompt: 'Glowing invention',
            animationPrompt: 'Camera arcs right',
            dialogue: [],
          },
        ],
      },
      { ...baseOptions, presentation: 'voiceover' },
    );

    expect(normalized.narrationScript).toContain('At sunrise');
    expect(normalized.scenes).toHaveLength(2);
    expect(normalized.characters[0]?.name).toBe('Maya');
    expect(normalized.scenes[0]?.negativePrompt.length).toBeGreaterThan(0);
    expect(normalized.scenes[0]?.animationNegativePrompt.length).toBeGreaterThan(0);
    expect(normalized.scenes[0]?.imagePrompt).toMatch(/Negative:/i);
    expect(normalized.scenes[0]?.animationPrompt).toMatch(/Negative:/i);
    expect(normalized.scenes[0]?.negativePrompt).toMatch(/dialogue/i);
    expect(normalized.scenes[0]?.animationNegativePrompt).toMatch(/dialogue/i);
    expect(normalized.scenes[0]?.imagePrompt).toContain(normalized.scenes[0]!.negativePrompt);
    expect(normalized.scenes[0]?.animationPrompt).toContain(
      normalized.scenes[0]!.animationNegativePrompt,
    );
    expect(normalized.scenes[0]?.negativePrompt).not.toBe(
      normalized.scenes[0]?.animationNegativePrompt,
    );
    expect(normalized.scenes[0]?.animationNegativePrompt).toMatch(/jittery|lip-sync|video track/i);
  });

  it('embeds exact speaker dialogue in its video prompt and omits narration', () => {
    const normalized = normalizeProductionBriefOutput(
      {
        narrationScript: 'This must not become dialogue-mode TTS.',
        sceneBreakdown: [
          {
            sceneIndex: 1,
            durationSec: 10,
            imagePrompt: 'Maya faces Theo',
            animationPrompt: 'Handheld push-in as Maya raises the map.',
            dialogue: [{ speaker: 'Maya', line: 'We leave before midnight.', emotion: 'calm' }],
          },
        ],
        characters: [
          {
            name: 'Maya',
            appearance: 'Round face, brown eyes, black curls',
            wardrobe: 'Blue mechanic coveralls',
            age: '28',
            personality: 'Patient and inventive',
            consistencyDetails: 'Same curls, coveralls, and brass goggles in every scene',
          },
        ],
      },
      { ...baseOptions, presentation: 'dialogue', dramaOrDialogue: true },
    );

    expect(normalized.narrationScript).toBe('');
    expect(normalized.scenes[0]?.animationPrompt).toContain('We leave before midnight.');
    expect(normalized.scenes[0]?.animationPrompt).toMatch(/Maya \(.*\)/);
    expect(normalized.scenes[0]?.animationPrompt).toMatch(/ultra realistic/i);
    expect(normalized.scenes[0]?.imagePrompt).toMatch(/Maya \(.*\)/);
    expect(normalized.scenes[0]?.imagePrompt).toMatch(/ultra realistic/i);
    expect(normalized.scenes[0]?.negativePrompt.length).toBeGreaterThan(0);
    expect(normalized.scenes[0]?.animationNegativePrompt.length).toBeGreaterThan(0);
    expect(normalized.scenes[0]?.imagePrompt).toContain(normalized.scenes[0]!.negativePrompt);
    expect(normalized.scenes[0]?.animationPrompt).toContain(
      normalized.scenes[0]!.animationNegativePrompt,
    );
    expect(normalized.scenes[0]?.negativePrompt).not.toBe(
      normalized.scenes[0]?.animationNegativePrompt,
    );
    expect(normalized.scenes[0]?.negativePrompt).not.toMatch(/\bno dialogue\b/i);
    expect(normalized.scenes[0]?.animationNegativePrompt).not.toMatch(/\bno dialogue\b/i);
    expect(normalized.scenes[0]?.animationPrompt).toContain('Dialogue:');
    expect(normalized.scenes[0]?.animationPrompt).not.toMatch(/Dialogue\s*\(/i);
    expect(normalized.scenes[0]?.animationPrompt).toMatch(/lip[- ]?sync/i);
    expect(normalized.scenes[0]?.imagePrompt).not.toMatch(/lip[- ]?sync/i);
    expect(normalized.scenes[0]?.dialogue).toEqual([
      { speaker: 'Maya', line: 'We leave before midnight.', emotion: 'calm' },
    ]);
  });

  it('expands dialogue speakers and adds missing cast to imagePrompt for I2V', () => {
    const normalized = normalizeProductionBriefOutput(
      {
        narrationScript: '',
        sceneBreakdown: [
          {
            sceneIndex: 1,
            durationSec: 8,
            imagePrompt: 'Maya stands at the workbench alone',
            animationPrompt: 'Maya turns as Theo replies.',
            dialogue: [
              { speaker: 'Maya', line: 'Where is the map?', emotion: 'calm' },
              { speaker: 'Theo', line: 'In my pocket.', emotion: 'calm' },
            ],
          },
        ],
        characters: [
          {
            name: 'Maya',
            appearance: 'Round face, brown eyes, black curls',
            wardrobe: 'Blue mechanic coveralls',
            age: '28',
            personality: 'Patient',
            consistencyDetails: 'Same curls and coveralls',
          },
          {
            name: 'Theo',
            appearance: 'Square jaw, short blond hair',
            wardrobe: 'Brown leather jacket',
            age: '30',
            personality: 'Blunt',
            consistencyDetails: 'Same jacket and scar',
          },
        ],
      },
      { ...baseOptions, presentation: 'dialogue', dramaOrDialogue: true },
    );

    const image = normalized.scenes[0]?.imagePrompt ?? '';
    const animation = normalized.scenes[0]?.animationPrompt ?? '';
    expect(image).toMatch(/Maya/i);
    expect(image).toMatch(/Theo/i);
    expect(image).toMatch(/Also in frame \(same cast for image-to-video\)/i);
    expect(image).toMatch(/Theo \(.*\)/);
    expect(image).not.toMatch(/lip[- ]?sync/i);
    expect(animation).toMatch(/Dialogue: Maya \(.*\): Where is the map\?/i);
    expect(animation).toMatch(/Dialogue: Theo \(.*\): In my pocket\./i);
    expect(animation).toMatch(/lip[- ]?sync/i);
  });
});

describe('generated idea titles', () => {
  it('keeps the requested prefix when the model returns surplus ideas', () => {
    const idea = {
      title: 'x'.repeat(IDEA_TITLE_ACCEPTED_MIN),
      angle: 'Angle',
      hook: 'Hook',
      rationale: 'Rationale',
      category: 'UNIQUE' as const,
      viralScore: 80,
    };
    const parsed = ideaGenerationSchema(2).parse([idea, idea, idea]);
    expect(parsed).toHaveLength(2);
  });

  it('accepts topicSummary on each generated idea', () => {
    const idea = {
      title: 'x'.repeat(IDEA_TITLE_ACCEPTED_MIN),
      angle: 'Angle',
      hook: 'Hook',
      rationale: 'Rationale',
      topicSummary:
        'The video is about a hidden Antarctic ice core. Scientists found a climate signal that changes the timeline. The core claim is that the ice records a sudden melt, not a slow thaw.',
      category: 'UNIQUE' as const,
      viralScore: 80,
    };
    const parsed = ideaGenerationSchema(1).parse([idea]);
    expect(parsed[0]?.topicSummary).toContain('Antarctic ice core');
  });

  it('collapses model whitespace without truncating or rewriting words', () => {
    const raw = '  The Hidden   Habit That Makes\nEvery Morning Feel Easier  ';
    expect(normalizeIdeaTitle(raw)).toBe('The Hidden Habit That Makes Every Morning Feel Easier');
  });

  it('accepts the soft length window used after parse', () => {
    expect(isAcceptableIdeaTitle('x'.repeat(IDEA_TITLE_ACCEPTED_MIN - 1))).toBe(false);
    expect(isAcceptableIdeaTitle('x'.repeat(IDEA_TITLE_ACCEPTED_MIN))).toBe(true);
    expect(isAcceptableIdeaTitle('x'.repeat(IDEA_TITLE_ACCEPTED_MAX))).toBe(true);
    expect(isAcceptableIdeaTitle('x'.repeat(IDEA_TITLE_ACCEPTED_MAX + 1))).toBe(false);
  });

  it('counts visible Unicode characters rather than UTF-16 code units', () => {
    const title = `${'x'.repeat(IDEA_TITLE_ACCEPTED_MIN - 1)}💡`;
    expect(ideaTitleLength(title)).toBe(IDEA_TITLE_ACCEPTED_MIN);
    expect(isAcceptableIdeaTitle(title)).toBe(true);
  });

  it('does not reject the batch schema when a title is outside the soft window', () => {
    const idea = {
      title: 'Too Short',
      angle: 'Angle',
      hook: 'Hook that adds curiosity for viewers',
      rationale: 'Rationale',
      category: 'SIMILAR' as const,
      viralScore: 70,
    };
    expect(() => ideaGenerationSchema(1).parse([idea])).not.toThrow();
  });

  it('fits short titles using hook text and trims long titles at word boundaries', () => {
    const short = fitIdeaTitleLength('Why Ice Age?', {
      hook: 'Scientists just found the shocking answer buried under Antarctica ice',
    });
    expect(isAcceptableIdeaTitle(short)).toBe(true);

    const long = fitIdeaTitleLength(
      'This Is An Extremely Long Clickbait Title That Definitely Goes Way Past The Soft Upper Limit For Idea Cards',
    );
    expect(isAcceptableIdeaTitle(long)).toBe(true);
    expect(ideaTitleLength(long)).toBeLessThanOrEqual(IDEA_TITLE_ACCEPTED_MAX);
    expect(long.includes(' ')).toBe(true);
  });
});
