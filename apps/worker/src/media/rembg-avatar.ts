/**
 * Reaction-avatar background removal.
 *
 * Prefer `rembg` CLI when available (ML cutout).
 * Fallback / alternative: ffmpeg `colorkey` chromakey (best with a green/magenta screen).
 *
 * Images → PNG with alpha (`*.nobg.png` / `*.nobg-ck.png`).
 * Videos → WebM VP9+alpha (`*.nobg.webm` / `*.nobg-ck.webm`).
 *
 * If both rembg and chromakey are unavailable/disabled, returns the original path.
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

/** Default chroma green (OBS / fabric screens). */
export const DEFAULT_CHROMAKEY_COLOR = '#00B140';

export type ReactionRemoveBgMode = 'auto' | 'rembg' | 'chromakey' | 'off';

export type ReactionRemoveBgOptions = {
  mode?: ReactionRemoveBgMode;
  /** Hex `#RRGGBB` key color for chromakey. */
  chromakeyColor?: string;
  chromakeySimilarity?: number;
  chromakeyBlend?: number;
  /** Cap video processing length (defaults to REACTION_AVATAR_REMBG_MAX_SEC). */
  maxSec?: number;
  ffmpeg?: Ffmpeg;
  runner?: CommandRunner;
  workDir?: string;
};

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

