import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { delimiter } from 'node:path';
import { isResolvedBinaryPath, resolveFfmpegBinary } from '@scp/shared/bin';

/**
 * ffmpeg wrapper (docs/04 §2 media pipeline). Kept framework-free and shells out
 * to the `ffmpeg` binary, which is an operational dependency like yt-dlp. When it
 * is absent, `available()` returns false and the MEDIA processor turns that into a
 * clear incident rather than crashing. Binary path: FFMPEG_PATH if the file exists,
 * else PATH / `/usr/bin` / `~/.local/bin` (see `@scp/shared/bin`).
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

/** Windows often reports negative ffmpeg codes as unsigned (e.g. -34 → 4294967262). */
export function signedExitCode(code: number): number {
  return code | 0;
}

/**
 * Prefer ffmpeg `Error` / filter-parse lines over the version banner that
 * otherwise fills the first 300 chars of stderr.
 */
export function summarizeFfmpegStderr(stderr: string, maxLen = 400): string {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const banner = /^(ffmpeg version|built with |configuration:|lib[a-z]+\s+\d)/i;
  const interesting = lines.filter(
    (l) => !banner.test(l) && /error|invalid|failed|no such|out of range|cannot|not found|unknown filter/i.test(l),
  );
  const fallback = lines.filter((l) => !banner.test(l)).slice(-6);
  const picked = (interesting.length > 0 ? interesting : fallback).join(' | ');
  const text = picked || stderr.trim();
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}…`;
}

function ffmpegFailureMessage(prefix: string, code: number, stderr: string): string {
  return `${prefix} (${signedExitCode(code)}): ${summarizeFfmpegStderr(stderr)}`;
}

/** PM2 often has a thin PATH; keep standard Unix dirs so bare `ffmpeg` still resolves. */
function spawnEnv(): NodeJS.ProcessEnv {
  const extra =
    process.platform === 'win32'
      ? ''
      : ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter);
  const current = process.env.PATH ?? process.env.Path ?? '';
  const PATH = extra ? (current ? `${extra}${delimiter}${current}` : extra) : current;
  return { ...process.env, PATH };
}

/**
 * Prefer an absolute ffmpeg path. Bare `ffmpeg` fails under PM2 when PATH is empty
 * even if `/usr/bin/ffmpeg` exists on disk.
 */
export function resolveFfmpegBinaryPath(): string {
  const resolved = resolveFfmpegBinary();
  if (isResolvedBinaryPath(resolved)) return resolved;
  for (const candidate of ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    if (existsSync(candidate)) return candidate;
  }
  return resolved;
}

/** Default runner: spawn the process and buffer stdio. Rejects on ENOENT. */
export const spawnRunner: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, env: spawnEnv() });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject); // ENOENT when the binary is missing
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
  });

export class FfmpegNotAvailableError extends Error {
  constructor(binary: string, cause?: unknown) {
    const detail =
      cause instanceof Error && cause.message
        ? ` (${cause.message})`
        : '';
    super(
      `ffmpeg binary "${binary}" is not available${detail}. Install ffmpeg on the worker host, or set FFMPEG_PATH.`,
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

/**
 * Broadcast-style VO polish (high-pass rumble, mild presence EQ, light
 * compression). Applied after Edge TTS and again at the render mix so a
 * raw VO asset never hits the bed unprocessed. Mix loudnorm runs after.
 */
export const VOICEOVER_MIX_ENHANCE_AF =
  'highpass=f=70,equalizer=f=250:t=q:w=1:g=-1.5,equalizer=f=3200:t=q:w=1:g=1.5,acompressor=threshold=-18dB:ratio=2.5:attack=15:release=100';

/** Full TTS/render enhance chain: mix polish + EBU-ish loudnorm. */
export const VOICEOVER_ENHANCE_AF = `${VOICEOVER_MIX_ENHANCE_AF},loudnorm=I=-16:TP=-1:LRA=7`;

/** VO reference level (post-enhance). Bed at 100% matches this. */
export const VO_MIX_VOICE_GAIN = 0.85;
/**
 * Background bed at 100% setting — same gain as voiceover so the slider is the
 * only control for how loud music/ambience is relative to VO.
 */
export const VO_MIX_BED_GAIN = VO_MIX_VOICE_GAIN;
/**
 * Dialogue / stripped bed at 100% — same as natural bed; speech is already
 * stripped/muted. Percent setting scales both the same way.
 */
export const VO_MIX_DIALOGUE_BED_GAIN = VO_MIX_VOICE_GAIN;
/** @deprecated Prefer VO_MIX_DIALOGUE_BED_GAIN — kept as alias for older call sites. */
export const VO_MIX_DEMUCS_BED_GAIN = VO_MIX_DIALOGUE_BED_GAIN;

/** Scale a 100%-reference bed gain by channel/video `backgroundBedPercent` (1–100). */
export function bedGainForPercent(baseAt100: number, percent: number): number {
  const p = Math.max(1, Math.min(100, Math.round(percent)));
  return baseAt100 * (p / 100);
}
/**
 * Normalize bed to the same loudness target as VO enhance (−16 LUFS), then light
 * limiting — do not crush the bed; the percent slider owns level.
 */
export const VO_MIX_BED_LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11';
export const VO_MIX_BED_CONTROL =
  `${VO_MIX_BED_LOUDNORM},acompressor=threshold=-18dB:ratio=2:attack=10:release=120:makeup=1,alimiter=limit=0.95:attack=5:release=50`;
/**
 * Light sidechain duck under speech so VO stays clear without muting the bed
 * the user set with the percent control.
 */
export const VO_MIX_SIDECHAIN =
  'sidechaincompress=threshold=0.08:ratio=2.5:attack=15:release=220:makeup=1:knee=4';
/**
 * Slightly stronger duck on stripped dialogue beds (residual speech), still
 * leaving room for the percent slider to be audible.
 */
export const VO_MIX_DIALOGUE_SIDECHAIN =
  'sidechaincompress=threshold=0.06:ratio=4:attack=10:release=180:makeup=1:knee=5';

/**
 * Hard-mute bed after the voiceover ends so a short VO on a long video does
 * not leave original ambience playing alone for the remaining minutes.
 */
export function muteAfterVoAf(voEndSec: number | null | undefined): string | null {
  if (voEndSec == null || !Number.isFinite(voEndSec) || voEndSec < 0.2) return null;
  const t = Number(voEndSec.toFixed(3));
  return `volume=0:enable='gte(t\\,${t})'`;
}

/**
 * Aggressive vocal / dialogue strip (ffmpeg fallback when Demucs is absent):
 * strong mid kill + speech-band cuts + high-ratio gate. Stereo karaoke alone
 * is too weak for dialogue that is not perfectly center-panned.
 */
export const VOCAL_STRIP_AF = [
  'aformat=channel_layouts=stereo',
  'stereotools=mlev=0.02',
  'equalizer=f=800:t=q:w=1.2:g=-20',
  'equalizer=f=1800:t=q:w=1.4:g=-22',
  'equalizer=f=3000:t=q:w=1.2:g=-18',
  'agate=threshold=0.015:ratio=12:attack=5:release=90:makeup=1',
  'highpass=f=40',
].join(',');

/**
 * Residual speech killer applied to Demucs `no_vocals` (and karaoke beds).
 * Demucs often leaves intelligible dialogue in the instrumental stem.
 */
export const DIALOGUE_BED_CLEANUP_AF = [
  'aformat=channel_layouts=stereo',
  'equalizer=f=700:t=q:w=1.1:g=-14',
  'equalizer=f=1600:t=q:w=1.3:g=-18',
  'equalizer=f=2800:t=q:w=1.2:g=-14',
  'agate=threshold=0.012:ratio=10:attack=5:release=100:makeup=1',
  'highpass=f=50',
  'volume=0.7',
].join(',');

function bedPrepChain(
  bedInput: '0:a' | '2:a',
  bedGain: number,
  extras: string[],
): string {
  const parts = [...extras, VO_MIX_BED_CONTROL, `volume=${bedGain}`].filter(Boolean);
  return `[${bedInput}]${parts.join(',')}[bg]`;
}

/**
 * Filter graph after `enhanceVoiceover`: split VO for sidechain, cap+duck bed
 * under speech, amix without ffmpeg's default 1/n attenuation (`normalize=0`).
 * `bedInput` is `0:a` (original video) or `2:a` (Demucs / karaoke no-vocals).
 * When `voEndSec` is set, the bed is hard-muted after the VO ends.
 */
export function voiceoverBedMixFilter(
  bedInput: '0:a' | '2:a',
  bedGain: number,
  sidechain: string = VO_MIX_SIDECHAIN,
  voEndSec?: number | null,
): string {
  const afterVo = muteAfterVoAf(voEndSec);
  return [
    `[1:a]volume=${VO_MIX_VOICE_GAIN},asplit=2[vo][vo_sc]`,
    bedPrepChain(bedInput, bedGain, afterVo ? [afterVo] : []),
    `[bg][vo_sc]${sidechain}[ducked]`,
    `[ducked][vo]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mixed]`,
  ].join(';');
}

/** Mix VO over a dialogue-stripped bed (very quiet + hard duck). */
export function voiceoverDialogueBedMixFilter(
  bedInput: '2:a' = '2:a',
  voEndSec?: number | null,
  bedGain: number = VO_MIX_DIALOGUE_BED_GAIN,
): string {
  return voiceoverBedMixFilter(
    bedInput,
    bedGain,
    VO_MIX_DIALOGUE_SIDECHAIN,
    voEndSec,
  );
}

/**
 * ffmpeg volume enable expression that hard-mutes during dialogue windows.
 * Returns null when ranges is empty (caller keeps full-bed aggressive path).
 */
export function muteDialogueRangesAf(
  ranges: { startSec: number; endSec: number }[],
): string | null {
  const parts: string[] = [];
  for (const r of ranges) {
    if (!(Number.isFinite(r.startSec) && Number.isFinite(r.endSec))) continue;
    if (!(r.endSec > r.startSec + 0.05)) continue;
    const s = Number(Math.max(0, r.startSec).toFixed(3));
    const e = Number(r.endSec.toFixed(3));
    parts.push(`between(t\\,${s}\\,${e})`);
  }
  if (parts.length === 0) return null;
  // `+` is OR in ffmpeg enable expressions.
  return `volume=0:enable='${parts.join('+')}'`;
}

/**
 * Mix filter that also hard-mutes the bed during AI dialogue ranges, then
 * applies the usual quiet dialogue bed + hard duck.
 */
export function voiceoverDialogueBedMixFilterWithRanges(
  ranges: { startSec: number; endSec: number }[],
  bedInput: '2:a' = '2:a',
  voEndSec?: number | null,
  bedGain: number = VO_MIX_DIALOGUE_BED_GAIN,
): string {
  const mute = muteDialogueRangesAf(ranges);
  if (!mute) return voiceoverDialogueBedMixFilter(bedInput, voEndSec, bedGain);
  const afterVo = muteAfterVoAf(voEndSec);
  const extras = [mute, ...(afterVo ? [afterVo] : [])];
  return [
    `[1:a]volume=${VO_MIX_VOICE_GAIN},asplit=2[vo][vo_sc]`,
    bedPrepChain(bedInput, bedGain, extras),
    `[bg][vo_sc]${VO_MIX_DIALOGUE_SIDECHAIN}[ducked]`,
    `[ducked][vo]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[mixed]`,
  ].join(';');
}

/**
 * Pad a mix graph (output label `[mixed]`) so mapped audio never ends before
 * picture. Pair with `muxStopAtPictureArgs`: encoding stops at the video
 * stream instead of truncating video to the (language-dependent) voiceover.
 */
export function padMixToVideoDuration(mixFilter: string): string {
  return `${mixFilter};[mixed]apad[aud]`;
}

/** VO-only overlay: pad input 1 so mux duration is limited by video, not VO. */
export const VO_ONLY_PAD_TO_VIDEO_FILTER = '[1:a]apad[aud]';

export const PADDED_MIX_AUDIO_MAP = '[aud]';

/**
 * Stop mux at picture length. Audio must be `apad`ed first: bare `-shortest`
 * cuts the video down to the voiceover. When `pictureSec` is known, also pass
 * `-t` so stream-copy cannot overrun if VO is still longer than the video.
 */
export function muxStopAtPictureArgs(pictureSec?: number | null): string[] {
  const args = ['-shortest'];
  if (pictureSec != null && Number.isFinite(pictureSec) && pictureSec > 0.2) {
    args.push('-t', pictureSec.toFixed(3));
  }
  return args;
}

export class Ffmpeg {
  constructor(
    private readonly binary: string = resolveFfmpegBinaryPath(),
    private readonly runner: CommandRunner = spawnRunner,
  ) {}

  /** Resolved binary path (absolute when found). */
  get path(): string {
    return this.binary;
  }

  /** Run an arbitrary ffmpeg command with the configured binary. */
  async exec(args: string[]): Promise<RunResult> {
    await this.ensureAvailable();
    const argv = args[0] === '-hide_banner' ? args : ['-hide_banner', ...args];
    const res = await this.runner(this.binary, argv);
    if (res.code !== 0) {
      throw new Error(ffmpegFailureMessage('ffmpeg failed', res.code, res.stderr));
    }
    return res;
  }

  /** True if the ffmpeg binary responds to -version. */
  async available(): Promise<boolean> {
    try {
      const res = await this.runner(this.binary, ['-version']);
      return res.code === 0;
    } catch {
      return false;
    }
  }

  private async ensureAvailable(): Promise<void> {
    try {
      const res = await this.runner(this.binary, ['-version']);
      if (res.code === 0) return;
      throw new FfmpegNotAvailableError(this.binary, new Error(`exit ${res.code}`));
    } catch (err) {
      if (err instanceof FfmpegNotAvailableError) throw err;
      throw new FfmpegNotAvailableError(this.binary, err);
    }
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
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(ffmpegFailureMessage(`ffmpeg trim/normalize failed for ${srcPath}`, res.code, res.stderr));
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
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(ffmpegFailureMessage(`ffmpeg frame extract failed for ${srcPath}`, res.code, res.stderr));
    }
  }

  /**
   * Extract one JPEG still at `atSec` (fast seek). Used when full-video inline /
   * Files API upload is unavailable so VIDEO_ANALYSIS still gets timeline samples.
   */
  async extractJpegAt(srcPath: string, destJpegPath: string, atSec: number): Promise<void> {
    await this.ensureAvailable();
    const t = Math.max(0, atSec);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      t.toFixed(3),
      '-i',
      srcPath,
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-y',
      destJpegPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg jpeg extract failed at ${t}s for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /**
   * Enhance a raw TTS file (mp3/wav) into a 44.1 kHz mono WAV using
   * `VOICEOVER_ENHANCE_AF`. Throws `FfmpegNotAvailableError` when ffmpeg is
   * missing — callers should not silently skip this step.
   */
  async enhanceVoiceover(srcPath: string, destPath: string): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-af',
      VOICEOVER_ENHANCE_AF,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg voiceover enhance failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /**
   * True when the file has an audio stream whose mean volume is above silence
   * (used to keep original ambience under a voiceover).
   */
  async probeHasAudibleAudio(srcPath: string, silenceMeanDb = -50): Promise<boolean> {
    try {
      const res = await this.runner(this.binary, [
        '-hide_banner',
        '-i',
        srcPath,
        '-af',
        'volumedetect',
        '-f',
        'null',
        '-',
      ]);
      const blob = `${res.stderr}\n${res.stdout}`;
      if (!/Audio:\s/i.test(blob) && !/Stream #.+: Audio/i.test(blob)) return false;
      const mean = /mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i.exec(blob);
      if (!mean) {
        // An audio stream exists but volumedetect didn't print — treat as audible.
        return /Stream #.+: Audio/i.test(blob) || /Audio:\s/i.test(blob);
      }
      const db = Number(mean[1]);
      return Number.isFinite(db) && db > silenceMeanDb;
    } catch {
      return false;
    }
  }

  /** Best-effort duration in seconds from `ffmpeg -i` stderr Duration= line. */
  async probeDurationSec(srcPath: string): Promise<number | null> {
    try {
      const res = await this.runner(this.binary, ['-hide_banner', '-i', srcPath, '-f', 'null', '-']);
      const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(res.stderr);
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      const sec = Number(m[3]);
      if (![h, min, sec].every(Number.isFinite)) return null;
      return h * 3600 + min * 60 + sec;
    } catch {
      return null;
    }
  }

  /**
   * Extract stereo PCM for Demucs (video containers often fail as Demucs input).
   */
  async extractAudioWav(srcPath: string, destPath: string): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '44100',
      '-ac',
      '2',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg audio extract failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /**
   * Aggressive vocal / dialogue strip to a WAV bed (ambience + music).
   * Used when Demucs is not installed. Stronger than plain karaoke mid-cut.
   */
  async stripVocalsToWav(srcPath: string, destPath: string): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-vn',
      '-af',
      VOCAL_STRIP_AF,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg vocal strip failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /**
   * Attenuate residual speech left in a Demucs/karaoke no-vocals bed.
   * Prefer silence/ambience over letting original dialogue through.
   */
  async cleanupDialogueBed(srcPath: string, destPath: string): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-vn',
      '-af',
      DIALOGUE_BED_CLEANUP_AF,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg dialogue bed cleanup failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /**
   * Hard-mute audio during AI dialogue time windows (volume=0 enable expr).
   * Used after Demucs/strip so leftover speech in those intervals is killed.
   */
  async muteDialogueRanges(
    srcPath: string,
    destPath: string,
    ranges: { startSec: number; endSec: number }[],
  ): Promise<void> {
    const muteAf = muteDialogueRangesAf(ranges);
    if (!muteAf) {
      if (srcPath !== destPath) {
        await copyFile(srcPath, destPath);
      }
      return;
    }
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-af',
      muteAf,
      '-ar',
      '44100',
      '-ac',
      '2',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg dialogue range mute failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /** Mono silence WAV at 44.1 kHz (timeline padding for scene-aligned TTS). */
  async generateSilenceWav(destPath: string, durationSec: number): Promise<void> {
    await this.ensureAvailable();
    const t = Math.max(0.04, durationSec);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=channel_layout=mono:sample_rate=44100',
      '-t',
      t.toFixed(3),
      '-ar',
      '44100',
      '-ac',
      '1',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(ffmpegFailureMessage('ffmpeg silence generate failed', res.code, res.stderr));
    }
  }

  /** Speed a WAV with atempo (chain already validated). No-op if filter is empty. */
  async atempoWav(srcPath: string, destPath: string, filter: string): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-af',
      filter,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg atempo failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /** Hard-trim audio to `durationSec` (last-resort cap when VO still overruns). */
  async trimAudioTo(srcPath: string, destPath: string, durationSec: number): Promise<void> {
    await this.ensureAvailable();
    const t = Math.max(0.2, durationSec);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      srcPath,
      '-t',
      t.toFixed(3),
      '-ar',
      '44100',
      '-ac',
      '1',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(
        ffmpegFailureMessage(`ffmpeg audio trim failed for ${srcPath}`, res.code, res.stderr),
      );
    }
  }

  /** Concat WAV/audio files via concat demuxer (no loudnorm). */
  async concatAudio(listPath: string, destPath: string): Promise<void> {
    await this.ensureAvailable();
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-y',
      destPath,
    ];
    const res = await this.runner(this.binary, args);
    if (res.code !== 0) {
      throw new Error(ffmpegFailureMessage('ffmpeg audio concat failed', res.code, res.stderr));
    }
  }
}
