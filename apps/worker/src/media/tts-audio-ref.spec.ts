import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveTtsAudioSource, writeTtsAudioRef } from './tts-audio-ref.js';

describe('resolveTtsAudioSource', () => {
  it('prefers a file path on audioRef (Edge mediaPath)', () => {
    expect(resolveTtsAudioSource('/tmp/chunk.mp3', { timings: [] })).toEqual({
      kind: 'path',
      path: '/tmp/chunk.mp3',
    });
  });

  it('reads mediaPath from Edge provider output when audioRef is missing', () => {
    expect(resolveTtsAudioSource(undefined, { mediaPath: '/tmp/edge.mp3', format: 'mp3' })).toEqual({
      kind: 'path',
      path: '/tmp/edge.mp3',
    });
  });

  it('decodes data-URI audioRef', () => {
    const src = resolveTtsAudioSource('data:audio/mpeg;base64,YWJj', '');
    expect(src).toEqual({ kind: 'base64', data: 'YWJj' });
  });

  it('does not treat empty Gemini text as audio', () => {
    const src = resolveTtsAudioSource(undefined, '');
    expect(src.kind).toBe('missing');
    expect(src.kind === 'missing' && src.reason).toMatch(/missing audioRef and mediaPath/);
  });
});

describe('writeTtsAudioRef', () => {
  it('copies Edge mediaPath into the destination wav/bin path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scp-tts-ref-'));
    const src = join(dir, 'edge.mp3');
    const dest = join(dir, 'chunk.bin');
    await writeFile(src, Buffer.from('mp3-bytes'));
    await writeTtsAudioRef(undefined, { mediaPath: src }, dest);
    expect(await readFile(dest, 'utf8')).toBe('mp3-bytes');
  });

  it('throws a clear missing-audio error instead of writing nothing', async () => {
    await expect(writeTtsAudioRef(undefined, '', '/tmp/nope.bin')).rejects.toThrow(
      /missing audioRef and mediaPath/,
    );
  });
});
