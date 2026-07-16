import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Ffmpeg, DHASH_FRAME_WIDTH, DHASH_FRAME_HEIGHT } from './ffmpeg.js';

/**
 * Perceptual hashing for near-duplicate detection (docs/04 §2). We use a dHash
 * (difference hash): downscale a single frame to a tiny grayscale image and
 * encode, per row, whether each pixel is brighter than its right neighbour. The
 * result is a 64-bit fingerprint where perceptually similar frames land within a
 * small Hamming distance — robust to re-encoding, minor crops, and scaling.
 */

/** Near-duplicate threshold: <= this many differing bits ⇒ treat as a dup. */
export const NEAR_DUPLICATE_HAMMING_THRESHOLD = 10;

/**
 * Compute a 64-bit dHash (16 hex chars) from a raw grayscale frame of exactly
 * (width) x (height) bytes, one byte per pixel. width must be height+1 so each
 * of the `height` rows yields `height` horizontal comparisons.
 */
export function dHash(
  pixels: Uint8Array,
  width = DHASH_FRAME_WIDTH,
  height = DHASH_FRAME_HEIGHT,
): string {
  if (pixels.length < width * height) {
    throw new Error(`dHash: frame too small — need ${width * height} bytes, got ${pixels.length}`);
  }
  let bits = 0n;
  let bit = 0n;
  for (let y = 0; y < height; y++) {
    const rowStart = y * width;
    for (let x = 0; x < width - 1; x++) {
      const left = pixels[rowStart + x] ?? 0;
      const right = pixels[rowStart + x + 1] ?? 0;
      if (left > right) bits |= 1n << bit;
      bit++;
    }
  }
  return bits.toString(16).padStart(16, '0');
}

/** Hamming distance between two equal-length hex hashes (differing bit count). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** True if two perceptual hashes are within the near-duplicate threshold. */
export function isNearDuplicate(a: string, b: string): boolean {
  return hammingDistance(a, b) <= NEAR_DUPLICATE_HAMMING_THRESHOLD;
}

/**
 * Best-effort perceptual hash of a video: extract one grayscale frame via ffmpeg
 * and dHash it. Returns undefined when ffmpeg is unavailable so the caller can
 * fall back to md5-only dedupe (docs/04 §2) instead of failing the pipeline.
 */
export async function computePerceptualHash(
  videoPath: string,
  ffmpeg: Ffmpeg = new Ffmpeg(),
): Promise<string | undefined> {
  if (!(await ffmpeg.available())) return undefined;
  const rawPath = join(tmpdir(), `scp-phash-${randomUUID()}.gray`);
  try {
    await ffmpeg.extractGrayFrame(videoPath, rawPath, DHASH_FRAME_WIDTH, DHASH_FRAME_HEIGHT);
    const pixels = await readFile(rawPath);
    return dHash(pixels, DHASH_FRAME_WIDTH, DHASH_FRAME_HEIGHT);
  } finally {
    await rm(rawPath, { force: true });
  }
}
