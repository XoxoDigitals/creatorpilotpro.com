import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { isResolvedBinaryPath, resolveFfmpegBinary, resolveYtDlpBinary } from '@scp/shared/bin';
import type { VideoRef } from './types.js';

/**
 * yt-dlp wrapper (docs/04 §1). Framework-free, shells out to the `yt-dlp` binary.
 * The binary is an operational dependency (like ffmpeg) — when it is absent,
 * `available()` returns false and the worker turns that into a source ERROR +
 * incident rather than crashing. Resolved via YT_DLP_PATH / PATH / common dirs
 * (`@scp/shared/bin`); youtube-dl is a last-resort name on PATH.
 *
 * Perf: `available()` is cached per-binary at module scope so `listEntries` /
 * `download` don't re-spawn `yt-dlp --version` on every call.
 */

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOptions {
  /** Kill the child after this many ms (kills yt-dlp when a URL hangs). */
  timeoutMs?: number;
  /** Called with each stdout chunk as it streams (for live progress parsing). */
  onStdout?: (chunk: string) => void;
}

export type CommandRunner = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

/**
 * Default runner: spawn the process and buffer stdio. Rejects on ENOENT.
 * When `timeoutMs` is set, kills the child (SIGKILL after grace) if it exceeds
 * the deadline and rejects with a clear message — otherwise a hung yt-dlp call
 * would block a DOWNLOAD worker slot forever.
 */
export const spawnRunner: CommandRunner = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;
    let timer: NodeJS.Timeout | undefined;

    if (opts?.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        killedByTimeout = true;
        // Ask nicely first; escalate to SIGKILL after 5s grace.
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      }, opts.timeoutMs);
      timer.unref();
    }

    child.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stdout += chunk;
      opts?.onStdout?.(chunk);
    });
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (killedByTimeout) {
        reject(new Error(`yt-dlp exceeded ${opts?.timeoutMs}ms timeout and was killed`));
        return;
      }
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });

