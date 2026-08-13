/**
 * Microsoft Edge Neural TTS via the official `edge-tts` Python CLI
 * (the engine behind ZexTTS). Never automates the ZexTTS GUI.
 *
 * Binary resolution order:
 *   1. EDGE_TTS_BIN if set and the file exists (exe or python with the module)
 *   2. `edge-tts` on PATH, then common dirs (`/usr/bin`, `~/.local/bin`, …)
 *   3. `python -m edge_tts` / `py -3 -m edge_tts` when the module is importable
 * A missing EDGE_TTS_BIN path (e.g. Windows `.env` on Ubuntu) is ignored.
 *
 * Text is written to a temp UTF-8 file and passed with `--file` so untrusted
 * narration never hits the shell as interpolated arguments.
 */
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { TaskType } from '@scp/shared';
import { isResolvedBinaryPath, resolveCliBinary } from '@scp/shared/bin';
import type { AIProvider, AIRequest, AIResult, AIErrorClass, PooledKey } from './types.js';

export interface EdgeVoiceInfo {
  name: string;
  shortName: string;
  gender: string;
  locale: string;
  /** Friendly display label e.g. "Aria (en-US, Female)". */
  label: string;
}

export interface TimedSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface EdgeSynthOptions {
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  /** When set, also write VTT/SRT beside the media and return parsed timings. */
  writeSubtitles?: boolean;
  /** Output directory; defaults to a temp dir cleaned by the caller. */
  outDir?: string;
  /** Preferred media basename without extension. */
  basename?: string;
}

export interface EdgeSynthResult {
  mediaPath: string;
  subtitlePath?: string;
  timings: TimedSegment[];
  format: 'mp3' | 'wav' | 'webm' | 'unknown';
}

export interface EdgeBinaryResolution {
  /** Args[0] for spawn — either the exe or python interpreter. */
  command: string;
  /** Prefix args before edge-tts flags (e.g. `['-m','edge_tts']`). */
  prefixArgs: string[];
  source: 'EDGE_TTS_BIN' | 'PATH' | 'python -m' | 'missing';
  detail: string;
}

const DEFAULT_VOICE = 'en-US-AriaNeural';
const LIST_VOICES_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cachedVoices: { at: number; voices: EdgeVoiceInfo[] } | null = null;
let cachedBinary: EdgeBinaryResolution | null = null;

