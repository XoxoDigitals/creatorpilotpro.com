import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YtDlp, YtDlpNotAvailableError, hashFile } from './ytdlp.js';
import type { CommandRunner, RunResult } from './ytdlp.js';
import { KuaishouAdapter } from './kuaishou.js';
import { GenericUrlAdapter } from './generic-url.js';
import type { WatchedSource } from './types.js';

// A real on-disk file: download() hashes the destination from disk, and the
// mocked runner never actually writes it.
let tmpDir: string;
let destPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'scp-src-'));
  destPath = join(tmpDir, 'clip.mp4');
  writeFileSync(destPath, Buffer.from('fake-mp4-bytes'));
});
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

interface Call {
  cmd: string;
  args: string[];
}

/**
 * Mock runner: `--version` succeeds unless `available:false`, every other
 * invocation returns the queued response. Records calls for assertions.
 */
function mockRunner(opts: { available?: boolean; result?: Partial<RunResult> } = {}) {
  const calls: Call[] = [];
  const runner: CommandRunner = async (cmd, args) => {
    calls.push({ cmd, args });
    if (args[0] === '--version') {
      if (opts.available === false) throw new Error('spawn yt-dlp ENOENT');
      return { stdout: '2025.01.01\n', stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0, ...opts.result };
  };
  return { runner, calls };
}

function source(over: Partial<WatchedSource> = {}): WatchedSource {
  return { id: 'ws-1', type: 'KUAISHOU_PROFILE', url: 'https://kuaishou.com/profile/abc', ...over };
}

describe('YtDlp.available', () => {
  it('is true when the binary answers --version', async () => {
    const { runner } = mockRunner();
    expect(await new YtDlp('yt-dlp', runner).available()).toBe(true);
  });

  it('is false when the binary is missing (ENOENT)', async () => {
    const { runner } = mockRunner({ available: false });
    expect(await new YtDlp('yt-dlp', runner).available()).toBe(false);
  });

  it('is false on a non-zero exit', async () => {
    const runner: CommandRunner = async () => ({ stdout: '', stderr: 'boom', code: 1 });
    expect(await new YtDlp('yt-dlp', runner).available()).toBe(false);
  });
});

describe('YtDlp.listEntries', () => {
  const ndjson = [
    JSON.stringify({
      id: 'vid1',
      webpage_url: 'https://kuaishou.com/short-video/vid1',
      title: 'First clip',
      uploader: 'Some Creator',
      duration: 31.5,
      timestamp: 1_700_000_000,
    }),
    '', // blank lines are skipped
    JSON.stringify({
      id: 'vid2',
      url: 'https://kuaishou.com/short-video/vid2',
      title: 'Second clip',
      upload_date: '20250314',
    }),
    'not json at all', // unparseable lines are skipped, not fatal
    JSON.stringify({ title: 'no id and no url' }), // no identity -> dropped
  ].join('\n');

  it('parses NDJSON into VideoRefs', async () => {
    const { runner, calls } = mockRunner({ result: { stdout: ndjson } });
    const refs = await new YtDlp('yt-dlp', runner).listEntries('https://kuaishou.com/profile/abc', 5);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      sourcePlatformId: 'vid1',
      sourceUrl: 'https://kuaishou.com/short-video/vid1',
      uploaderName: 'Some Creator',
      title: 'First clip',
      durationSec: 31.5,
      publishedAt: new Date(1_700_000_000 * 1000),
    });

    const listCall = calls.find((c) => c.args.includes('--dump-json'));
    expect(listCall?.args).toEqual(
      expect.arrayContaining(['--flat-playlist', '--playlist-end', '5', 'https://kuaishou.com/profile/abc']),
    );
  });

  it('converts upload_date (YYYYMMDD) to a UTC Date when timestamp is absent', async () => {
    const { runner } = mockRunner({ result: { stdout: ndjson } });
    const refs = await new YtDlp('yt-dlp', runner).listEntries('https://kuaishou.com/profile/abc');
    expect(refs[1]?.publishedAt).toEqual(new Date(Date.UTC(2025, 2, 14)));
    expect(refs[1]?.durationSec).toBeUndefined();
  });

  it('throws YtDlpNotAvailableError when the binary is missing', async () => {
    const { runner } = mockRunner({ available: false });
    await expect(new YtDlp('yt-dlp', runner).listEntries('https://x.test/p')).rejects.toBeInstanceOf(
      YtDlpNotAvailableError,
    );
  });

  it('throws on a non-zero listing exit', async () => {
    const { runner } = mockRunner({ result: { code: 1, stderr: 'ERROR: unsupported URL' } });
    await expect(new YtDlp('yt-dlp', runner).listEntries('https://x.test/p')).rejects.toThrow(
      /unsupported URL/,
    );
  });
});

