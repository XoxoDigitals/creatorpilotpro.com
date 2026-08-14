import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  Ffmpeg,
  FfmpegNotAvailableError,
  DHASH_FRAME_WIDTH,
  DHASH_FRAME_HEIGHT,
  VOICEOVER_ENHANCE_AF,
  VOICEOVER_MIX_ENHANCE_AF,
  VO_MIX_VOICE_GAIN,
  VO_MIX_BED_GAIN,
  VO_MIX_DIALOGUE_BED_GAIN,
  VO_MIX_DEMUCS_BED_GAIN,
  VO_MIX_BED_CONTROL,
  VO_MIX_SIDECHAIN,
  VO_MIX_DIALOGUE_SIDECHAIN,
  VOCAL_STRIP_AF,
  DIALOGUE_BED_CLEANUP_AF,
  voiceoverBedMixFilter,
  voiceoverDialogueBedMixFilter,
  voiceoverDialogueBedMixFilterWithRanges,
  padMixToVideoDuration,
  muxStopAtPictureArgs,
  VO_ONLY_PAD_TO_VIDEO_FILTER,
  PADDED_MIX_AUDIO_MAP,
  muteDialogueRangesAf,
  muteAfterVoAf,
  summarizeFfmpegStderr,
  signedExitCode,
  type CommandRunner,
  type RunResult,
} from './ffmpeg.js';
import {
  dHash,
  hammingDistance,
  isNearDuplicate,
  computePerceptualHash,
  NEAR_DUPLICATE_HAMMING_THRESHOLD,
} from './phash.js';

interface Call {
  cmd: string;
  args: string[];
}

/**
 * Mock runner: `-version` succeeds unless `available:false`. If `writeRaw` is
 * given, the frame-extract call writes those bytes to its output path so the
 * perceptual-hash read path can be exercised without a real ffmpeg.
 */
function mockRunner(opts: { available?: boolean; result?: Partial<RunResult>; writeRaw?: Uint8Array } = {}) {
  const calls: Call[] = [];
  const runner: CommandRunner = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args[0] === '-version') {
      if (opts.available === false) throw new Error('spawn ffmpeg ENOENT');
      return { stdout: 'ffmpeg version 6.0\n', stderr: '', code: 0 };
    }
    if (opts.writeRaw && args.includes('rawvideo')) {
      const outPath = args[args.length - 1] as string;
      writeFileSync(outPath, Buffer.from(opts.writeRaw));
    }
    return { stdout: '', stderr: '', code: 0, ...opts.result };
  };
  return { runner, calls };
}

/** A frame whose every row strictly decreases left→right ⇒ all 64 dHash bits set. */
function decreasingFrame(): Uint8Array {
  const px = new Uint8Array(DHASH_FRAME_WIDTH * DHASH_FRAME_HEIGHT);
  for (let y = 0; y < DHASH_FRAME_HEIGHT; y++) {
    for (let x = 0; x < DHASH_FRAME_WIDTH; x++) {
      px[y * DHASH_FRAME_WIDTH + x] = (DHASH_FRAME_WIDTH - x) * 20;
    }
  }
  return px;
}

describe('dHash', () => {
  it('is all-zero for a flat (uniform) frame', () => {
    const flat = new Uint8Array(DHASH_FRAME_WIDTH * DHASH_FRAME_HEIGHT).fill(128);
    expect(dHash(flat)).toBe('0000000000000000');
  });

  it('is all-ones when every row strictly decreases left→right', () => {
    expect(dHash(decreasingFrame())).toBe('ffffffffffffffff');
  });

  it('throws when the frame is too small', () => {
    expect(() => dHash(new Uint8Array(10))).toThrow(/frame too small/);
  });
});

describe('hammingDistance / near-duplicate', () => {
  it('is 0 for identical hashes', () => {
    expect(hammingDistance('ffffffffffffffff', 'ffffffffffffffff')).toBe(0);
  });

  it('counts differing bits', () => {
    // 0xF (1111) vs 0x0 (0000) differ in 4 bits.
    expect(hammingDistance('000000000000000f', '0000000000000000')).toBe(4);
  });

  it('flags near-duplicates at/under the threshold and rejects beyond it', () => {
    const base = '0000000000000000';
    const withinBits = (1n << BigInt(NEAR_DUPLICATE_HAMMING_THRESHOLD)) - 1n; // exactly threshold bits
    const beyond = (1n << BigInt(NEAR_DUPLICATE_HAMMING_THRESHOLD + 1)) - 1n; // threshold+1 bits
    expect(isNearDuplicate(base, withinBits.toString(16).padStart(16, '0'))).toBe(true);
    expect(isNearDuplicate(base, beyond.toString(16).padStart(16, '0'))).toBe(false);
  });
});