function isWindows(): boolean {
  return process.platform === 'win32';
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function runCapture(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer =
      opts?.timeoutMs != null
        ? setTimeout(() => {
            child.kill();
            reject(new Error(`Timed out after ${opts.timeoutMs}ms: ${command}`));
          }, opts.timeoutMs)
        : null;
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function tryPythonModule(
  pythonCmd: string,
  pythonArgs: string[] = [],
): Promise<EdgeBinaryResolution | null> {
  try {
    const probe = await runCapture(pythonCmd, [...pythonArgs, '-c', 'import edge_tts; print("ok")'], {
      timeoutMs: 15_000,
    });
    if (probe.code === 0 && /ok/.test(probe.stdout)) {
      return {
        command: pythonCmd,
        prefixArgs: [...pythonArgs, '-m', 'edge_tts'],
        source: 'python -m',
        detail: `${pythonCmd} ${[...pythonArgs, '-m', 'edge_tts'].join(' ')}`,
      };
    }
  } catch {
    /* continue */
  }
  return null;
}

/**
 * Resolve how to invoke edge-tts. Result is cached process-wide; call
 * `invalidateEdgeTtsBinaryCache()` after installing the package.
 */
export async function resolveEdgeTtsBinary(
  forceRefresh = false,
): Promise<EdgeBinaryResolution> {
  if (cachedBinary && !forceRefresh) return cachedBinary;

  const fromEnv = process.env.EDGE_TTS_BIN?.trim();
  if (fromEnv && (await pathExists(fromEnv))) {
    // Allow pointing at either the edge-tts.exe OR a python.exe that has the module.
    const base = basename(fromEnv).toLowerCase();
    if (base.startsWith('python') || base === 'py.exe' || base === 'py') {
      const viaPy = await tryPythonModule(fromEnv);
      if (viaPy) {
        cachedBinary = { ...viaPy, source: 'EDGE_TTS_BIN', detail: `EDGE_TTS_BIN=${fromEnv}` };
        return cachedBinary;
      }
    }
    cachedBinary = {
      command: fromEnv,
      prefixArgs: [],
      source: 'EDGE_TTS_BIN',
      detail: `EDGE_TTS_BIN=${fromEnv}`,
    };
    return cachedBinary;
  }

  // PATH + common Linux/Windows install locations. Missing EDGE_TTS_BIN (e.g.
  // a Windows path on the Ubuntu VPS) is ignored so auto-detect still runs.
  const detected = resolveCliBinary({ names: ['edge-tts'] });
  if (isResolvedBinaryPath(detected) || (isAbsolute(detected) && (await pathExists(detected)))) {
    cachedBinary = {
      command: detected,
      prefixArgs: [],
      source: 'PATH',
      detail: detected,
    };
    return cachedBinary;
  }

  // python -m edge_tts when the CLI wrapper is not on PATH
  if (isWindows()) {
    const localAppData = process.env.LOCALAPPDATA ?? '';
    const pythonCandidates = [
      join(localAppData, 'Programs', 'Python', 'Python312', 'python.exe'),
      join(localAppData, 'Programs', 'Python', 'Python313', 'python.exe'),
      join(localAppData, 'Programs', 'Python', 'Python311', 'python.exe'),
      'python.exe',
      'python',
      'py',
    ];
    for (const py of pythonCandidates) {
      if (py.includes('\\') || py.includes('/')) {
        if (!(await pathExists(py))) continue;
        const via = await tryPythonModule(py);
        if (via) {
          cachedBinary = via;
          return cachedBinary;
        }
      } else if (py === 'py') {
        const via = await tryPythonModule('py', ['-3']);
        if (via) {
          cachedBinary = via;
          return cachedBinary;
        }
      } else {
        const via = await tryPythonModule(py);
        if (via) {
          cachedBinary = via;
          return cachedBinary;
        }
      }
    }
  } else {
    for (const py of ['python3', 'python']) {
      const via = await tryPythonModule(py);
      if (via) {
        cachedBinary = via;
        return cachedBinary;
      }
    }
  }

  cachedBinary = {
    command: '',
    prefixArgs: [],
    source: 'missing',
    detail:
      'edge-tts not found. Install with `pip install edge-tts` (or `python -m pip install --user edge-tts`) and ensure Scripts is on PATH, or set EDGE_TTS_BIN to the edge-tts.exe / python.exe path.',
  };
  return cachedBinary;
}

export function invalidateEdgeTtsBinaryCache(): void {
  cachedBinary = null;
  cachedVoices = null;
}

export async function diagnoseEdgeTts(): Promise<{
  ok: boolean;
  binary: EdgeBinaryResolution;
  versionHint: string;
}> {
  const binary = await resolveEdgeTtsBinary(true);
  if (binary.source === 'missing' || !binary.command) {
    return { ok: false, binary, versionHint: '' };
  }
  try {
    const result = await runCapture(binary.command, [...binary.prefixArgs, '--version'], {
      timeoutMs: 15_000,
    });
    const hint = (result.stdout || result.stderr).trim().slice(0, 200);
    return { ok: result.code === 0 || hint.length > 0, binary, versionHint: hint || 'edge-tts available' };
  } catch (err) {
    return {
      ok: false,
      binary: {
        ...binary,
        source: 'missing',
        detail: err instanceof Error ? err.message : String(err),
      },
      versionHint: '',
    };
  }
}

function parseListVoicesTable(stdout: string): EdgeVoiceInfo[] {
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
  const voices: EdgeVoiceInfo[] = [];
  for (const line of lines) {
    // Header / separator rows from tabulate
    if (/^Name\s+Gender/i.test(line) || /^-+/.test(line.trim()) || /^-{3,}/.test(line)) {
      continue;
    }
    // Columns are space-padded; shortName is first token like en-US-AriaNeural
    const match = line.match(/^(\S+)\s+(Female|Male|Unknown)\s+/i);
    if (!match) continue;
    const shortName = match[1]!;
    const gender = match[2]!;
    const localeParts = shortName.split('-');
    const locale =
      localeParts.length >= 2 ? `${localeParts[0]}-${localeParts[1]}` : shortName;
    const friendly = localeParts.slice(2).join('-').replace(/Neural$/i, '') || shortName;
    voices.push({
      name: shortName,
      shortName,
      gender,
      locale,
      label: `${friendly} (${locale}, ${gender})`,
    });
  }
  return voices;
}

/** Parse JSON list-voices if a future edge-tts adds it; currently unused. */
function parseListVoicesJson(stdout: string): EdgeVoiceInfo[] | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((row) => {
        const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
        const shortName = String(r.ShortName ?? r.shortName ?? r.Name ?? r.name ?? '').trim();
        if (!shortName) return null;
        const gender = String(r.Gender ?? r.gender ?? 'Unknown');
        const locale = String(r.Locale ?? r.locale ?? shortName.split('-').slice(0, 2).join('-'));
        const friendly = shortName.split('-').slice(2).join('-').replace(/Neural$/i, '') || shortName;
        return {
          name: shortName,
          shortName,
          gender,
          locale,
          label: `${friendly} (${locale}, ${gender})`,
        } satisfies EdgeVoiceInfo;
      })
      .filter((v): v is EdgeVoiceInfo => v != null);
  } catch {
    return null;
  }
}

