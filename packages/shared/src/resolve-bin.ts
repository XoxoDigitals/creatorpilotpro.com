/**
 * Resolve CLI tools (ffmpeg, yt-dlp, edge-tts, whisper, demucs, …) without
 * hardcoded Windows paths in `.env`.
 *
 * Order:
 *   1. Env var, if set and the file exists (local Windows override).
 *   2. PATH walk (`which` / `where` equivalent — works when PM2 PATH is thin).
 *   3. Common Linux dirs (`/usr/bin`, `/usr/local/bin`, `~/.local/bin`) and
 *      Windows fallbacks (Python Scripts, chocolatey, ffmpeg install dirs).
 *   4. Bare command name so spawn still tries PATH.
 *
 * Import from `@scp/shared/bin` (server-only; not the browser bundle).
 */
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

export interface ResolveCliBinaryOptions {
  /** Command names to try, in order (e.g. `['yt-dlp', 'youtube-dl']`). */
  names: string[];
  /** Optional env override (e.g. `FFMPEG_PATH`, `EDGE_TTS_BIN`). */
  envVar?: string;
  /** Extra directories searched after PATH, before built-in common dirs. */
  extraDirs?: string[];
}

function isExistingFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function withWinExt(name: string): string[] {
  if (process.platform !== 'win32') return [name];
  if (/\.exe$/i.test(name)) return [name];
  return [`${name}.exe`, name];
}

function pathDirs(): string[] {
  const raw = process.env.PATH ?? process.env.Path ?? '';
  return raw.split(delimiter).filter(Boolean);
}

export function commonBinaryDirs(): string[] {
  const home = homedir();
  if (process.platform === 'win32') {
    const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    const pyVersions = ['Python313', 'Python312', 'Python311', 'Python310'];
    const dirs: string[] = [];
    for (const v of pyVersions) {
      dirs.push(join(roaming, 'Python', v, 'Scripts'));
      dirs.push(join(local, 'Programs', 'Python', v, 'Scripts'));
    }
    dirs.push(
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      'C:\\ProgramData\\chocolatey\\bin',
    );
    return dirs;
  }
  return ['/usr/bin', '/usr/local/bin', join(home, '.local', 'bin'), '/opt/homebrew/bin'];
}

function searchDirs(names: string[], dirs: string[]): string | undefined {
  for (const dir of dirs) {
    for (const name of names) {
      for (const candidate of withWinExt(name)) {
        const p = join(dir, candidate);
        if (isExistingFile(p)) return p;
      }
    }
  }
  return undefined;
}

function looksLikePath(value: string): boolean {
  return isAbsolute(value) || value.includes('/') || value.includes('\\');
}

/**
 * Resolve a CLI binary. Always returns a string: an existing path when found,
 * otherwise the first `names` entry (spawn-on-PATH fallback).
 *
 * A missing env path (typical: Windows `.env` copied to Ubuntu) is ignored
 * and lookup continues — it does not fail closed.
 */
export function resolveCliBinary(opts: ResolveCliBinaryOptions): string {
  const names = opts.names.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) {
    throw new Error('resolveCliBinary: names must be non-empty');
  }

  const fromEnv = opts.envVar ? process.env[opts.envVar]?.trim() : undefined;
  if (fromEnv) {
    if (isExistingFile(fromEnv)) return fromEnv;
    if (!looksLikePath(fromEnv)) {
      const hit = searchDirs([fromEnv], [...pathDirs(), ...(opts.extraDirs ?? []), ...commonBinaryDirs()]);
      if (hit) return hit;
    }
    // Missing absolute path → fall through (server auto-detect).
  }

  const hit = searchDirs(names, [...pathDirs(), ...(opts.extraDirs ?? []), ...commonBinaryDirs()]);
  if (hit) return hit;

  return names[0]!;
}

export function resolveFfmpegBinary(): string {
  return resolveCliBinary({ envVar: 'FFMPEG_PATH', names: ['ffmpeg'] });
}

export function resolveFfprobeBinary(): string {
  return resolveCliBinary({ envVar: 'FFPROBE_PATH', names: ['ffprobe'] });
}

export function resolveYtDlpBinary(): string {
  return resolveCliBinary({ envVar: 'YT_DLP_PATH', names: ['yt-dlp', 'youtube-dl'] });
}

export function resolveWhisperBinary(): string {
  return resolveCliBinary({
    envVar: 'WHISPER_BIN',
    names: ['whisper', 'faster-whisper', 'whisper-ctranslate2', 'whisper-cli'],
  });
}

export function resolveDemucsBinary(): string {
  return resolveCliBinary({ envVar: 'DEMUCS_PATH', names: ['demucs'] });
}

/** Background removal CLI (`pip install rembg[cli]` → `rembg`). */
export function resolveRembgBinary(): string {
  return resolveCliBinary({ envVar: 'REMBG_PATH', names: ['rembg'] });
}

export function resolveEdgeTtsCliPath(): string {
  return resolveCliBinary({ envVar: 'EDGE_TTS_BIN', names: ['edge-tts'] });
}

/** True when resolution found a real file (not just a bare command name). */
export function isResolvedBinaryPath(p: string): boolean {
  return looksLikePath(p) && isExistingFile(p);
}
