import { describe, expect, it } from 'vitest';
import { buildOverlayAssContent, msToAssTime, parseSrtCues } from './overlay-ass.js';

describe('overlay-ass', () => {
  it('formats ASS timestamps', () => {
    expect(msToAssTime(0)).toBe('0:00:00.00');
    expect(msToAssTime(1_500)).toBe('0:00:01.50');
    expect(msToAssTime(61_230)).toBe('0:01:01.23');
  });

  it('parses SRT cues', () => {
    const cues = parseSrtCues(`1
00:00:00,000 --> 00:00:02,000
Hello world

2
00:00:02,500 --> 00:00:04,000
Second line
`);
    expect(cues).toHaveLength(2);
    expect(cues[0]?.text).toBe('Hello world');
    expect(cues[1]?.startMs).toBe(2500);
  });

  it('builds ASS with hook + caption styles', () => {
    const ass = buildOverlayAssContent({
      templateId: 'impact_hormozi',
      hookText: 'HIDDEN SAFE',
      cues: [{ startMs: 0, endMs: 2000, text: "It's easier to make $1M than $100K" }],
    });
    expect(ass).toContain('Style: Caption');
    expect(ass).toContain('Style: Hook');
    expect(ass).toContain('HIDDEN SAFE');
    expect(ass).toContain('Dialogue:');
    // Impact templates inject ASS color overrides for emphasis words.
    expect(ass).toMatch(/\\c&H[0-9A-F]+&/);
  });
});
