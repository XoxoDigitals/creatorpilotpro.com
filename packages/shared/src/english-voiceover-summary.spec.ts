import { describe, expect, it } from 'vitest';
import {
  extractEnglishSummaryText,
  needsEnglishVoiceoverSummary,
  parseEnglishSummariesBatch,
} from './english-voiceover-summary.js';

describe('english voiceover summary helpers', () => {
  it('needs a summary only for non-English channel languages', () => {
    expect(needsEnglishVoiceoverSummary('en')).toBe(false);
    expect(needsEnglishVoiceoverSummary('en-US')).toBe(false);
    expect(needsEnglishVoiceoverSummary('de')).toBe(true);
    expect(needsEnglishVoiceoverSummary('hi')).toBe(true);
  });

  it('extracts plain prose and fenced JSON summaries', () => {
    expect(extractEnglishSummaryText('A short English summary.')).toBe('A short English summary.');
    expect(
      extractEnglishSummaryText('```json\n{"englishSummary":"From JSON."}\n```'),
    ).toBe('From JSON.');
    expect(extractEnglishSummaryText({ englishSummary: 'Object form.' })).toBe('Object form.');
  });

  it('parses batch summaries by variant id', () => {
    const map = parseEnglishSummariesBatch(
      {
        summaries: [
          { id: 'explainer', englishSummary: 'Explains the scene.' },
          { id: 'styleB', englishSummary: 'Hooky take.' },
        ],
      },
      ['explainer', 'styleB', 'styleC'],
    );
    expect(map.get('explainer')).toBe('Explains the scene.');
    expect(map.get('styleB')).toBe('Hooky take.');
    expect(map.has('styleC')).toBe(false);
  });
});
