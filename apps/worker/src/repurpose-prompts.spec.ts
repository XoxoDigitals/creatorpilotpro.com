import { describe, expect, it } from 'vitest';
import {
  extractNarrationScript,
  repurposePromptVersion,
  REPURPOSE_PROMPT_REV,
  videoAnalysisOutputSchema,
  narrationRewriteOutputSchema,
} from './repurpose-prompts.js';

describe('extractNarrationScript', () => {
  it('pulls script from structured narration output', () => {
    expect(
      extractNarrationScript({
        script: 'Let’s open this box. Now watch what happens next.',
        hook: 'Let’s open this box.',
      }),
    ).toBe('Let’s open this box. Now watch what happens next.');
  });

  it('parses JSON string wrappers', () => {
    expect(
      extractNarrationScript('{"script":"Hello world","hook":"Hello"}'),
    ).toBe('Hello world');
  });

  it('passes through plain text', () => {
    expect(extractNarrationScript('Just talk.')).toBe('Just talk.');
  });
});

describe('repurposePromptVersion', () => {
  it('folds the builtin pipeline rev into the cache version', () => {
    expect(repurposePromptVersion(1)).toBe(100 + REPURPOSE_PROMPT_REV);
    expect(repurposePromptVersion(null)).toBe(100 + REPURPOSE_PROMPT_REV);
    expect(repurposePromptVersion(3)).toBe(300 + REPURPOSE_PROMPT_REV);
  });
});

describe('repurpose schemas', () => {
  it('accepts a beat-by-beat analysis', () => {
    const parsed = videoAnalysisOutputSchema.parse({
      summary: 'A short unboxing.',
      overallWhatHappens: 'Person opens a box and reacts.',
      durationSec: 12,
      segments: [
        { startSec: 0, endSec: 4, whatHappens: 'Holds sealed box to camera' },
        { startSec: 4, endSec: 12, whatHappens: 'Opens box and lifts item' },
      ],
    });
    expect(parsed.segments).toHaveLength(2);
  });

  it('accepts storytelling narration JSON', () => {
    const parsed = narrationRewriteOutputSchema.parse({
      script: 'Okay let’s do this — first we crack the seal…',
      hook: 'Okay let’s do this',
      estimatedSpokenSec: 11,
    });
    expect(parsed.script).toContain('let’s do this');
  });
});