describe('Ffmpeg.available', () => {
  it('is true when the binary answers -version', async () => {
    const { runner } = mockRunner();
    expect(await new Ffmpeg('ffmpeg', runner).available()).toBe(true);
  });

  it('is false when the binary is missing (ENOENT)', async () => {
    const { runner } = mockRunner({ available: false });
    expect(await new Ffmpeg('ffmpeg', runner).available()).toBe(false);
  });
});

describe('Ffmpeg.enhanceVoiceover', () => {
  it('applies the EQ/compressor/loudnorm chain to a 44.1k mono wav', async () => {
    const { runner, calls } = mockRunner();
    await new Ffmpeg('ffmpeg', runner).enhanceVoiceover('/raw.mp3', '/enhanced.wav');
    const enc = calls.find((c) => c.args.includes('-af'));
    expect(enc?.args).toEqual(
      expect.arrayContaining([
        '-i',
        '/raw.mp3',
        '-af',
        VOICEOVER_ENHANCE_AF,
        '-ar',
        '44100',
        '-ac',
        '1',
        '-y',
        '/enhanced.wav',
      ]),
    );
  });

  it('throws FfmpegNotAvailableError when ffmpeg is missing', async () => {
    const { runner } = mockRunner({ available: false });
    await expect(
      new Ffmpeg('ffmpeg', runner).enhanceVoiceover('/raw.mp3', '/enhanced.wav'),
    ).rejects.toBeInstanceOf(FfmpegNotAvailableError);
  });
});