export class YtDlpNotAvailableError extends Error {
  constructor(binary: string) {
    super(
      `yt-dlp binary "${binary}" is not available. Install yt-dlp (and ffmpeg) on the worker host, or set YT_DLP_PATH.

  Windows:  winget install yt-dlp.yt-dlp   (or:  pip install -U yt-dlp)
  macOS:    brew install yt-dlp ffmpeg
  Linux:    pipx install yt-dlp   (or:  sudo apt install yt-dlp ffmpeg)

Then restart the worker (pnpm dev, or pm2 restart worker).`,
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

/** A live progress tick parsed from yt-dlp's progress stream. */
export interface DownloadProgress {
  /** 0..100, best-effort (uses total_bytes or its estimate). */
  percent: number;
  /** Seconds remaining, when yt-dlp knows it. */
  etaSec?: number;
  /** Download speed in bytes/sec, when known. */
  speedBps?: number;
}

export type ProgressCallback = (p: DownloadProgress) => void;

/**
 * Sentinel prefix on our `--progress-template` lines so they're trivially
 * distinguishable from yt-dlp's other stdout (e.g. the `--print after_move`
 * metadata line). Fields are tab-separated: percentStr, eta, speed.
 */
const PROGRESS_SENTINEL = '__SCPDL__';

function parseProgressLine(line: string): DownloadProgress | null {
  const idx = line.indexOf(PROGRESS_SENTINEL);
  if (idx === -1) return null;
  const payload = line.slice(idx + PROGRESS_SENTINEL.length).trim();
  const [percentStr, etaStr, speedStr] = payload.split('\t');
  // percentStr looks like " 45.2%" — strip everything but the number.
  const pct = Number((percentStr ?? '').replace(/[^\d.]/g, ''));
  const eta = Number(etaStr);
  const speed = Number(speedStr);
  return {
    percent: Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0,
    ...(Number.isFinite(eta) && etaStr !== 'NA' ? { etaSec: Math.round(eta) } : {}),
    ...(Number.isFinite(speed) && speedStr !== 'NA' ? { speedBps: Math.round(speed) } : {}),
  };
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

/**
 * Module-level cache of `yt-dlp --version` results, keyed by binary path.
 * Once we've confirmed availability we don't re-spawn `--version` before every
 * listing / download — that was doubling every job's cost on Windows.
 */
const availabilityCache = new Map<string, boolean>();

/** Test-only: clear the availability cache between tests. */
export function _clearAvailabilityCacheForTests(): void {
  availabilityCache.clear();
}

/** Timeouts — listing is cheap, downloading may take a while. */
const LIST_TIMEOUT_MS = 60_000;         // 1 min for a --dump-json listing
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000; // 15 min per video; longer than any reasonable clip

function defaultFfmpegLocation(): string | undefined {
  const ffmpeg = resolveFfmpegBinary();
  return isResolvedBinaryPath(ffmpeg) ? ffmpeg : undefined;
}

export class YtDlp {
  constructor(
    private readonly binary: string = resolveYtDlpBinary(),
    private readonly run: CommandRunner = spawnRunner,
    /**
     * ffmpeg location for yt-dlp's merge step (video+audio → single mp4).
     * yt-dlp finds ffmpeg on PATH by default, but on hosts where ffmpeg was
     * just installed (PATH not reloaded, or PM2 has a thin PATH) the merge
     * would fail. We pass --ffmpeg-location when ffmpeg was resolved to a
     * real file (env override, PATH, or /usr/bin).
     */
    private readonly ffmpegLocation: string | undefined = defaultFfmpegLocation(),
  ) {}

  /** `--ffmpeg-location <path>` args, or [] when unset. */
  private ffmpegArgs(): string[] {
    return this.ffmpegLocation ? ['--ffmpeg-location', this.ffmpegLocation] : [];
  }

  /** True if the yt-dlp binary responds to --version. Result is cached. */
  async available(): Promise<boolean> {
    const cached = availabilityCache.get(this.binary);
    if (cached !== undefined) return cached;
    try {
      const res = await this.run(this.binary, ['--version'], { timeoutMs: 5_000 });
      const ok = res.code === 0;
      availabilityCache.set(this.binary, ok);
      return ok;
    } catch {
      availabilityCache.set(this.binary, false);
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
    const res = await this.run(
      this.binary,
      [
        '--dump-json',
        '--flat-playlist',
        '--playlist-end', String(max),
        '--socket-timeout', '30',
        '--retries', '2',
        url,
      ],
      { timeoutMs: LIST_TIMEOUT_MS },
    );
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
  async download(url: string, destPath: string, onProgress?: ProgressCallback): Promise<DownloadMeta> {
    await this.ensureAvailable();

    // Buffer partial stdout chunks and emit progress per complete line.
    let lineBuf = '';
    const onStdout = onProgress
      ? (chunk: string) => {
          lineBuf += chunk;
          let nl: number;
          while ((nl = lineBuf.indexOf('\n')) !== -1) {
            const line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);
            const p = parseProgressLine(line);
            if (p) onProgress(p);
          }
        }
      : undefined;

    const res = await this.run(
      this.binary,
      [
        '--no-playlist',
        '-f', 'bv*[ext=mp4]+ba/b[ext=mp4]/b',
        '--merge-output-format', 'mp4',
        ...this.ffmpegArgs(),
        // Machine-readable progress on its own lines (so parsing is trivial).
        '--newline',
        '--progress-template',
        `download:${PROGRESS_SENTINEL}%(progress._percent_str)s\t%(progress.eta)s\t%(progress.speed)s`,
        // Fail-fast on hung sockets; cap retries so bad URLs surface in minutes,
        // not hours (yt-dlp's default retries are aggressive for scrapers).
        '--socket-timeout', '30',
        '--retries', '3',
        '--fragment-retries', '3',
        '-o', destPath,
        '--print',
        'after_move:%(duration)s\t%(width)s\t%(height)s',
        url,
      ],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, ...(onStdout ? { onStdout } : {}) },
    );
    if (res.code !== 0) {
      throw new Error(`yt-dlp download failed (${res.code}) for ${url}: ${res.stderr.slice(0, 300)}`);
    }

    const { md5, bytes } = await hashFile(destPath).catch(async () => {
      // Fall back to stat-only if hashing races the merge (shouldn't normally).
      const s = await stat(destPath);
      return { md5: '', bytes: s.size };
    });

    const meta: DownloadMeta = { md5, bytes };
    // The metadata is the last non-empty stdout line that ISN'T a progress line.
    const printed =
      res.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.includes(PROGRESS_SENTINEL))
        .pop() ?? '';
    const [d, w, h] = printed.split('\t');
    if (d && d !== 'NA' && !Number.isNaN(Number(d))) meta.durationSec = Number(d);
    if (w && w !== 'NA' && !Number.isNaN(Number(w))) meta.width = Number(w);
    if (h && h !== 'NA' && !Number.isNaN(Number(h))) meta.height = Number(h);
    return meta;
  }
}
