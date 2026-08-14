import { describe, expect, it } from 'vitest';
import {
  analysisDialogueRanges,
  analysisIndicatesDialogue,
  analysisIndicatesNaturalSound,
  analysisPeople,
  mergeDialogueRanges,
} from './dialogue-audio.js';

describe('analysisIndicatesDialogue', () => {
  it('honors an explicit hasDialogue true flag', () => {
    expect(analysisIndicatesDialogue({ hasDialogue: true, summary: 'silent b-roll' })).toBe(true);
  });

  it('overrides hasDialogue false when speech text clearly indicates talking', () => {
    expect(analysisIndicatesDialogue({ hasDialogue: false, summary: 'Someone is talking' })).toBe(
      true,
    );
  });

  it('detects spoken dialogue from speechOrAudio beats', () => {
    expect(
      analysisIndicatesDialogue({
        summary: 'Street market.',
        segments: [{ speechOrAudio: 'Vendor says the price out loud' }],
      }),
    ).toBe(true);
  });

  it('treats ambience-only notes as no dialogue', () => {
    expect(
      analysisIndicatesDialogue({
        summary: 'Wind and traffic.',
        segments: [{ speechOrAudio: 'ambience only, no dialogue' }],
      }),
    ).toBe(false);
  });
});

describe('analysisDialogueRanges', () => {
  it('reads explicit dialogueRanges from analysis', () => {
    expect(
      analysisDialogueRanges({
        hasDialogue: true,
        dialogueRanges: [
          { startSec: 1.2, endSec: 3.5 },
          { startSec: 8, endSec: 10 },
        ],
      }),
    ).toEqual([
      { startSec: 1.2, endSec: 3.5 },
      { startSec: 8, endSec: 10 },
    ]);
  });

  it('merges overlapping explicit ranges', () => {
    expect(
      mergeDialogueRanges([
        { startSec: 1, endSec: 3 },
        { startSec: 2.8, endSec: 5 },
        { startSec: 9, endSec: 11 },
      ]),
    ).toEqual([
      { startSec: 1, endSec: 5 },
      { startSec: 9, endSec: 11 },
    ]);
  });

  it('derives ranges from speechy segments when dialogueRanges missing', () => {
    expect(
      analysisDialogueRanges({
        hasDialogue: true,
        segments: [
          { startSec: 0, endSec: 2, speechOrAudio: 'music bed only' },
          { startSec: 2, endSec: 5, speechOrAudio: 'She says hello' },
          { startSec: 5, endSec: 8, speechOrAudio: 'He replies with a joke' },
        ],
      }),
    ).toEqual([{ startSec: 2, endSec: 8 }]);
  });

  it('returns empty when no ranges and no speechy beats', () => {
    expect(
      analysisDialogueRanges({
        hasDialogue: true,
        segments: [{ startSec: 0, endSec: 4, speechOrAudio: 'ambience only' }],
      }),
    ).toEqual([]);
  });
});

describe('analysisIndicatesNaturalSound', () => {
  it('honors an explicit hasNaturalSound flag', () => {
    expect(analysisIndicatesNaturalSound({ hasNaturalSound: true, summary: 'silent' })).toBe(true);
    expect(analysisIndicatesNaturalSound({ hasNaturalSound: false, summary: 'music bed' })).toBe(
      false,
    );
  });
});

describe('analysisPeople', () => {
  it('reads structured people rows', () => {
    expect(
      analysisPeople({
        people: [{ label: 'Li Wei', originOrContext: 'China', whyNotable: 'viral street magician' }],
      }),
    ).toEqual([
      { label: 'Li Wei', originOrContext: 'China', whyNotable: 'viral street magician' },
    ]);
  });

  it('falls back to character labels', () => {
    expect(analysisPeople({ characters: ['A chef', ''] })).toEqual([
      { label: 'A chef', originOrContext: '', whyNotable: '' },
    ]);
  });
});
