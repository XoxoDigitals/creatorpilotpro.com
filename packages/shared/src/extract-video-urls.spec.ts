import { describe, expect, it } from 'vitest';
import { extractFirstVideoUrl, extractVideoUrls } from './extract-video-urls.js';

const KWAI_SHARE = `https://v.kuaishou.com/JyUN81mc "知识播种计划 "非物质文化遗产 "民族绝技表演 This work has been played 124.4Ten thousand times in Kwai and click this link and open 【Kwai】to view!`;

describe('extractVideoUrls', () => {
  it('pulls a Kwai share link out of promo / Chinese-tag junk', () => {
    expect(extractVideoUrls(KWAI_SHARE)).toEqual(['https://v.kuaishou.com/JyUN81mc']);
  });

  it('returns a clean URL unchanged', () => {
    expect(extractVideoUrls('https://v.kuaishou.com/JyUN81mc')).toEqual([
      'https://v.kuaishou.com/JyUN81mc',
    ]);
  });

  it('extracts multiple unique URLs from one paste', () => {
    const text = `
      https://v.kuaishou.com/aaa junk
      click https://www.youtube.com/watch?v=dQw4w9wgGcQ now
      also https://v.kuaishou.com/aaa again
      https://v.kwai.com/bbb
    `;
    expect(extractVideoUrls(text)).toEqual([
      'https://v.kuaishou.com/aaa',
      'https://www.youtube.com/watch?v=dQw4w9wgGcQ',
      'https://v.kwai.com/bbb',
    ]);
  });

  it('strips trailing punctuation and markdown wrappers', () => {
    expect(extractVideoUrls('(https://v.kuaishou.com/x).')).toEqual(['https://v.kuaishou.com/x']);
    expect(extractVideoUrls('[watch](https://v.kuaishou.com/y)')).toEqual([
      'https://v.kuaishou.com/y',
    ]);
    expect(extractVideoUrls('<https://v.kuaishou.com/z>')).toEqual(['https://v.kuaishou.com/z']);
  });

  it('keeps balanced parentheses in the path', () => {
    expect(extractVideoUrls('https://example.com/wiki/Foo_(bar)')).toEqual([
      'https://example.com/wiki/Foo_(bar)',
    ]);
  });

  it('dedupes by host case without changing the path token', () => {
    expect(
      extractVideoUrls('HTTPS://V.KUAISHOU.COM/JyUN81mc https://v.kuaishou.com/JyUN81mc'),
    ).toEqual(['https://v.kuaishou.com/JyUN81mc']);
  });

  it('returns empty when there is no http(s) URL', () => {
    expect(extractVideoUrls('知识播种计划 【Kwai】 no link here')).toEqual([]);
    expect(extractVideoUrls('')).toEqual([]);
  });

  it('extractFirstVideoUrl returns the first match', () => {
    expect(extractFirstVideoUrl(KWAI_SHARE)).toBe('https://v.kuaishou.com/JyUN81mc');
    expect(extractFirstVideoUrl('nope')).toBeUndefined();
  });
});
