import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  Ffmpeg,
  FfmpegNotAvailableError,
  DHASH_FRAME_WIDTH,
  DHASH_FRAME_HEIGHT,
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
