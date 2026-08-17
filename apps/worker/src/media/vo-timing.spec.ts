import { describe, expect, it } from 'vitest';
import {
  INTER_SEGMENT_GAP_SEC,
  analysisBeats,
  analysisDurationSec,
  atempoFilter,
  beatWordBudget,
  beatsForPrompt,
  clampTextToWordBudget,
  clampTimedLinesToBeats,
  clipStartsFromPadPlan,
  fitSpeed,
  narrationBudgetSec,
  narrationMinWordBudget,
  narrationWordBudget,
  splitNarrationSegments,
  timedLinesFromNarration,
  timedLinesFromStep,
  timelinePadPlan,
  applySituationalLineEmotions,
  spokenLinesFromUnknown,
} from './vo-timing.js';

describe('narration duration budget', () => {
  it('sizes spoken words to ~150 WPM across nearly the full video', () => {
    expect(narrationBudgetSec(20)).toBeCloseTo(19.4, 2);
    expect(narrationWordBudget(20)).toBe(Math.round(19.4 * 2.5));
    expect(narrationMinWordBudget(20)).toBe(Math.round(Math.round(19.4 * 2.5) * 0.85));
    expect(narrationBudgetSec(null)).toBeNull();
    expect(narrationBudgetSec(0)).toBeNull();
  });
});

describe('fitSpeed / atempoFilter', () => {
  it('does not speed when VO already fits', () => {
    expect(fitSpeed(10, 12)).toBe(1);
    expect(atempoFilter(1)).toBeNull();
  });

  it('speeds slightly when VO overruns, capped at 1.15', () => {
    expect(fitSpeed(12.5, 12)).toBeCloseTo(12.5 / 12, 3);
    expect(fitSpeed(14, 12)).toBe(1.15);
    expect(fitSpeed(30, 12)).toBe(1.15);
    expect(atempoFilter(1.12)).toBe('atempo=1.12');
    expect(atempoFilter(2.5)).toBe('atempo=2,atempo=1.25');
  });
});

describe('beat word budgets / clamp', () => {
  it('budgets ~2.5 words per second of beat', () => {
    expect(beatWordBudget(3)).toBe(Math.floor(3 * 2.5));
    expect(beatWordBudget(0.1)).toBe(2);
  });

  it('shortens overlong lines instead of allowing rush', () => {
    expect(clampTextToWordBudget('one two three four five', 3)).toBe('one two three');
    expect(
      clampTimedLinesToBeats([{ startSec: 0, endSec: 2, text: 'a b c d e f g h i j' }])[0]!.text.split(
        ' ',
      ).length,
    ).toBeLessThanOrEqual(beatWordBudget(2));
  });
});

describe('analysisBeats / duration', () => {
  const analysis = {
    durationSec: 12,
    segments: [
      { startSec: 0, endSec: 4, whatHappens: 'Opens the box', visuals: 'CU hands' },
      { startSec: 4, endSec: 12, whatHappens: 'Reacts', visuals: 'face' },
    ],
  };

  it('reads contiguous beats for the prompt with maxWords', () => {
    expect(analysisBeats(analysis)).toHaveLength(2);
    expect(beatsForPrompt(analysisBeats(analysis))[0]).toMatchObject({
      startSec: 0,
      endSec: 4,
      durationSec: 4,
      maxWords: beatWordBudget(4),
      minWords: Math.max(1, Math.round(beatWordBudget(4) * 0.85)),
      whatHappens: 'Opens the box',
    });
  });

  it('prefers analysis durationSec then last beat end', () => {
    expect(analysisDurationSec(analysis, 99)).toBe(12);
    expect(analysisDurationSec({ segments: analysis.segments }, 99)).toBe(12);
    expect(analysisDurationSec(null, 8)).toBe(8);
  });
});

describe('timedLinesFromNarration', () => {
  it('prefers the selected variant lines', () => {
    const lines = timedLinesFromNarration(
      {
        variants: [
          { id: 'explainer', lines: [{ startSec: 0, endSec: 3, text: 'A' }] },
          { id: 'styleB', lines: [{ startSec: 0, endSec: 2, text: 'B hook' }] },
        ],
      },
      'styleB',
    );
    expect(lines).toEqual([{ startSec: 0, endSec: 2, text: 'B hook' }]);
  });
});

describe('timedLinesFromStep', () => {
  it('reads persisted scriptVariants for the selected id', () => {
    expect(
      timedLinesFromStep({
        selectedScriptId: 'styleC',
        scriptVariants: [
          { id: 'explainer', lines: [{ startSec: 0, endSec: 1, text: 'A' }] },
          { id: 'styleC', lines: [{ startSec: 1, endSec: 3, text: 'Calm' }] },
        ],
      }),
    ).toEqual([{ startSec: 1, endSec: 3, text: 'Calm' }]);
  });
});

describe('splitNarrationSegments', () => {
  it('splits on sentence boundaries for inter-segment TTS gaps', () => {
    expect(splitNarrationSegments('First beat. Second beat! Third?')).toEqual([
      'First beat.',
      'Second beat!',
      'Third?',
    ]);
  });

  it('keeps a single segment when there is no sentence break', () => {
    expect(splitNarrationSegments('one continuous line')).toEqual(['one continuous line']);
  });
});

describe('timelinePadPlan', () => {
  it('pads silence so lines land on scene timestamps', () => {
    const plan = timelinePadPlan(
      [
        { startSec: 0.5, durationSec: 2 },
        { startSec: 4, durationSec: 1.5 },
      ],
      10,
    );
    expect(plan).toEqual([
      { kind: 'silence', durationSec: 0.5 },
      { kind: 'audio', index: 0 },
      { kind: 'silence', durationSec: 1.5 },
      { kind: 'audio', index: 1 },
    ]);
  });

  it('inserts a minimum gap when dialogue clips abut', () => {
    const plan = timelinePadPlan(
      [
        { startSec: 0, durationSec: 2 },
        { startSec: 2, durationSec: 1 },
      ],
      10,
    );
    expect(plan).toEqual([
      { kind: 'audio', index: 0 },
      { kind: 'silence', durationSec: INTER_SEGMENT_GAP_SEC },
      { kind: 'audio', index: 1 },
    ]);
    expect(clipStartsFromPadPlan(plan, [{ durationSec: 2 }, { durationSec: 1 }])).toEqual([
      0,
      2 + INTER_SEGMENT_GAP_SEC,
    ]);
  });
});

describe('situation emotion on spoken lines', () => {
  it('keeps a tagged line emotion and infers from the matching beat', () => {
    const beats = analysisBeats({
      segments: [
        { startSec: 0, endSec: 4, whatHappens: 'They shout during the argument', mood: 'tense' },
        { startSec: 4, endSec: 8, whatHappens: 'A quiet wait', mood: 'still' },
      ],
    });
    const lines = applySituationalLineEmotions(
      [
        { startSec: 0, endSec: 4, text: 'How dare you.' },
        { startSec: 4, endSec: 8, text: 'We wait.', emotion: 'sad' },
      ],
      beats,
      'newscast',
    );
    expect(lines[0]?.emotion).toBe('angry');
    expect(lines[1]?.emotion).toBe('sad');
  });

  it('reads stored narrationLines only when emotion is present', () => {
    expect(
      spokenLinesFromUnknown([{ text: 'They lost her.', emotion: 'sad' }]),
    ).toEqual([{ startSec: 0, endSec: 0, text: 'They lost her.', emotion: 'sad' }]);
    expect(spokenLinesFromUnknown([{ startMs: 0, endMs: 1200, text: 'Hello' }])).toEqual([]);
  });
});
