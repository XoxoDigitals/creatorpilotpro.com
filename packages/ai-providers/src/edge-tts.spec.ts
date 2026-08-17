import { describe, expect, it } from 'vitest';
import { mergeEmotionProsody } from '@scp/shared';
import {
  parseSubtitleTimings,
  segmentsToSrt,
  offsetTimings,
  EDGE_TTS_DEFAULT_VOICE,
} from './edge-tts.js';

describe('edge-tts subtitle parsing', () => {
  it('parses SRT-style cues written by edge-tts --write-subtitles', () => {
    const raw = `1
00:00:00,100 --> 00:00:02,987
Hello from Social Creator Pilot.

2
00:00:02,937 --> 00:00:05,687
This is a short narration sample.
`;
    const segs = parseSubtitleTimings(raw);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({
      startMs: 100,
      endMs: 2987,
      text: 'Hello from Social Creator Pilot.',
    });
    expect(segs[1]?.text).toContain('short narration');
  });

  it('parses WEBVTT cues', () => {
    const raw = `WEBVTT

00:00:00.000 --> 00:00:01.500
First line

00:00:01.500 --> 00:00:03.000
Second line
`;
    const segs = parseSubtitleTimings(raw);
    expect(segs).toHaveLength(2);
    expect(segs[0]?.startMs).toBe(0);
    expect(segs[1]?.endMs).toBe(3000);
  });

  it('offsets timings for chunk concat', () => {
    const offset = offsetTimings([{ startMs: 0, endMs: 1000, text: 'a' }], 2500);
    expect(offset[0]).toEqual({ startMs: 2500, endMs: 3500, text: 'a' });
  });

  it('round-trips SRT', () => {
    const segs = [
      { startMs: 0, endMs: 1200, text: 'Hello' },
      { startMs: 1200, endMs: 2400, text: 'World' },
    ];
    const srt = segmentsToSrt(segs);
    expect(parseSubtitleTimings(srt)).toEqual(segs);
  });

  it('exports default Aria voice', () => {
    expect(EDGE_TTS_DEFAULT_VOICE).toBe('en-US-AriaNeural');
  });

  it('applies emotion via rate/pitch offsets, not SSML tags', () => {
    const sad = mergeEmotionProsody({ rate: '+0%', pitch: '+0Hz' }, 'sad');
    expect(sad.rate).toBe('-12%');
    expect(sad.pitch).toBe('-8Hz');
    const excited = mergeEmotionProsody({}, 'excited');
    expect(excited.rate).toBe('+18%');
    expect(excited.pitch).toBe('+14Hz');
  });
});
