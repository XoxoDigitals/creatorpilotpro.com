/**
 * Reaction-avatar background removal via the `rembg` CLI (optional host dep).
 *
 * Images → PNG with alpha (`*.nobg.png`).
 * Videos → short PNG sequence → rembg folder → WebM VP9+alpha (`*.nobg.webm`).
 *
 * Limits (MVP): videos capped at REACTION_AVATAR_REMBG_MAX_SEC @ FPS.
 * If rembg is missing or fails, returns the original path unchanged.
 */
import { copyFile, mkdir, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { resolveRembgBinary } from '@scp/shared/bin';
import { Ffmpeg, resolveFfmpegBinaryPath, spawnRunner, type CommandRunner } from './ffmpeg.js';

/** Max reaction-clip seconds processed for rembg (longer clips are truncated). */
export const REACTION_AVATAR_REMBG_MAX_SEC = 8;
/** Frame rate for video rembg (lower = faster, choppier). */
export const REACTION_AVATAR_REMBG_FPS = 12;
/** Downscale long edge before rembg to speed CPU inference. */
export const REACTION_AVATAR_REMBG_MAX_SIDE = 512;

function rembgBin(): string {
  return resolveRembgBinary();
}

export async function rembgAvailable(runner: CommandRunner = spawnRunner): Promise<boolean> {
  try {
    const res = await runner(rembgBin(), ['--help']);
    return res.code === 0 || /usage|rembg/i.test(`${res.stdout}\n${res.stderr}`);
  } catch {
    return false;
  }
}

function isVideoPath(p: string): boolean {
  return /\.(mp4|webm|mov|m4v)$/i.test(p);
}

function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(p);
}

/** Cache path beside the upload (mtime-checked). */
export function reactionAvatarNobgCachePath(srcPath: string): string {
  return isVideoPath(srcPath)
    ? srcPath.replace(/\.[^.]+$/i, '.nobg.webm')
    : srcPath.replace(/\.[^.]+$/i, '.nobg.png');
}

async function cacheIsFresh(srcPath: string, cachePath: string): Promise<boolean> {
  try {
    const [srcStat, cacheStat] = await Promise.all([stat(srcPath), stat(cachePath)]);
    return cacheStat.mtimeMs >= srcStat.mtimeMs && cacheStat.size > 0;
  } catch {
    return false;
  }
}

async function runRembgImage(
  inputPath: string,
  outputPath: string,
  runner: CommandRunner,
): Promise<void> {
  const res = await runner(rembgBin(), ['i', inputPath, outputPath]);
  if (res.code !== 0) {
    throw new Error(
      `rembg failed for ${basename(inputPath)} (${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`,
    );
  }
}

async function runRembgFolder(
  inputDir: string,
  outputDir: string,
  runner: CommandRunner,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const res = await runner(rembgBin(), ['p', inputDir, outputDir]);
  if (res.code !== 0) {
    throw new Error(
      `rembg folder failed (${res.code}): ${(res.stderr || res.stdout).slice(0, 300)}`,
    );
  }
}

async function listPngsRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listPngsRecursive(abs)));
    } else if (/\.png$/i.test(ent.name)) {
      out.push(abs);
    }
  }
  return out.sort();
}

/**
 * Ensure a background-removed asset exists for PiP overlay.
 * Returns path to use (nobg cache or original if rembg unavailable / failed).
 */
export async function prepareReactionAvatarNobg(
  srcPath: string,
  opts?: {
    ffmpeg?: Ffmpeg;
    runner?: CommandRunner;
    workDir?: string;
  },
): Promise<{ path: string; removedBg: boolean; reason?: string }> {
  const runner = opts?.runner ?? spawnRunner;
  const ffmpeg = opts?.ffmpeg ?? new Ffmpeg(resolveFfmpegBinaryPath(), runner);

  if (!isVideoPath(srcPath) && !isImagePath(srcPath)) {
    return { path: srcPath, removedBg: false, reason: 'unsupported-ext' };
  }

  const cachePath = reactionAvatarNobgCachePath(srcPath);
  if (await cacheIsFresh(srcPath, cachePath)) {
    return { path: cachePath, removedBg: true };
  }

  if (!(await rembgAvailable(runner))) {
    return { path: srcPath, removedBg: false, reason: 'rembg-unavailable' };
  }

  try {
    if (isImagePath(srcPath)) {
      await unlink(cachePath).catch(() => {});
      await runRembgImage(srcPath, cachePath, runner);
      return { path: cachePath, removedBg: true };
    }

    const maxSec = REACTION_AVATAR_REMBG_MAX_SEC;
    const fps = REACTION_AVATAR_REMBG_FPS;
    const maxSide = REACTION_AVATAR_REMBG_MAX_SIDE;
    const workRoot =
      opts?.workDir ?? join(dirname(srcPath), `.rembg-${basename(srcPath).replace(/\W+/g, '_')}`);
    const framesIn = join(workRoot, 'in');
    const framesOut = join(workRoot, 'out');
    const seqDir = join(workRoot, 'seq');
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
    await mkdir(framesIn, { recursive: true });

    await ffmpeg.exec([
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-t',
      String(maxSec),
      '-vf',
      `fps=${fps},scale=${maxSide}:${maxSide}:force_original_aspect_ratio=decrease`,
      '-y',
      join(framesIn, 'frame_%04d.png'),
    ]);

    const inFrames = (await readdir(framesIn)).filter((n) => /\.png$/i.test(n));
    if (inFrames.length === 0) {
      throw new Error('No frames extracted for rembg');
    }

    await runRembgFolder(framesIn, framesOut, runner);
    const outFiles = await listPngsRecursive(framesOut);
    if (outFiles.length === 0) {
      throw new Error('rembg produced no output frames');
    }

    await mkdir(seqDir, { recursive: true });
    let i = 1;
    for (const src of outFiles) {
      await copyFile(src, join(seqDir, `frame_${String(i).padStart(4, '0')}.png`));
      i += 1;
    }

    await unlink(cachePath).catch(() => {});
    await ffmpeg.exec([
      '-loglevel',
      'error',
      '-framerate',
      String(fps),
      '-i',
      join(seqDir, 'frame_%04d.png'),
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-an',
      '-y',
      cachePath,
    ]);

    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
    await writeFile(
      `${cachePath}.meta.txt`,
      `rembg video maxSec=${maxSec} fps=${fps} maxSide=${maxSide} frames=${outFiles.length}\n`,
      'utf8',
    ).catch(() => {});

    return { path: cachePath, removedBg: true };
  } catch (err) {
    return {
      path: srcPath,
      removedBg: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
