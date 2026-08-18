import { describe, expect, it } from 'vitest';
import { formatYoutubeAiDescriptionRules } from './youtube-options.js';

describe('formatYoutubeAiDescriptionRules', () => {
  it('asks for a long YouTube AI description with keywords', () => {
    const rules = formatYoutubeAiDescriptionRules({ language: 'en' });
    expect(rules).toContain('YouTube AI-mode videoDescription');
    expect(rules).toContain('900–1800');
    expect(rules).toContain('Keywords:');
    expect(rules).toContain('8–15');
    expect(rules).not.toContain('Sources / Research');
  });

  it('requires research links when the package is documentary', () => {
    const rules = formatYoutubeAiDescriptionRules({ documentary: true, language: 'hi' });
    expect(rules).toContain('Hindi');
    expect(rules).toContain('Sources / Research');
    expect(rules).toContain('never invent a fake link');
    expect(rules).toContain('Keywords:');
  });

  it('asks for Roman Urdu YouTube descriptions when language is Urdu', () => {
    const rules = formatYoutubeAiDescriptionRules({ language: 'ur' });
    expect(rules).toContain('Roman Urdu');
    expect(rules).toContain('No Arabic/Urdu');
  });
});