export async function listEdgeVoices(opts?: {
  locale?: string;
  forceRefresh?: boolean;
}): Promise<EdgeVoiceInfo[]> {
  if (
    cachedVoices &&
    !opts?.forceRefresh &&
    Date.now() - cachedVoices.at < LIST_VOICES_CACHE_TTL_MS
  ) {
    return filterVoices(cachedVoices.voices, opts?.locale);
  }

  const binary = await resolveEdgeTtsBinary();
  if (binary.source === 'missing' || !binary.command) {
    throw Object.assign(new Error(binary.detail), { code: 'EDGE_TTS_NOT_CONFIGURED' });
  }

  const result = await runCapture(binary.command, [...binary.prefixArgs, '--list-voices'], {
    timeoutMs: 60_000,
  });
  if (result.code !== 0) {
    throw Object.assign(
      new Error(`edge-tts --list-voices failed: ${(result.stderr || result.stdout).slice(0, 300)}`),
      { code: 'EDGE_TTS_LIST_FAILED', status: 500 },
    );
  }

  const fromJson = parseListVoicesJson(result.stdout.trim());
  const voices = fromJson && fromJson.length > 0 ? fromJson : parseListVoicesTable(result.stdout);
  cachedVoices = { at: Date.now(), voices };
  return filterVoices(voices, opts?.locale);
}

function filterVoices(voices: EdgeVoiceInfo[], locale?: string): EdgeVoiceInfo[] {
  if (!locale) return voices;
  const needle = locale.trim().toLowerCase();
  if (!needle) return voices;
  return voices.filter(
    (v) =>
      v.locale.toLowerCase() === needle ||
      v.locale.toLowerCase().startsWith(needle) ||
      v.shortName.toLowerCase().startsWith(needle),
  );
}

