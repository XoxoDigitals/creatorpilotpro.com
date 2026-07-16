import { spawn } from 'node:child_process';

/**
 * ffmpeg wrapper (docs/04 §2 media pipeline). Kept framework-free and shells out
 * to the `ffmpeg` binary, which is an operational dependency like yt-dlp. When it
 * is absent, `available()` returns false and the MEDIA processor turns that into a
 * clear incident rather than crashing.
 *
 * The command runner is injectable so the trim/normalize/frame-extract logic is
 * unit-testable without the real binary installed.
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

export class FfmpegNotAvailableError extends Error {
  constructor(binary: string) {
    super(
      `ffmpeg binary "${binary}" is not available. Install ffmpeg on the worker host, or set FFMPEG_PATH.`,
    );
    this.name = 'FfmpegNotAvailableError';
  }
}

export interface TrimNormalizeOptions {
  /** Milliseconds to drop from the head of the clip (docs/04 §2 — default 500). */
  trimStartMs?: number;
}

/** dHash works on a (width+1) x height grayscale frame; this is the default 9x8. */
export const DHASH_FRAME_WIDTH = 9;
export const DHASH_FRAME_HEIGHT = 8;

export class Ffmpeg {
  constructor(
    private readonly binary: string = process.env.FFMPEG_PATH ?? 'ffmpeg',
    private readonly run: CommandRunner = spawnRunner,
  ) {}

  /** True if the ffmpeg binary responds to -version. */
  async available(): Promise<boolean> {
    try {
      const res = await this.run(this.binary, ['-version']);
      return res.code === 0;
    } catch {
      return false;
    }
  }

  private async ensureAvailable(): Promise<void> {
    if (!(await this.available())) throw new FfmpegNotAvailableError(this.binary);
  }

  /**
   * Trim the first `trimStartMs` and re-encode to a normalized H.264/AAC mp4 at
   * `destPath` (faststart for progressive playback). `-ss` before `-i` is a fast
   * seek — good enough for dropping a short lead-in.
   */
  async trimNormalize(srcPath: string, destPath: string, opts: TrimNormalizeOptions = {}): Promise<void> {
    await this.ensureAvailable();
    const trimSec = Math.max(0, opts.trimStartMs ?? 500) / 1000;
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      ...(trimSec > 0 ? ['-ss', String(trimSec)] : []),
      '-i',
      srcPath,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      '-y',
      destPath,
    ];
    const res = await this.run(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        `ffmpeg trim/normalize failed (${res.code}) for ${srcPath}: ${res.stderr.slice(0, 300)}`,
      );
    }
  }

  /**
   * Extract a single grayscale frame to a raw pixel file (`destRawPath`), scaled
   * to `width x height`. The output is exactly width*height bytes (one gray byte
   * per pixel) — fed straight into `dHash`.
   */
  async extractGrayFrame(
    srcPath: string,
    destRawPath: string,
    width = DHASH_FRAME_WIDTH,
    height = DHASH_FRAME_HEIGHT,
  ): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:${height},format=gray`,
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      '-y',
      destRawPath,
    ];
    const res = await this.run(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        `ffmpeg frame extract failed (${res.code}) for ${srcPath}: ${res.stderr.slice(0, 300)}`,
      );
    }
  }
}