/** Normalize `#RRGGBB` → `0xRRGGBB` for ffmpeg colorkey. */
export function ffmpegKeyColor(hex: string | null | undefined): string {
  const raw = (hex ?? DEFAULT_CHROMAKEY_COLOR).trim();
  const m = raw.match(/^#?([0-9A-Fa-f]{6})$/);
  const rgb = (m?.[1] ?? '00B140').toUpperCase();
  return `0x${rgb}`;
}

/** Cache path beside the upload (mtime-checked). Optional maxSec tags shorter trims. */
export function reactionAvatarNobgCachePath(
  srcPath: string,
  method: 'rembg' | 'chromakey' = 'rembg',
  maxSec?: number,
): string {
  const tag = method === 'chromakey' ? 'nobg-ck' : 'nobg';
  const secTag =
    maxSec != null &&
    Number.isFinite(maxSec) &&
    maxSec > 0 &&
    maxSec < REACTION_AVATAR_REMBG_MAX_SEC - 0.05
      ? `-t${Math.ceil(maxSec)}`
      : '';
  return isVideoPath(srcPath)
    ? srcPath.replace(/\.[^.]+$/i, `.${tag}${secTag}.webm`)
    : srcPath.replace(/\.[^.]+$/i, `.${tag}.png`);
}

function resolveReactionMaxSec(maxSec?: number): number {
  if (maxSec != null && Number.isFinite(maxSec) && maxSec > 0) {
    return Math.min(REACTION_AVATAR_REMBG_MAX_SEC, Math.max(0.1, maxSec));
  }
  return REACTION_AVATAR_REMBG_MAX_SEC;
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

function colorkeyVf(color: string, similarity: number, blend: number): string {
  const sim = Math.max(0.01, Math.min(1, similarity));
  const bl = Math.max(0, Math.min(1, blend));
  return `colorkey=${color}:${sim}:${bl},format=rgba`;
}

async function runChromakeyImage(
  ffmpeg: Ffmpeg,
  inputPath: string,
  outputPath: string,
  color: string,
  similarity: number,
  blend: number,
): Promise<void> {
  await unlink(outputPath).catch(() => {});
  await ffmpeg.exec([
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vf',
    colorkeyVf(color, similarity, blend),
    '-y',
    outputPath,
  ]);
}

async function runChromakeyVideo(
  ffmpeg: Ffmpeg,
  inputPath: string,
  outputPath: string,
  color: string,
  similarity: number,
  blend: number,
  maxSec: number = REACTION_AVATAR_REMBG_MAX_SEC,
): Promise<void> {
  await unlink(outputPath).catch(() => {});
  await ffmpeg.exec([
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-t',
    String(Number(Math.max(0.1, maxSec).toFixed(3))),
    '-vf',
    `${colorkeyVf(color, similarity, blend)},format=yuva420p`,
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    '-an',
    '-y',
    outputPath,
  ]);
}

async function prepareViaRembg(
  srcPath: string,
  opts: {
    ffmpeg: Ffmpeg;
    runner: CommandRunner;
    workDir?: string;
    maxSec?: number;
  },
): Promise<{ path: string; removedBg: boolean; reason?: string; method: 'rembg' }> {
  const maxSec = resolveReactionMaxSec(opts.maxSec);
  const cachePath = reactionAvatarNobgCachePath(srcPath, 'rembg', maxSec);
  if (await cacheIsFresh(srcPath, cachePath)) {
    return { path: cachePath, removedBg: true, method: 'rembg' };
  }

  if (!(await rembgAvailable(opts.runner))) {
    return { path: srcPath, removedBg: false, reason: 'rembg-unavailable', method: 'rembg' };
  }

  try {
    if (isImagePath(srcPath)) {
      await unlink(cachePath).catch(() => {});
      await runRembgImage(srcPath, cachePath, opts.runner);
      return { path: cachePath, removedBg: true, method: 'rembg' };
    }

    const fps = REACTION_AVATAR_REMBG_FPS;
    const maxSide = REACTION_AVATAR_REMBG_MAX_SIDE;
    const workRoot =
      opts.workDir ?? join(dirname(srcPath), `.rembg-${basename(srcPath).replace(/\W+/g, '_')}`);
    const framesIn = join(workRoot, 'in');
    const framesOut = join(workRoot, 'out');
    const seqDir = join(workRoot, 'seq');
    await rm(workRoot, { recursive: true, force: true }).catch(() => {});
    await mkdir(framesIn, { recursive: true });

    await opts.ffmpeg.exec([
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-t',
      String(Number(maxSec.toFixed(3))),
      '-vf',
      `fps=${fps},scale=${maxSide}:${maxSide}:force_original_aspect_ratio=decrease`,
      '-y',
      join(framesIn, 'frame_%04d.png'),
    ]);

    const inFrames = (await readdir(framesIn)).filter((n) => /\.png$/i.test(n));
    if (inFrames.length === 0) {
      throw new Error('No frames extracted for rembg');
    }

    await runRembgFolder(framesIn, framesOut, opts.runner);
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
    await opts.ffmpeg.exec([
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

    return { path: cachePath, removedBg: true, method: 'rembg' };
  } catch (err) {
    return {
      path: srcPath,
      removedBg: false,
      reason: err instanceof Error ? err.message : String(err),
      method: 'rembg',
    };
  }
}

async function prepareViaChromakey(
  srcPath: string,
  opts: {
    ffmpeg: Ffmpeg;
    color: string;
    similarity: number;
    blend: number;
    maxSec?: number;
  },
): Promise<{ path: string; removedBg: boolean; reason?: string; method: 'chromakey' }> {
  const maxSec = resolveReactionMaxSec(opts.maxSec);
  const cachePath = reactionAvatarNobgCachePath(srcPath, 'chromakey', maxSec);
  if (await cacheIsFresh(srcPath, cachePath)) {
    return { path: cachePath, removedBg: true, method: 'chromakey' };
  }

  try {
    if (isImagePath(srcPath)) {
      await runChromakeyImage(
        opts.ffmpeg,
        srcPath,
        cachePath,
        opts.color,
        opts.similarity,
        opts.blend,
      );
    } else {
      await runChromakeyVideo(
        opts.ffmpeg,
        srcPath,
        cachePath,
        opts.color,
        opts.similarity,
        opts.blend,
        maxSec,
      );
    }
    await writeFile(
      `${cachePath}.meta.txt`,
      `chromakey color=${opts.color} similarity=${opts.similarity} blend=${opts.blend} maxSec=${maxSec}\n`,
      'utf8',
    ).catch(() => {});
    return { path: cachePath, removedBg: true, method: 'chromakey' };
  } catch (err) {
    return {
      path: srcPath,
      removedBg: false,
      reason: err instanceof Error ? err.message : String(err),
      method: 'chromakey',
    };
  }
}

/**
 * Ensure a background-removed asset exists for PiP overlay.
 * Returns path to use (nobg cache or original).
 */
export async function prepareReactionAvatarNobg(
  srcPath: string,
  opts?: ReactionRemoveBgOptions,
): Promise<{ path: string; removedBg: boolean; reason?: string; method?: string }> {
  const runner = opts?.runner ?? spawnRunner;
  const ffmpeg = opts?.ffmpeg ?? new Ffmpeg(resolveFfmpegBinaryPath(), runner);
  const mode: ReactionRemoveBgMode = opts?.mode ?? 'auto';
  const color = ffmpegKeyColor(opts?.chromakeyColor);
  const similarity = opts?.chromakeySimilarity ?? 0.3;
  const blend = opts?.chromakeyBlend ?? 0.1;
  const maxSec = opts?.maxSec;

  if (!isVideoPath(srcPath) && !isImagePath(srcPath)) {
    return { path: srcPath, removedBg: false, reason: 'unsupported-ext' };
  }

  if (mode === 'off') {
    return { path: srcPath, removedBg: false, reason: 'remove-bg-off' };
  }

  if (mode === 'chromakey') {
    return prepareViaChromakey(srcPath, { ffmpeg, color, similarity, blend, maxSec });
  }

  if (mode === 'rembg') {
    return prepareViaRembg(srcPath, { ffmpeg, runner, workDir: opts?.workDir, maxSec });
  }

  // auto: rembg first, then chromakey
  const rembg = await prepareViaRembg(srcPath, {
    ffmpeg,
    runner,
    workDir: opts?.workDir,
    maxSec,
  });
  if (rembg.removedBg) return rembg;

  const ck = await prepareViaChromakey(srcPath, { ffmpeg, color, similarity, blend, maxSec });
  if (ck.removedBg) {
    return {
      ...ck,
      reason: rembg.reason ? `rembg→chromakey (${rembg.reason})` : 'rembg→chromakey',
    };
  }

  return {
    path: srcPath,
    removedBg: false,
    reason: [rembg.reason, ck.reason].filter(Boolean).join('; ') || 'remove-bg-failed',
  };
}