/** Parse WebVTT or SRT cue timings into ms segments. */
export function parseSubtitleTimings(content: string): TimedSegment[] {
  const normalized = content.replace(/^\uFEFF/, '').trim();
  if (!normalized) return [];

  // WebVTT
  if (/WEBVTT/i.test(normalized) || /\d{2}:\d{2}:\d{2}\.\d{3}\s+-->/.test(normalized)) {
    const cues = normalized.split(/\r?\n\r?\n+/);
    const segments: TimedSegment[] = [];
    for (const cue of cues) {
      const lines = cue.split(/\r?\n/).filter((l) => l.trim() && !/^WEBVTT/i.test(l) && !/^NOTE\b/.test(l));
      const timeLine = lines.find((l) => /-->/.test(l));
      if (!timeLine) continue;
      const m = timeLine.match(
        /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/,
      );
      if (!m) continue;
      const text = lines
        .filter((l) => l !== timeLine && !/^\d+$/.test(l.trim()))
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (!text) continue;
      segments.push({
        startMs: parseTimestampToMs(m[1]!),
        endMs: parseTimestampToMs(m[2]!),
        text,
      });
    }
    return segments;
  }

  // SRT
  const blocks = normalized.split(/\r?\n\r?\n+/);
  const segments: TimedSegment[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const m = timeLine.match(
      /(\d{2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{1,3})/,
    );
    if (!m) continue;
    const text = lines
      .filter((l) => l !== timeLine && !/^\d+$/.test(l.trim()))
      .join(' ')
      .trim();
    if (!text) continue;
    segments.push({
      startMs: parseTimestampToMs(m[1]!),
      endMs: parseTimestampToMs(m[2]!),
      text,
    });
  }
  return segments;
}

function parseTimestampToMs(ts: string): number {
  const cleaned = ts.trim().replace(',', '.');
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    return Math.round(((h * 60 + m) * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    return Math.round((m * 60 + s) * 1000);
  }
  return 0;
}

export function segmentsToSrt(segments: TimedSegment[]): string {
  return segments
    .map((seg, i) => {
      const n = i + 1;
      return `${n}\n${formatSrtTime(seg.startMs)} --> ${formatSrtTime(seg.endMs)}\n${seg.text}\n`;
    })
    .join('\n');
}

export function segmentsToVtt(segments: TimedSegment[]): string {
  const body = segments
    .map((seg) => `${formatVttTime(seg.startMs)} --> ${formatVttTime(seg.endMs)}\n${seg.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(frac, 3)}`;
}

function formatVttTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const frac = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(frac, 3)}`;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Synthesize speech with edge-tts. Writes media (+ optional subtitles) using
 * argv arrays only — never shell interpolation of narration text.
 */
export async function synthesizeWithEdgeTts(
  text: string,
  options: EdgeSynthOptions = {},
): Promise<EdgeSynthResult> {
  const binary = await resolveEdgeTtsBinary();
  if (binary.source === 'missing' || !binary.command) {
    throw Object.assign(new Error(binary.detail), { code: 'EDGE_TTS_NOT_CONFIGURED', status: 401 });
  }

  const voice = options.voice?.trim() || DEFAULT_VOICE;
  const ownedTemp = !options.outDir;
  const outDir = options.outDir ?? (await mkdtemp(join(tmpdir(), 'scp-edge-')));
  await mkdir(outDir, { recursive: true });
  const base = options.basename ?? 'speech';
  const mediaPath = join(outDir, `${base}.mp3`);
  const subtitlePath = join(outDir, `${base}.vtt`);
  const textPath = join(outDir, `${base}.txt`);

  await writeFile(textPath, text, 'utf8');

  const args = [
    ...binary.prefixArgs,
    '--voice',
    voice,
    '--file',
    textPath,
    '--write-media',
    mediaPath,
  ];
  if (options.rate) args.push('--rate', options.rate);
  if (options.pitch) args.push('--pitch', options.pitch);
  if (options.volume) args.push('--volume', options.volume);
  if (options.writeSubtitles !== false) {
    args.push('--write-subtitles', subtitlePath);
  }

  try {
    const result = await runCapture(binary.command, args, { timeoutMs: 10 * 60_000 });
    if (result.code !== 0) {
      throw Object.assign(
        new Error(
          `edge-tts failed (exit ${result.code}): ${(result.stderr || result.stdout).slice(0, 400)}`,
        ),
        { code: 'EDGE_TTS_FAILED', status: 500 },
      );
    }
    if (!(await pathExists(mediaPath))) {
      throw Object.assign(new Error('edge-tts produced no media file'), {
        code: 'EDGE_TTS_FAILED',
        status: 500,
      });
    }

    let timings: TimedSegment[] = [];
    let usedSubtitle: string | undefined;
    if (options.writeSubtitles !== false && (await pathExists(subtitlePath))) {
      const raw = await readFile(subtitlePath, 'utf8');
      timings = parseSubtitleTimings(raw);
      usedSubtitle = subtitlePath;
    }

    return {
      mediaPath,
      ...(usedSubtitle ? { subtitlePath: usedSubtitle } : {}),
      timings,
      format: 'mp3',
    };
  } catch (err) {
    if (ownedTemp) {
      await rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  } finally {
    await rm(textPath, { force: true }).catch(() => {});
  }
}

/** Offset every segment by a chunk start time (for multi-chunk concat). */
export function offsetTimings(segments: TimedSegment[], offsetMs: number): TimedSegment[] {
  if (!offsetMs) return segments;
  return segments.map((s) => ({
    ...s,
    startMs: s.startMs + offsetMs,
    endMs: s.endMs + offsetMs,
  }));
}

export class EdgeTtsProvider implements AIProvider {
  readonly id = 'edge';
  readonly supports: TaskType[] = [TaskType.TTS];
  /** Local CLI — no API key vault entry required. */
  readonly requiresKey = false;

  async generate(req: AIRequest, _key: PooledKey): Promise<AIResult> {
    if (req.input.kind !== 'text') {
      throw Object.assign(new Error('EdgeTtsProvider only accepts text input'), { status: 400 });
    }

    let voice = DEFAULT_VOICE;
    let rate: string | undefined;
    let pitch: string | undefined;
    let volume: string | undefined;
    let outDir: string | undefined;
    let basename = 'chunk';
    try {
      const cfg = JSON.parse(req.system) as {
        voiceId?: string;
        rate?: string;
        pitch?: string;
        volume?: string;
        outDir?: string;
        basename?: string;
      };
      if (typeof cfg.voiceId === 'string' && cfg.voiceId && cfg.voiceId !== 'default') {
        voice = cfg.voiceId;
      }
      if (typeof cfg.rate === 'string' && cfg.rate) rate = cfg.rate;
      if (typeof cfg.pitch === 'string' && cfg.pitch) pitch = cfg.pitch;
      if (typeof cfg.volume === 'string' && cfg.volume) volume = cfg.volume;
      if (typeof cfg.outDir === 'string' && cfg.outDir) outDir = cfg.outDir;
      if (typeof cfg.basename === 'string' && cfg.basename) basename = cfg.basename;
    } catch {
      /* non-JSON system → defaults */
    }

    const workDir = outDir ?? (await mkdtemp(join(tmpdir(), 'scp-edge-prov-')));
    const synth = await synthesizeWithEdgeTts(req.input.text, {
      voice,
      rate,
      pitch,
      volume,
      outDir: workDir,
      basename,
      writeSubtitles: true,
    });

    const buf = await readFile(synth.mediaPath);
    const ttsSeconds =
      synth.timings.length > 0
        ? Math.max(...synth.timings.map((t) => t.endMs)) / 1000
        : undefined;

    return {
      output: {
        timings: synth.timings,
        subtitlePath: synth.subtitlePath ?? null,
        mediaPath: synth.mediaPath,
        format: synth.format,
      },
      audioRef: `data:audio/mpeg;base64,${buf.toString('base64')}`,
      model: req.model || 'edge-neural',
      usage: { ...(ttsSeconds != null ? { ttsSeconds } : {}) },
      timings: synth.timings,
    };
  }

  classifyError(e: unknown): AIErrorClass {
    const err = e as { code?: string; status?: number; message?: string };
    if (err.code === 'EDGE_TTS_NOT_CONFIGURED') return 'INVALID_KEY';
    if (err.status === 429) return 'RATE_LIMITED';
    if (err.status !== undefined && err.status >= 500) return 'TRANSIENT';
    if (/network|ETIMEDOUT|ECONNRESET|fetch failed|ECONNREFUSED/i.test(err.message ?? '')) {
      return 'TRANSIENT';
    }
    return 'FATAL';
  }
}

export const EDGE_TTS_DEFAULT_VOICE = DEFAULT_VOICE;
