import { describe, expect, it } from 'vitest';
import {
  formatImpactAssText,
  pickHighlightIndices,
  previewCaptionSpans,
  normalizeCaptionTemplateId,
  buildKaraokeAssCueEvents,
  resolveCaptionColors,
  captionTemplateMeta,
  normalizeCaptionColorMode,
} from './caption-templates.js';

describe('impact caption formatting', () => {
  it('defaults unknown ids to impact_hormozi', () => {
    expect(normalizeCaptionTemplateId('nope')).toBe('impact_hormozi');
  });

  it('picks money / long words for highlights', () => {
    const words = "IT'S EASIER TO MAKE $1M THAN $100K".split(' ');
    const idx = pickHighlightIndices(words, 3);
    expect(idx.length).toBeGreaterThan(0);
    expect(idx.some((i) => words[i]?.includes('$'))).toBe(true);
  });

  it('formats hormozi ASS with color tags', () => {
    const text = formatImpactAssText("It's easier to make $1M than $100K", 'impact_hormozi');
    expect(text).toContain('$1M');
    expect(text).toMatch(/\\c&H/);
  });

  it('formats cyan phrase as two lines', () => {
    const text = formatImpactAssText("Yeah dude it's crazy", 'impact_cyan');
    expect(text).toContain('\\N');
    expect(text.toUpperCase()).toContain('YEAH');
  });

  it('builds preview spans with accent colors', () => {
    const spans = previewCaptionSpans('Easier to make money fast', 'impact_yellow');
    expect(spans.length).toBeGreaterThan(1);
    expect(spans.some((s) => s.color === '#FFE566')).toBe(true);
  });

  it('switches to dark text in light color mode', () => {
    const colors = resolveCaptionColors(captionTemplateMeta('impact_center'), 'light');
    expect(colors.color).toBe('#111111');
    expect(colors.outline).toBe('#FFFFFF');
    expect(normalizeCaptionColorMode('light')).toBe('light');
  });

  it('builds karaoke word frames timed across the cue', () => {
    const frames = buildKaraokeAssCueEvents(
      { startMs: 0, endMs: 1000, text: 'one two three four' },
      'karaoke_word',
      'dark',
    );
    expect(frames.length).toBe(4);
    expect(frames[0]?.startMs).toBe(0);
    expect(frames[3]?.endMs).toBe(1000);
    expect(frames.some((f) => f.text.includes('\\c&H'))).toBe(true);
  });
});
