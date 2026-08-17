import { describe, expect, it } from 'vitest';
import {
  buildOverlayAssContent,
  extendCueEndsThroughSilence,
  msToAssTime,
  parseSrtCues,
} from './overlay-ass.js';

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

  it('extends cue ends through silence to next start or video end', () => {
    const held = extendCueEndsThroughSilence(
      [
        { startMs: 0, endMs: 1000, text: 'a' },
        { startMs: 2500, endMs: 3000, text: 'b' },
      ],
      5000,
    );
    expect(held[0]?.endMs).toBe(2500);
    expect(held[1]?.endMs).toBe(5000);
  });

  it('does not shrink cues that already abut or overlap the next', () => {
    const held = extendCueEndsThroughSilence([
      { startMs: 0, endMs: 2000, text: 'a' },
      { startMs: 1500, endMs: 2500, text: 'b' },
    ]);
    expect(held[0]?.endMs).toBe(2000);
    expect(held[1]?.endMs).toBe(2500);
  });

  it('holds last caption through silence in ASS dialogues', () => {
    const ass = buildOverlayAssContent({
      templateId: 'impact_hormozi',
      videoEndMs: 8000,
      cues: [
        { startMs: 0, endMs: 1000, text: 'first line here' },
        { startMs: 3000, endMs: 4000, text: 'second line here' },
      ],
    });
    const captions = ass
      .split('\n')
      .filter((l) => l.startsWith('Dialogue: 0,') && l.includes('Caption'));
    expect(captions[0]).toContain(msToAssTime(0));
    expect(captions[0]).toContain(msToAssTime(3000));
    expect(captions[1]).toContain(msToAssTime(3000));
    expect(captions[1]).toContain(msToAssTime(8000));
  });

  it('holds karaoke last word frame through silence without stretching slices', () => {
    const ass = buildOverlayAssContent({
      templateId: 'karaoke_word',
      colorMode: 'dark',
      cues: [{ startMs: 0, endMs: 900, text: 'hello world test' }],
      videoEndMs: 5000,
    });
    const dialogues = ass
      .split('\n')
      .filter((l) => l.startsWith('Dialogue: 0,') && l.includes('Caption'));
    expect(dialogues.length).toBe(3);
    // First two frames stay within the spoken window; last holds to video end.
    expect(dialogues[0]).toContain(msToAssTime(0));
    expect(dialogues[2]).toContain(msToAssTime(5000));
    // Middle frame should not extend to video end (word timing preserved).
    expect(dialogues[1]).not.toContain(msToAssTime(5000));
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
    // Captions wrap to at most 2 lines.
    expect(ass).toContain('\\N');
  });

  it('applies caption and hook positions + multi-line hooks', () => {
    const ass = buildOverlayAssContent({
      templateId: 'boxed_white',
      captionPosition: 'bottom',
      hookPosition: 'upper',
      hookText: 'TRASH TO\nTREASURE',
      cues: [{ startMs: 0, endMs: 1000, text: 'One two three four five six' }],
    });
    expect(ass).toContain('TRASH TO\\NTREASURE');
    // Continuous Y% uses Alignment 8 (top) + MarginV for both hook and caption.
    expect(ass).toMatch(/Style: Hook,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,8,/);
    expect(ass).toMatch(/Style: Caption,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,[^,]*,8,/);
    // Bottom caption should sit lower (larger MarginV) than upper hook.
    const hookStyle = ass.split('\n').find((l) => l.startsWith('Style: Hook,'))!;
    const captionStyle = ass.split('\n').find((l) => l.startsWith('Style: Caption,'))!;
    const marginOf = (line: string) => Number(line.split(',').at(-2));
    expect(marginOf(captionStyle)).toBeGreaterThan(marginOf(hookStyle));
  });

  it('expands karaoke_word into per-word dialogues', () => {
    const ass = buildOverlayAssContent({
      templateId: 'karaoke_word',
      colorMode: 'dark',
      cues: [{ startMs: 0, endMs: 800, text: 'hello world test' }],
    });
    const dialogues = ass.split('\n').filter((l) => l.startsWith('Dialogue: 0,') && l.includes('Caption'));
    expect(dialogues.length).toBe(3);
  });

  it('uses dark primary colour in light text mode', () => {
    const ass = buildOverlayAssContent({
      templateId: 'impact_center',
      colorMode: 'light',
      cues: [{ startMs: 0, endMs: 500, text: 'bright scene' }],
    });
    // #111111 → BGR &H00111111
    expect(ass).toMatch(/Style: Caption,Arial,\d+,&H00111111,/);
  });
});
