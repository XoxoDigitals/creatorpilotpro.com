import { describe, expect, it } from 'vitest';
import {
  extractNarrationScript,
  repurposePromptVersion,
  REPURPOSE_PROMPT_REV,
  videoAnalysisOutputSchema,
  narrationRewriteOutputSchema,
  defaultMetadataPrompt,
  defaultNarrationRewritePrompt,
  DEFAULT_VIDEO_ANALYSIS_PROMPT,
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

  it('pulls the explainer variant when present', () => {
    expect(
      extractNarrationScript({
        variants: [
          { id: 'styleB', script: 'Hype take.' },
          { id: 'explainer', script: 'Clear explainer take.' },
        ],
      }),
    ).toBe('Clear explainer take.');
  });

  it('pulls a selected variant id', () => {
    expect(
      extractNarrationScript(
        {
          variants: [
            { id: 'explainer', script: 'A' },
            { id: 'styleC', script: 'Calm take.' },
          ],
        },
        'styleC',
      ),
    ).toBe('Calm take.');
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

describe('metadata prompt language', () => {
  it('asks for publish copy in the selected language', () => {
    const prompt = defaultMetadataPrompt('YOUTUBE', 'hi');
    expect(prompt).toContain('Hindi');
    expect(prompt).toContain('title, description, tags');
    expect(prompt).toContain('LANGUAGE POLICY');
  });
});

describe('narration prompt', () => {
  it('asks for three timed variants in the channel language', () => {
    const prompt = defaultNarrationRewritePrompt('hi');
    expect(prompt).toContain('THREE different VOICEOVER SCRIPTS');
    expect(prompt).toContain('explainer');
    expect(prompt).toContain('styleB');
    expect(prompt).toContain('styleC');
    expect(prompt).toContain('maxSpokenSec');
    expect(prompt).toContain('Hindi');
  });

  it('requires Explainer to narrate character dialogue in third person', () => {
    const prompt = defaultNarrationRewritePrompt('en');
    expect(prompt).toContain('CRITICAL — character dialogue');
    expect(prompt).toContain('She asks');
    expect(prompt).toContain('He replies');
    expect(prompt).toContain('third-person');
    expect(prompt).toContain('NATURAL pace');
    expect(prompt).toContain('maxWords');
  });
});

describe('video analysis prompt', () => {
  it('asks for dialogueRanges when spoken dialogue is present', () => {
    expect(DEFAULT_VIDEO_ANALYSIS_PROMPT).toContain('dialogueRanges');
    expect(DEFAULT_VIDEO_ANALYSIS_PROMPT).toContain('precise time windows');
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

  it('accepts dialogue + people fields on analysis', () => {
    const parsed = videoAnalysisOutputSchema.parse({
      summary: 'A street performer draws a crowd.',
      overallWhatHappens: 'Magician performs then bows.',
      durationSec: 20,
      hasDialogue: false,
      hasNaturalSound: true,
      dialogueRanges: [],
      people: [{ label: 'Li Wei', originOrContext: 'China', whyNotable: 'viral magician' }],
      segments: [{ startSec: 0, endSec: 20, whatHappens: 'Performs card tricks' }],
    });
    expect(parsed.hasDialogue).toBe(false);
    expect(parsed.dialogueRanges).toEqual([]);
    expect(parsed.people).toHaveLength(1);
  });

  it('accepts dialogueRanges windows on analysis', () => {
    const parsed = videoAnalysisOutputSchema.parse({
      summary: 'Two people talk at a stall.',
      overallWhatHappens: 'Buyer asks price; vendor replies.',
      durationSec: 10,
      hasDialogue: true,
      dialogueRanges: [
        { startSec: 1, endSec: 3.5 },
        { startSec: 6, endSec: 8 },
      ],
      segments: [
        {
          startSec: 0,
          endSec: 5,
          whatHappens: 'Buyer approaches',
          speechOrAudio: 'Buyer asks the price',
        },
        {
          startSec: 5,
          endSec: 10,
          whatHappens: 'Vendor answers',
          speechOrAudio: 'Vendor says twenty',
        },
      ],
    });
    expect(parsed.dialogueRanges).toHaveLength(2);
    expect(parsed.dialogueRanges[0]).toEqual({ startSec: 1, endSec: 3.5 });
  });

  it('accepts storytelling narration JSON', () => {
    const parsed = narrationRewriteOutputSchema.parse({
      script: 'Okay let’s do this — first we crack the seal…',
      hook: 'Okay let’s do this',
      estimatedSpokenSec: 11,
    });
    expect(parsed.script).toContain('let’s do this');
  });

  it('accepts three narration variants with scene lines', () => {
    const parsed = narrationRewriteOutputSchema.parse({
      variants: [
        {
          id: 'explainer',
          script: 'First the box opens.',
          lines: [{ startSec: 0, endSec: 4, text: 'First the box opens.' }],
        },
        { id: 'styleB', script: 'Wait until you see this box.' },
        { id: 'styleC', script: 'A sealed box sits on the table.' },
      ],
    });
    expect(parsed.variants).toHaveLength(3);
  });
});
