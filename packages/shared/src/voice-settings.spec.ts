import { describe, expect, it } from 'vitest';
import {
  formatNarrationEmotionBlock,
  inferTtsEmotionFromSituation,
  mergeEmotionProsody,
  parseTtsEmotion,
  parseVoiceSettings,
  resolveSpokenEmotion,
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
  it('requires per-line situation emotion and lists allowed values', () => {
    const block = formatNarrationEmotionBlock();
    expect(block).toContain('SITUATION');
    for (const emotion of TTS_EMOTIONS) {
      expect(block).toContain(emotion);
    }
    expect(block).toContain('never name the emotion');
  });

  it('mentions the channel Voice-tab fallback when set', () => {
    const block = formatNarrationEmotionBlock('empathetic');
    expect(block).toContain('empathetic');
    expect(block).toContain('Voice-tab default');
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