describe('voiceoverBedMixFilter', () => {
  it('keeps the TTS enhance chain plus EBU loudnorm', () => {
    expect(VOICEOVER_ENHANCE_AF).toBe(
      `${VOICEOVER_MIX_ENHANCE_AF},loudnorm=I=-16:TP=-1:LRA=7`,
    );
    expect(VOICEOVER_MIX_ENHANCE_AF).toContain('highpass=f=70');
    expect(VOICEOVER_MIX_ENHANCE_AF).toContain('acompressor=');
  });

  it('keeps VO clearly above a capped, ducked bed', () => {
    expect(VO_MIX_VOICE_GAIN).toBe(0.85);
    expect(VO_MIX_BED_GAIN).toBe(0.16);
    expect(VO_MIX_VOICE_GAIN).toBeGreaterThan(VO_MIX_BED_GAIN);
    expect(VO_MIX_BED_CONTROL).toContain('loudnorm=I=-28');
    expect(VO_MIX_BED_CONTROL).toContain('alimiter=limit=0.38');
    expect(VO_MIX_BED_CONTROL).toContain('acompressor=');
    expect(VO_MIX_SIDECHAIN).toContain('threshold=0.05');
    expect(VO_MIX_SIDECHAIN).toContain('ratio=6');
    expect(VO_MIX_SIDECHAIN).toContain('knee=6');
    expect(VO_MIX_SIDECHAIN).not.toContain('knee=10');
    const graph = voiceoverBedMixFilter('0:a', VO_MIX_BED_GAIN);
    expect(graph).toContain(`[1:a]volume=${VO_MIX_VOICE_GAIN},asplit=2[vo][vo_sc]`);
    expect(graph).toContain(`[0:a]${VO_MIX_BED_CONTROL},volume=${VO_MIX_BED_GAIN}[bg]`);
    expect(graph).toContain(`[bg][vo_sc]${VO_MIX_SIDECHAIN}[ducked]`);
    expect(graph).toContain('amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mixed]');
  });

  it('mutes the bed after the voiceover ends', () => {
    expect(muteAfterVoAf(null)).toBeNull();
    expect(muteAfterVoAf(12.5)).toContain("volume=0:enable='gte(t\\,12.5)'");
    const graph = voiceoverBedMixFilter('0:a', VO_MIX_BED_GAIN, VO_MIX_SIDECHAIN, 45);
    expect(graph).toContain("volume=0:enable='gte(t\\,45)'");
    expect(graph).toContain(VO_MIX_BED_CONTROL);
  });

  it('uses a very quiet dialogue bed with hard duck', () => {
    expect(VO_MIX_DIALOGUE_BED_GAIN).toBe(0.08);
    expect(VO_MIX_DEMUCS_BED_GAIN).toBe(VO_MIX_DIALOGUE_BED_GAIN);
    expect(VO_MIX_DIALOGUE_BED_GAIN).toBeLessThan(VO_MIX_BED_GAIN);
    expect(VO_MIX_DIALOGUE_SIDECHAIN).toContain('ratio=12');
    expect(VO_MIX_DIALOGUE_SIDECHAIN).toContain('threshold=0.04');
    const graph = voiceoverDialogueBedMixFilter('2:a');
    expect(graph).toContain(`[2:a]${VO_MIX_BED_CONTROL},volume=${VO_MIX_DIALOGUE_BED_GAIN}[bg]`);
    expect(graph).toContain(VO_MIX_DIALOGUE_SIDECHAIN);
    expect(graph).toContain(`[1:a]volume=${VO_MIX_VOICE_GAIN},asplit=2[vo][vo_sc]`);
  });

  it('hard-mutes AI dialogue ranges on the bed before duck', () => {
    expect(muteDialogueRangesAf([])).toBeNull();
    expect(muteDialogueRangesAf([{ startSec: 1.2, endSec: 3.5 }])).toContain(
      "volume=0:enable='between(t\\,1.2\\,3.5)'",
    );
    const graph = voiceoverDialogueBedMixFilterWithRanges([
      { startSec: 1, endSec: 2 },
      { startSec: 5, endSec: 7 },
    ]);
    expect(graph).toContain('volume=0:enable=');
    expect(graph).toContain('between(t\\,1\\,2)');
    expect(graph).toContain('between(t\\,5\\,7)');
    expect(graph).toContain(VO_MIX_DIALOGUE_SIDECHAIN);
  });

  it('pads mixed/VO audio so mux duration follows picture, not voiceover', () => {
    const graph = padMixToVideoDuration(voiceoverBedMixFilter('0:a', VO_MIX_BED_GAIN));
    expect(graph).toContain('amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mixed]');
    expect(graph).toContain('[mixed]apad[aud]');
    const ranged = padMixToVideoDuration(
      voiceoverDialogueBedMixFilterWithRanges([{ startSec: 1, endSec: 2 }]),
    );
    expect(ranged).toContain('volume=0:enable=');
    expect(ranged).toContain('[mixed]apad[aud]');
    expect(VO_ONLY_PAD_TO_VIDEO_FILTER).toBe('[1:a]apad[aud]');
    expect(PADDED_MIX_AUDIO_MAP).toBe('[aud]');
    expect(muxStopAtPictureArgs(14)).toEqual(['-shortest', '-t', '14.000']);
    expect(muxStopAtPictureArgs(null)).toEqual(['-shortest']);
  });

  it('exports an aggressive vocal-strip filter (not weak karaoke alone)', () => {
    expect(VOCAL_STRIP_AF).toContain('stereotools=mlev=0.02');
    expect(VOCAL_STRIP_AF).toContain('agate=');
    expect(VOCAL_STRIP_AF).toContain('equalizer=f=1800');
    expect(DIALOGUE_BED_CLEANUP_AF).toContain('agate=');
    expect(DIALOGUE_BED_CLEANUP_AF).toContain('equalizer=f=1600');
  });
});

describe('Ffmpeg.stripVocalsToWav', () => {
  it('extracts a stereo no-vocals wav', async () => {
    const { runner, calls } = mockRunner();
    await new Ffmpeg('ffmpeg', runner).stripVocalsToWav('/in.mp4', '/bed.wav');
    const enc = calls.find((c) => c.args.includes(VOCAL_STRIP_AF));
    expect(enc?.args).toEqual(
      expect.arrayContaining([
        '-i',
        '/in.mp4',
        '-vn',
        '-af',
        VOCAL_STRIP_AF,
        '-y',
        '/bed.wav',
      ]),
    );
  });
});

