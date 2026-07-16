import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { VideoRef } from './types.js';

/**
 * yt-dlp wrapper (docs/04 §1). Kept framework-free and dependency-light: it
 * shells out to the `yt-dlp` binary. The binary is an operational dependency
 * (like ffmpeg) — when it is absent, `available()` returns false and the worker
 * turns that into a source ERROR + incident rather than crashing.
 *
 * The command runner is injectable so the parsing logic is unit-testable
 * without the real binary installed.
 */

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CommandRunner = (cmd: string, args: string[]) => Promise<RunResult>;

/** Default runner: spawn the process and buffer stdio. Rejects on ENOENT. */
export const spawnRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject); // ENOENT when the binary is missing
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });

export class YtDlpNotAvailableError extends Error {
  constructor(binary: string) {
    super(
      `yt-dlp binary "${binary}" is not available. Install yt-dlp (and ffmpeg) on the worker host, or set YT_DLP_PATH.`,
    );
    this.name = 'YtDlpNotAvailableError';
  }
}

export interface DownloadMeta {
  bytes: number;
  md5: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

/** Stream an md5 + byte count over a file (no full-file buffering). */
export async function hashFile(path: string): Promise<{ md5: string; bytes: number }> {
  const hash = createHash('md5');
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const rs = createReadStream(path);
    rs.on('data', (c: string | Buffer) => {
      const buf = typeof c === 'string' ? Buffer.from(c) : c;
      bytes += buf.length;
      hash.update(buf);
    });
    rs.on('error', reject);
    rs.on('end', resolve);
  });
  return { md5: hash.digest('hex'), bytes };
}

interface YtDlpEntry {
  id?: string;
  url?: string;
  webpage_url?: string;
  title?: string;
  uploader?: string;
  duration?: number;
  timestamp?: number;
  upload_date?: string; // YYYYMMDD
}

function parseUploadDate(entry: YtDlpEntry): Date | undefined {
  if (typeof entry.timestamp === 'number') return new Date(entry.timestamp * 1000);
  if (entry.upload_date && /^\d{8}$/.test(entry.upload_date)) {
    const y = Number(entry.upload_date.slice(0, 4));
    const m = Number(entry.upload_date.slice(4, 6));
    const d = Number(entry.upload_date.slice(6, 8));
    return new Date(Date.UTC(y, m - 1, d));
  }
  return undefined;
}

export class YtDlp {
  constructor(
    private readonly binary: string = process.env.YT_DLP_PATH ?? 'yt-dlp',
    private readonly run: CommandRunner = spawnRunner,
  ) {}

  /** True if the yt-dlp binary responds to --version. */
  async available(): Promise<boolean> {
    try {
      const res = await this.run(this.binary, ['--version']);
      return res.code === 0;
    } catch {
      return false;
    }
  }

  private async ensureAvailable(): Promise<void> {
    if (!(await this.available())) throw new YtDlpNotAvailableError(this.binary);
  }

  /**
   * List a profile/playlist's latest entries (flat, no per-video network calls).
   * Newest first, capped at `max`.
   */
  async listEntries(url: string, max = 20): Promise<VideoRef[]> {
    await this.ensureAvailable();
    const res = await this.run(this.binary, [
      '--dump-json',
      '--flat-playlist',
      '--playlist-end',
      String(max),
      url,
    ]);
    if (res.code !== 0) {
      throw new Error(`yt-dlp listing failed (${res.code}) for ${url}: ${res.stderr.slice(0, 300)}`);
    }
    const refs: VideoRef[] = [];
    for (const line of res.stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let entry: YtDlpEntry;
      try {
        entry = JSON.parse(trimmed) as YtDlpEntry;
      } catch {
        continue;
      }
      const sourceUrl = entry.webpage_url ?? entry.url ?? '';
      const sourcePlatformId = entry.id ?? sourceUrl;
      if (!sourcePlatformId) continue;
      refs.push({
        sourcePlatformId,
        sourceUrl: sourceUrl || url,
        ...(entry.uploader ? { uploaderName: entry.uploader } : {}),
        ...(entry.title ? { title: entry.title } : {}),
        ...(typeof entry.duration === 'number' ? { durationSec: entry.duration } : {}),
        ...(parseUploadDate(entry) ? { publishedAt: parseUploadDate(entry) } : {}),
      });
    }
    return refs;
  }

  /**
   * Download a single video to exactly `destPath` (a .mp4 path). Returns md5 +
   * bytes (hashed from disk) and best-effort duration/dimensions from yt-dlp.
   */
  async download(url: string, destPath: string): Promise<DownloadMeta> {
    await this.ensureAvailable();
    const res = await this.run(this.binary, [
      '--no-playlist',
      '-f',
      'bv*[ext=mp4]+ba/b[ext=mp4]/b',
      '--merge-output-format',
      'mp4',
      '-o',
      destPath,
      '--print',
      'after_move:%(duration)s\t%(width)s\t%(height)s',
      url,
    ]);
    if (res.code !== 0) {
      throw new Error(`yt-dlp download failed (${res.code}) for ${url}: ${res.stderr.slice(0, 300)}`);
    }

    const { md5, bytes } = await hashFile(destPath).catch(async () => {
      // Fall back to stat-only if hashing races the merge (shouldn't normally).
      const s = await stat(destPath);
      return { md5: '', bytes: s.size };
    });

    const meta: DownloadMeta = { md5, bytes };
    const printed = res.stdout.trim().split('\n').pop() ?? '';
    const [d, w, h] = printed.split('\t');
    if (d && d !== 'NA' && !Number.isNaN(Number(d))) meta.durationSec = Number(d);
    if (w && w !== 'NA' && !Number.isNaN(Number(w))) meta.width = Number(w);
    if (h && h !== 'NA' && !Number.isNaN(Number(h))) meta.height = Number(h);
    return meta;
  }
}
