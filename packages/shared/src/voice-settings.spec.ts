import { describe, expect, it } from 'vitest';
import {
  formatNarrationEmotionBlock,
  formatOpenAiTtsInstructions,
  inferTtsEmotionFromSituation,
  resolveOpenAiTtsVoice,
  mergeEmotionProsody,
  parseSpokenNarrationLines,
  parseTtsEmotion,
  parseVoiceSettings,
  parseOpenAiTtsModel,
  resolveSpokenEmotion,
  serializeSpokenNarrationLines,
  TTS_EMOTIONS,
} from './voice-settings.js';

describe('parseTtsEmotion', () => {
  it('accepts the known set and falls back to default', () => {
    expect(parseTtsEmotion('sad')).toBe('sad');
    expect(parseTtsEmotion('angry')).toBe('angry');
    expect(parseTtsEmotion('nope')).toBe('default');
    expect(parseTtsEmotion(null)).toBe('default');
  });
});

describe('parseVoiceSettings emotion', () => {
  it('keeps a valid channel fallback emotion', () => {
    const parsed = parseVoiceSettings({
      provider: 'edge',
      voiceId: 'en-US-AriaNeural',
      emotion: 'calm',
    });
    expect(parsed.emotion).toBe('calm');
  });

  it('coerces unknown emotion values to default', () => {
    const parsed = parseVoiceSettings({ emotion: 'theatrical' });
    expect(parsed.emotion).toBe('default');
  });
});

describe('mergeEmotionProsody', () => {
  it('does not emit rate/pitch for default emotion when none were set', () => {
    const merged = mergeEmotionProsody({}, 'default');
    expect(merged.rate).toBeUndefined();
    expect(merged.pitch).toBeUndefined();
    expect(merged.speed).toBe(1);
  });

  it('applies sad offsets onto channel rate/pitch/speed', () => {
    const merged = mergeEmotionProsody({ rate: '+0%', pitch: '+0Hz', speed: 1 }, 'sad');
    expect(merged.rate).toBe('-12%');
    expect(merged.pitch).toBe('-8Hz');
    expect(merged.speed).toBe(0.9);
  });

  it('sums excited offsets with an existing rate', () => {
    const merged = mergeEmotionProsody({ rate: '+10%' }, 'excited');
    expect(merged.rate).toBe('+28%');
    expect(merged.pitch).toBe('+14Hz');
  });
});

describe('formatNarrationEmotionBlock', () => {
  it('asks documentary lines to vary emotion instead of one newscast track', () => {
    const block = formatNarrationEmotionBlock();
    expect(block).toContain('fitting emotion');
    expect(block).toContain('newscast');
    expect(block).toContain('calm');
    expect(block).toContain('Documentary');
    expect(block).toContain('Repurposed');
    expect(block.toLowerCase()).toContain('do not stamp every line newscast');
    expect(block.toLowerCase()).not.toContain('mandatory');
    expect(block).not.toContain('SITUATION');
  });

  it('does not require a Voice-tab fallback line', () => {
    const block = formatNarrationEmotionBlock('empathetic');
    expect(block).toContain('newscast');
    expect(block).not.toContain('Voice-tab default');
  });
});

describe('parseSpokenNarrationLines', () => {
  it('keeps text+emotion pairs and ignores TTS timings without emotion', () => {
    expect(
      parseSpokenNarrationLines([
        { text: 'They lost her.', emotion: 'sad' },
        { startMs: 0, endMs: 1200, text: 'Hello' },
      ]),
    ).toEqual([{ text: 'They lost her.', emotion: 'sad' }]);
  });

  it('round-trips JSON stored in editing extras', () => {
    const json = serializeSpokenNarrationLines([
      { text: 'We wait.', emotion: 'calm' },
      { text: 'How dare you.', emotion: 'angry' },
    ]);
    expect(parseSpokenNarrationLines(json)).toEqual([
      { text: 'We wait.', emotion: 'calm' },
      { text: 'How dare you.', emotion: 'angry' },
    ]);
  });
});

describe('resolveSpokenEmotion', () => {
  it('prefers a tagged line emotion over fallback', () => {
    expect(resolveSpokenEmotion('angry', 'calm', 'a quiet wait')).toBe('angry');
  });

  it('infers from situation text when the tag is missing', () => {
    expect(resolveSpokenEmotion(undefined, 'calm', 'her funeral and grief')).toBe('sad');
    expect(inferTtsEmotionFromSituation('they shout during the argument')).toBe('angry');
  });

  it('uses the channel fallback when nothing else matches', () => {
    expect(resolveSpokenEmotion(undefined, 'newscast', 'the next morning')).toBe('newscast');
  });
});

describe('OpenAI gpt-4o-mini-tts helpers', () => {
  it('maps unknown voice ids to coral', () => {
    expect(resolveOpenAiTtsVoice('en-US-AriaNeural')).toBe('coral');
    expect(resolveOpenAiTtsVoice('sage')).toBe('sage');
    expect(resolveOpenAiTtsVoice('verse', 'tts-1')).toBe('coral');
    expect(resolveOpenAiTtsVoice('verse', 'gpt-4o-mini-tts')).toBe('verse');
  });

  it('parses saved OpenAI speech models', () => {
    const parsed = parseVoiceSettings({
      provider: 'openai',
      voiceId: 'coral',
      openaiTtsModel: 'tts-1-hd',
    });
    expect(parsed.provider).toBe('openai');
    expect(parsed.openaiTtsModel).toBe('tts-1-hd');
    expect(parseOpenAiTtsModel('nope')).toBe('gpt-4o-mini-tts');
  });

  it('writes emotion instructions and a kids-rhyme overlay', () => {
    const kids = formatOpenAiTtsInstructions('playful', { kidsRhyme: true });
    expect(kids.toLowerCase()).toContain('playful');
    expect(kids.toLowerCase()).toContain('nursery');
    expect(kids.toLowerCase()).not.toContain('angry');
  });

  it('names the spoken language for OpenAI (no per-language model)', () => {
    expect(formatOpenAiTtsInstructions('cheerful', { language: 'ur' }).toLowerCase()).toContain(
      'urdu',
    );
    expect(formatOpenAiTtsInstructions('cheerful', { language: 'en' }).toLowerCase()).toContain(
      'english',
    );
  });
});