describe('YtDlp.download', () => {
  it('parses printed duration/width/height and hashes the file from disk', async () => {
    const { runner, calls } = mockRunner({ result: { stdout: '31.5\t1080\t1920\n' } });
    const meta = await new YtDlp('yt-dlp', runner).download('https://x.test/v/1', destPath);

    const expected = await hashFile(destPath);
    expect(meta).toEqual({ md5: expected.md5, bytes: 14, durationSec: 31.5, width: 1080, height: 1920 });

    const dlCall = calls.find((c) => c.args.includes('--no-playlist'));
    expect(dlCall?.args).toEqual(expect.arrayContaining(['-o', destPath, '--merge-output-format', 'mp4']));
  });

  it('omits dimensions yt-dlp reports as NA', async () => {
    const { runner } = mockRunner({ result: { stdout: 'NA\tNA\tNA\n' } });
    const meta = await new YtDlp('yt-dlp', runner).download('https://x.test/v/1', destPath);
    expect(meta.durationSec).toBeUndefined();
    expect(meta.width).toBeUndefined();
    expect(meta.bytes).toBe(14);
  });

  it('throws on a non-zero download exit', async () => {
    const { runner } = mockRunner({ result: { code: 2, stderr: 'ERROR: video unavailable' } });
    await expect(new YtDlp('yt-dlp', runner).download('https://x.test/v/1', destPath)).rejects.toThrow(
      /video unavailable/,
    );
  });
});

describe('KuaishouAdapter', () => {
  it('lists new videos through yt-dlp', async () => {
    const { runner } = mockRunner({
      result: { stdout: JSON.stringify({ id: 'vid1', webpage_url: 'https://k.test/v/1' }) },
    });
    const adapter = new KuaishouAdapter(new YtDlp('yt-dlp', runner));
    const refs = await adapter.listNewVideos(source());
    expect(refs).toEqual([{ sourcePlatformId: 'vid1', sourceUrl: 'https://k.test/v/1' }]);
  });

  it('downloads to destPath and returns a DownloadResult', async () => {
    const { runner } = mockRunner({ result: { stdout: '10\t720\t1280\n' } });
    const adapter = new KuaishouAdapter(new YtDlp('yt-dlp', runner));
    const res = await adapter.download(
      { sourcePlatformId: 'vid1', sourceUrl: 'https://k.test/v/1' },
      destPath,
    );
    expect(res.localPath).toBe(destPath);
    expect(res.bytes).toBe(14);
    expect(res.durationSec).toBe(10);
  });

  it('surfaces YtDlpNotAvailableError rather than crashing opaquely', async () => {
    const { runner } = mockRunner({ available: false });
    const adapter = new KuaishouAdapter(new YtDlp('yt-dlp', runner));
    await expect(adapter.listNewVideos(source())).rejects.toBeInstanceOf(YtDlpNotAvailableError);
  });
});

describe('GenericUrlAdapter', () => {
  it('treats the source URL itself as the single video ref (no yt-dlp call)', async () => {
    const { runner, calls } = mockRunner();
    const adapter = new GenericUrlAdapter(new YtDlp('yt-dlp', runner));
    const refs = await adapter.listNewVideos(source({ type: 'GENERIC_URL', url: 'https://x.test/v/9' }));
    expect(refs).toEqual([{ sourcePlatformId: 'https://x.test/v/9', sourceUrl: 'https://x.test/v/9' }]);
    expect(calls).toHaveLength(0);
  });

  it('downloads via yt-dlp', async () => {
    const { runner } = mockRunner({ result: { stdout: '5\t1080\t1920\n' } });
    const adapter = new GenericUrlAdapter(new YtDlp('yt-dlp', runner));
    const res = await adapter.download(
      { sourcePlatformId: 'https://x.test/v/9', sourceUrl: 'https://x.test/v/9' },
      destPath,
    );
    expect(res).toEqual({
      localPath: destPath,
      md5: (await hashFile(destPath)).md5,
      bytes: 14,
      durationSec: 5,
      width: 1080,
      height: 1920,
    });
  });
});
