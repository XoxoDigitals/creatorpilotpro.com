import { describe, expect, it } from 'vitest';
import {
  analysisBeats,
  analysisDurationSec,
  atempoFilter,
  beatWordBudget,
  beatsForPrompt,
  clampTextToWordBudget,
  clampTimedLinesToBeats,
  fitSpeed,
  narrationBudgetSec,
  narrationWordBudget,
  timedLinesFromNarration,
  timedLinesFromStep,
  timelinePadPlan,
} from './vo-timing.js';

describe('narration duration budget', () => {
  it('caps spoken time under video length with a small margin', () => {
    expect(narrationBudgetSec(20)).toBeCloseTo(18.75, 2);
    expect(narrationWordBudget(20)).toBe(Math.round(18.75 * 2.2));
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
  it('budgets ~2.2 words per second of beat', () => {
    expect(beatWordBudget(3)).toBe(Math.floor(3 * 2.2));
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
});
