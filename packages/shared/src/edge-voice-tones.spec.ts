import { describe, expect, it } from 'vitest';
import { EDGE_DEFAULT_VOICE } from './voice-settings.js';
import { CONTENT_LANGUAGES } from './content-languages.js';
import { edgeVoiceTone } from './edge-voice-tones.js';

describe('edgeVoiceTone', () => {
  it('maps well-known en-US gallery voices', () => {
    expect(edgeVoiceTone('en-US-AriaNeural')).toBe('Engaging');
    expect(edgeVoiceTone(EDGE_DEFAULT_VOICE)).toBe('Engaging');
    expect(edgeVoiceTone('en-US-JennyNeural')).toBe('Friendly');
    expect(edgeVoiceTone('en-US-GuyNeural')).toBe('News');
    expect(edgeVoiceTone('en-US-ChristopherNeural')).toBe('Professional');
    expect(edgeVoiceTone('en-US-SteffanNeural')).toBe('Narration');
    expect(edgeVoiceTone('en-US-EmmaNeural')).toBe('Cheerful');
  });

  it('covers content-language default voices', () => {
    for (const lang of CONTENT_LANGUAGES) {
      expect(edgeVoiceTone(lang.voiceId), lang.voiceId).not.toBeNull();
    }
  });

  it('returns null for unknown or empty ids', () => {
    expect(edgeVoiceTone(null)).toBeNull();
    expect(edgeVoiceTone('')).toBeNull();
    expect(edgeVoiceTone('en-US-NotARealVoiceNeural')).toBeNull();
  });
});