describe('Ffmpeg.cleanupDialogueBed', () => {
  it('applies residual speech cleanup', async () => {
    const { runner, calls } = mockRunner();
    await new Ffmpeg('ffmpeg', runner).cleanupDialogueBed('/raw.wav', '/clean.wav');
    const enc = calls.find((c) => c.args.includes(DIALOGUE_BED_CLEANUP_AF));
    expect(enc?.args).toEqual(
      expect.arrayContaining([
        '-i',
        '/raw.wav',
        '-vn',
        '-af',
        DIALOGUE_BED_CLEANUP_AF,
        '-y',
        '/clean.wav',
      ]),
    );
  });
});

describe('summarizeFfmpegStderr', () => {
  it('prefers Error / filter-parse lines over the version banner', () => {
    const stderr = [
      'ffmpeg version N-125365-g9a01c1cb6a-20260630 Copyright (c) 2000-2026 the FFmpeg developers',
      'built with gcc 15.2.0 (crosstool-NG 1.28.0.23_185f348)',
      'configuration: --prefix=/ffbuild/prefix --pkg-config-flags=--static',
      "[Parsed_sidechaincompress_3 @ 0000] Value 10.000000 for parameter 'knee' out of range [1 - 8]",
      "[fc#0 @ 0000] Error applying option 'knee' to filter 'sidechaincompress': Result too large",
      'Error : Result too large',
    ].join('\n');
    const summary = summarizeFfmpegStderr(stderr);
    expect(summary).toMatch(/out of range/);
    expect(summary).toMatch(/Error applying option 'knee'/);
    expect(summary).not.toMatch(/ffmpeg version/);
    expect(summary).not.toMatch(/configuration:/);
  });

  it('maps Windows unsigned wrap of -34', () => {
    expect(signedExitCode(4294967262)).toBe(-34);
  });
});

describe('Ffmpeg.exec', () => {
  it('surfaces the Error line instead of the version banner', async () => {
    const { runner } = mockRunner({
      result: {
        code: 4294967262,
        stderr:
          'ffmpeg version N-125365 Copyright (c) 2000-2026\nconfiguration: --prefix=/ffbuild\nError applying option knee: Result too large\n',
      },
    });
    await expect(new Ffmpeg('ffmpeg', runner).exec(['-i', '/in.mp4'])).rejects.toThrow(
      /ffmpeg failed \(-34\): .*Error applying option knee/,
    );
  });
});

describe('Ffmpeg.trimNormalize', () => {
  it('seeks past trimStartMs and re-encodes to mp4', async () => {
    const { runner, calls } = mockRunner();
    await new Ffmpeg('ffmpeg', runner).trimNormalize('/in.mp4', '/out.mp4', { trimStartMs: 500 });
    const enc = calls.find((c) => c.args.includes('libx264'));
    expect(enc?.args).toEqual(
      expect.arrayContaining(['-ss', '0.5', '-i', '/in.mp4', '-movflags', '+faststart', '-y', '/out.mp4']),
    );
  });

  it('omits -ss when trimStartMs is 0', async () => {
    const { runner, calls } = mockRunner();
    await new Ffmpeg('ffmpeg', runner).trimNormalize('/in.mp4', '/out.mp4', { trimStartMs: 0 });
    const enc = calls.find((c) => c.args.includes('libx264'));
    expect(enc?.args).not.toContain('-ss');
  });

  it('throws FfmpegNotAvailableError when ffmpeg is missing', async () => {
    const { runner } = mockRunner({ available: false });
    await expect(new Ffmpeg('ffmpeg', runner).trimNormalize('/in.mp4', '/out.mp4')).rejects.toBeInstanceOf(
      FfmpegNotAvailableError,
    );
  });

  it('throws on a non-zero exit', async () => {
    const { runner } = mockRunner({ result: { code: 1, stderr: 'Invalid data' } });
    await expect(new Ffmpeg('ffmpeg', runner).trimNormalize('/in.mp4', '/out.mp4')).rejects.toThrow(
      /Invalid data/,
    );
  });
});

describe('computePerceptualHash', () => {
  it('returns undefined when ffmpeg is unavailable (md5-only fallback)', async () => {
    const { runner } = mockRunner({ available: false });
    expect(await computePerceptualHash('/clip.mp4', new Ffmpeg('ffmpeg', runner))).toBeUndefined();
  });

  it('extracts a frame and returns its dHash', async () => {
    const frame = decreasingFrame();
    const { runner } = mockRunner({ writeRaw: frame });
    const hash = await computePerceptualHash('/clip.mp4', new Ffmpeg('ffmpeg', runner));
    expect(hash).toBe(dHash(frame));
  });
});
