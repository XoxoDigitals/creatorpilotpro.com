/**
 * TTS processor (docs/05 §6, Phase 3.5). Consumes the TTS queue after a
 * content item's script has been approved (SCRIPT_APPROVED), or for AI-owner
 * package voiceovers (idea_tts). Chain default: Edge Neural → Kokoro → Gemini → OpenAI.
 *
 * Repurposed VO with timed lines[] is laid out on analysis beats: silence gaps
 * between scenes (minimum ~320ms between dialogue lines), natural speaking pace
 * (never speed up a clip to fit a short beat — if VO is longer than the beat,
 * place it as-is and push later lines). Without timed lines, falls back to
 * sentence-chunked continuous synth with the same inter-segment gap.
 * Edge TTS timings (VTT/SRT) are preferred over re-transcription.
 */
import { join, dirname } from 'node:path';
import { writeFile, mkdir, unlink, copyFile, stat } from 'node:fs/promises';
import type PgBoss from 'pg-boss';
import {
  QUEUE,
  DOCUMENTARY_VOICE_EMOTION,
  REPURPOSED_VOICE_EMOTION,
  isDocumentaryIdeaGeneration,
  isDocumentaryVoiceoverPackage,
  parseSpokenNarrationLines,
  parseVoiceSettings,
  splitProductionBriefEditingExtras,
  ttsEmotionFromVoiceSettings,
  resolveSpokenEmotion,
  type TtsEmotion,
  type VoiceSettings,
} from '@scp/shared';
import { decryptSecret, loadMasterKey } from '@scp/shared/crypto';
import {
  AIRouter,
  KeyPool,
  GeminiProvider,
  OpenAIProvider,
  KokoroProvider,
  WhisperProvider,
  EdgeTtsProvider,
  synthesizeWithEdgeTts,
  offsetTimings,
  segmentsToSrt,
  segmentsToVtt,
  AllProvidersExhaustedError,
  resolveEdgeTtsBinary,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type KeyStore,
  type KeyState,
  type TimedSegment,
} from '@scp/ai-providers';
import { Ffmpeg, FfmpegNotAvailableError } from './media/ffmpeg.js';
import { writeTtsAudioRef } from './media/tts-audio-ref.js';
import {
  analysisDurationSec,
  timedLinesFromStep,
  timelinePadPlan,
  clipStartsFromPadPlan,
  splitNarrationSegments,
  spokenLinesFromUnknown,
  INTER_SEGMENT_GAP_SEC,
  MIN_SILENCE_SEC,
  type TimedNarrationLine,
} from './media/vo-timing.js';
import type { RenderJob, IdeaTranscriptJob } from './ai-jobs.js';
import { getPrisma, raiseIncident, type PrismaClient } from './publish-support.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '';

function chunkScript(script: string): string[] {
  const parts = splitNarrationSegments(script);
  return parts.length > 0 ? parts : [script];
}

function buildKeyStore(prisma: PrismaClient, masterKey: Buffer): KeyStore {
  return {
    async listByProvider(providerId: string): Promise<KeyState[]> {
      const rows = await prisma.aiKey.findMany({
        where: { provider: { name: providerId }, status: { not: 'DISABLED' } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        providerId,
        secret: decryptSecret(r.keyEnc, masterKey),
        label: r.label,
        status: r.status as KeyState['status'],
        cooldownUntil: r.cooldownUntil,
        limits: (r.limits ?? {}) as KeyState['limits'],
        minuteWindowStartAt: r.minuteWindowStartAt,
        requestsInMinute: r.requestsInMinute,
        tokensInMinute: r.tokensInMinute,
        dayWindowStartAt: r.dayWindowStartAt,
        requestsInDay: r.requestsInDay,
        lastUsedAt: r.lastUsedAt,
      }));
    },
    async recordSuccess(keyId, patch) {
      await prisma.aiKey.update({
        where: { id: keyId },
        data: {
          minuteWindowStartAt: patch.minuteWindowStartAt,
          dayWindowStartAt: patch.dayWindowStartAt,
          requestsInMinute: patch.requestsInMinute,
          tokensInMinute: patch.tokensInMinute,
          requestsInDay: patch.requestsInDay,
          lastUsedAt: patch.lastUsedAt,
        },
      });
    },
    async recordStatus(keyId, patch) {
      await prisma.aiKey.update({
        where: { id: keyId },
        data: {
          status: patch.status,
          ...(patch.cooldownUntil !== undefined ? { cooldownUntil: patch.cooldownUntil } : {}),
        },
      });
    },
  };
}

function buildCacheStore(prisma: PrismaClient): CacheStore {
  return {
    async lookup(cacheKey) {
      const row = await prisma.aiOutput.findUnique({ where: { cacheKey } });
      if (!row) return null;
      return {
        output: row.output,
        audioRef: row.audioRef ?? undefined,
        usage: {
          tokensIn: row.tokensIn ?? undefined,
          tokensOut: row.tokensOut ?? undefined,
          ttsSeconds: row.ttsSeconds ?? undefined,
        },
        model: row.model,
      };
    },
    async save(cacheKey, entry) {
      await prisma.aiOutput.upsert({
        where: { cacheKey },
        create: {
          cacheKey,
          task: entry.task,
          providerId: entry.providerId,
          model: entry.model,
          output: entry.output as any,
          audioRef: entry.audioRef,
          tokensIn: entry.tokensIn,
          tokensOut: entry.tokensOut,
          ttsSeconds: entry.ttsSeconds,
          contentItemId: entry.contentItemId,
        },
        update: {
          output: entry.output as any,
          audioRef: entry.audioRef,
        },
      });
    },
    async recordHit(cacheKey) {
      await prisma.aiOutput.update({
        where: { cacheKey },
        data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
      });
    },
  };
}

function buildUsageLogger(prisma: PrismaClient): UsageLogger {
  return {
    async log(entry) {
      await prisma.aiUsageLog.create({
        data: {
          task: entry.task,
          providerId: entry.providerId,
          keyId: entry.keyId,
          model: entry.model,
          contentItemId: entry.contentItemId,
          cacheHit: entry.cacheHit,
          tokensIn: entry.tokensIn,
          tokensOut: entry.tokensOut,
          ttsSeconds: entry.ttsSeconds,
          estimatedCostUsd: entry.estimatedCostUsd,
          errorClass: entry.errorClass,
          latencyMs: entry.latencyMs,
        },
      });
    },
  };
}

/** Fallback order: Edge Neural → Kokoro → Gemini → OpenAI. */
export function buildTtsChain(preferred?: string): string[] {
  const kokoroOff =
    process.env.KOKORO_INPROC === '0' &&
    !process.env.KOKORO_URL &&
    !process.env.OPENTTS_URL;
  const base = kokoroOff
    ? ['edge', 'gemini', 'openai']
    : ['edge', 'kokoro', 'gemini', 'openai'];
  if (preferred && base.includes(preferred)) {
    return [preferred, ...base.filter((p) => p !== preferred)];
  }
  return base;
}

function buildRegistry(preferred?: string): ProviderRegistry {
  const providers = new Map();
  providers.set('edge', new EdgeTtsProvider());
  providers.set('gemini', new GeminiProvider());
  providers.set('openai', new OpenAIProvider());
  providers.set('kokoro', new KokoroProvider());
  providers.set('whisper', new WhisperProvider());
  const chain = buildTtsChain(preferred);
  return {
    get: (id: string) => providers.get(id),
    chainFor: (task) => ((task as string) === 'TTS' ? chain : chain),
  };
}

async function resolveChannelVoice(
  prisma: PrismaClient,
  accountId: string | null | undefined,
): Promise<VoiceSettings> {
  const globalRow = await prisma.systemSetting.findUnique({ where: { key: 'tts.default' } });
  const global = (globalRow?.value ?? {}) as Record<string, unknown>;

  if (accountId) {
    const profile = await prisma.channelProfile.findUnique({ where: { accountId } });
    if (profile) {
      const channel = parseVoiceSettings(profile.voiceSettings, profile.language);
      // Channel wins; fill missing speed from global.
      return {
        ...channel,
        speed:
          channel.speed ??
          (typeof global.speed === 'number' ? global.speed : undefined) ??
          1.0,
      };
    }
  }

  return parseVoiceSettings(
    {
      provider: typeof global.provider === 'string' ? global.provider : 'edge',
      voiceId: typeof global.voiceId === 'string' ? global.voiceId : undefined,
      speed: typeof global.speed === 'number' ? global.speed : 1.0,
      language: typeof global.language === 'string' ? global.language : 'en',
    },
    typeof global.language === 'string' ? global.language : 'en',
  );
}

function modelForProvider(provider: string): string {
  if (provider === 'gemini') return 'gemini-2.5-flash-preview-tts';
  if (provider === 'edge') return 'edge-neural';
  return provider;
}

function systemForVoice(voice: VoiceSettings, extra?: Record<string, unknown>): string {
  const emotion = extra?.emotion ?? voice.emotion;
  return JSON.stringify({
    voiceId: voice.voiceId,
    speed: voice.speed ?? 1.0,
    language: voice.language ?? voice.locale ?? 'en',
    ...(voice.rate ? { rate: voice.rate } : {}),
    ...(voice.pitch ? { pitch: voice.pitch } : {}),
    ...(voice.volume ? { volume: voice.volume } : {}),
    ...(emotion ? { emotion } : {}),
    ...extra,
  });
}

function spokenChunks(
  script: string,
  voice: VoiceSettings,
  lines?: TimedNarrationLine[],
  forceEmotion?: TtsEmotion,
): { text: string; emotion: string }[] {
  const fallback = forceEmotion ?? ttsEmotionFromVoiceSettings(voice);
  const usable = (lines ?? []).filter((l) => l.text.trim());
  if (usable.length > 0) {
    return usable.map((l) => ({
      text: l.text.trim(),
      emotion: forceEmotion ?? resolveSpokenEmotion(l.emotion, fallback, l.text),
    }));
  }
  return chunkScript(script).map((text) => ({
    text,
    emotion: forceEmotion ?? resolveSpokenEmotion(undefined, fallback, text),
  }));
}

async function writeAudioRef(
  audioRef: string | undefined,
  output: unknown,
  destPath: string,
): Promise<void> {
  await writeTtsAudioRef(audioRef, output, destPath);
}

function isMp3Path(path: string): boolean {
  return /\.mp3$/i.test(path);
}

async function ensureWav(
  ffmpeg: Ffmpeg,
  ffmpegAvail: boolean,
  sourcePath: string,
  wavPath: string,
): Promise<string> {
  if (!isMp3Path(sourcePath) && sourcePath === wavPath) return wavPath;
  if (!isMp3Path(sourcePath) && !/\.mp3$/i.test(sourcePath)) {
    if (sourcePath !== wavPath) await copyFile(sourcePath, wavPath);
    return wavPath;
  }
  if (ffmpegAvail) {
    await ffmpeg.exec(['-y', '-i', sourcePath, '-ar', '44100', '-ac', '1', wavPath]);
    return wavPath;
  }
  // No ffmpeg — keep mp3 beside expected path name by copying bytes.
  await copyFile(sourcePath, wavPath);
  return wavPath;
}

async function probeDurationMs(ffmpeg: Ffmpeg, path: string): Promise<number> {
  try {
    // ffmpeg -i prints Duration on stderr and exits non-zero without an output file.
    const res = await ffmpeg.exec(['-i', path, '-f', 'null', '-']).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { stdout: '', stderr: msg, code: 1 };
    });
    const blob = `${res.stderr}\n${res.stdout}`;
    const m = blob.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (!m) return 0;
    const h = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3]);
    return Math.round(((h * 60 + min) * 60 + sec) * 1000);
  } catch {
    return 0;
  }
}

interface SynthBundle {
  finalWavPath: string;
  timings: TimedSegment[];
  providerUsed: string;
  voiceId: string;
}

async function synthesizeScript(opts: {
  prisma: PrismaClient;
  masterKey: Buffer;
  script: string;
  voice: VoiceSettings;
  voDir: string;
  contentItemId?: string;
  lines?: TimedNarrationLine[];
  forceEmotion?: TtsEmotion;
}): Promise<SynthBundle> {
  const { prisma, masterKey, script, voice, voDir, contentItemId, lines, forceEmotion } = opts;
  if (!script.trim()) {
    throw new Error('Empty narration text — cannot synthesize voiceover.');
  }
  await mkdir(voDir, { recursive: true });

  const preferred = voice.provider ?? 'edge';
  const chain = buildTtsChain(preferred);
  const first = chain[0] ?? 'edge';

  // Product default: Edge Neural is the synthesizer. Settings preview already
  // uses synthesizeWithEdgeTts. Do not swallow Edge failures into Gemini Flash
  // TTS — that path returns empty audio and hides the real CLI error.
  if (first === 'edge') {
    const binary = await resolveEdgeTtsBinary();
    if (binary.source === 'missing' || !binary.command) {
      throw Object.assign(
        new Error(`Edge Neural TTS is not available on the worker: ${binary.detail}`),
        { code: 'EDGE_TTS_NOT_CONFIGURED' },
      );
    }
    return await synthesizeViaEdge(script, voice, voDir, lines, forceEmotion);
  }

  const keyStore = buildKeyStore(prisma, masterKey);
  const cacheStore = buildCacheStore(prisma);
  const usageLogger = buildUsageLogger(prisma);
  const pool = new KeyPool(keyStore);
  const router = new AIRouter({
    cache: cacheStore,
    logger: usageLogger,
    keyPool: pool,
    registry: buildRegistry(preferred),
  });

  const chunks = spokenChunks(script, voice, lines, forceEmotion);
  const chunkPaths: string[] = [];
  const allTimings: TimedSegment[] = [];
  let offsetMs = 0;
  const ffmpeg = new Ffmpeg();
  const ffmpegAvail = await ffmpeg.available();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const rawPath = join(voDir, `chunk_${String(i).padStart(3, '0')}.bin`);
    const result = await router.run({
      task: 'TTS' as any,
      model: modelForProvider(first),
      system: systemForVoice(voice, {
        outDir: voDir,
        basename: `chunk_${String(i).padStart(3, '0')}`,
        emotion: chunk.emotion,
      }),
      input: { kind: 'text', text: chunk.text },
      ...(contentItemId ? { contentItemId } : {}),
    });

    await writeAudioRef(result.audioRef, result.output, rawPath);
    const wavChunk = join(voDir, `chunk_${String(i).padStart(3, '0')}.wav`);
    await ensureWav(ffmpeg, ffmpegAvail, rawPath, wavChunk);
    if (rawPath !== wavChunk) await unlink(rawPath).catch(() => {});
    chunkPaths[i] = wavChunk;

    const chunkTimings: TimedSegment[] = Array.isArray(result.timings)
      ? result.timings
      : Array.isArray((result.output as { timings?: TimedSegment[] } | null)?.timings)
        ? ((result.output as { timings: TimedSegment[] }).timings ?? [])
        : [];
    allTimings.push(...offsetTimings(chunkTimings, offsetMs));
    const dur = await probeDurationMs(ffmpeg, wavChunk);
    offsetMs += dur > 0 ? dur : estimateDurationFromTimings(chunkTimings);
    if (i < chunks.length - 1) offsetMs += Math.round(INTER_SEGMENT_GAP_SEC * 1000);
  }

  const finalPath = join(voDir, 'voiceover.wav');
  await concatNormalize(ffmpeg, ffmpegAvail, chunkPaths, voDir, finalPath);

  for (const cp of chunkPaths) {
    if (cp && cp !== finalPath) await unlink(cp).catch(() => {});
  }

  return {
    finalWavPath: finalPath,
    timings: allTimings,
    providerUsed: first,
    voiceId: voice.voiceId,
  };
}

function estimateDurationFromTimings(timings: TimedSegment[]): number {
  if (timings.length === 0) return 0;
  return Math.max(...timings.map((t) => t.endMs));
}

async function synthesizeViaEdge(
  script: string,
  voice: VoiceSettings,
  voDir: string,
  lines?: TimedNarrationLine[],
  forceEmotion?: TtsEmotion,
): Promise<SynthBundle> {
  const chunks = spokenChunks(script, voice, lines, forceEmotion);
  const ffmpeg = new Ffmpeg();
  const ffmpegAvail = await ffmpeg.available();
  const chunkWavs: string[] = [];
  const allTimings: TimedSegment[] = [];
  let offsetMs = 0;
  const t0 = Date.now();

  console.log(
    `[worker:tts] Edge synth start: ${chunks.length} chunk(s), scriptChars=${script.length}, voice=${voice.voiceId}, ffmpeg=${ffmpegAvail}`,
  );

  for (let i = 0; i < chunks.length; i++) {
    const base = `chunk_${String(i).padStart(3, '0')}`;
    const chunk = chunks[i]!;
    const chunkChars = chunk.text.length;
    const chunkStart = Date.now();
    console.log(
      `[worker:tts] Edge chunk ${i + 1}/${chunks.length} start (${chunkChars} chars, emotion=${chunk.emotion})`,
    );
    const synth = await synthesizeWithEdgeTts(chunk.text, {
      voice: voice.voiceId,
      rate: voice.rate,
      pitch: voice.pitch,
      volume: voice.volume,
      emotion: chunk.emotion,
      outDir: voDir,
      basename: base,
      writeSubtitles: true,
    });
    const wavChunk = join(voDir, `${base}.wav`);
    await ensureWav(ffmpeg, ffmpegAvail, synth.mediaPath, wavChunk);
    if (synth.mediaPath !== wavChunk) await unlink(synth.mediaPath).catch(() => {});
    if (synth.subtitlePath) await unlink(synth.subtitlePath).catch(() => {});
    chunkWavs.push(wavChunk);
    allTimings.push(...offsetTimings(synth.timings, offsetMs));
    const dur = await probeDurationMs(ffmpeg, wavChunk);
    offsetMs += dur > 0 ? dur : estimateDurationFromTimings(synth.timings);
    if (i < chunks.length - 1) offsetMs += Math.round(INTER_SEGMENT_GAP_SEC * 1000);
    console.log(
      `[worker:tts] Edge chunk ${i + 1}/${chunks.length} done in ${Date.now() - chunkStart}ms (audio~${dur}ms)`,
    );
  }

  const finalPath = join(voDir, 'voiceover.wav');
  const normStart = Date.now();
  await concatNormalize(ffmpeg, ffmpegAvail, chunkWavs, voDir, finalPath);
  console.log(
    `[worker:tts] Edge concat/loudnorm done in ${Date.now() - normStart}ms (total ${Date.now() - t0}ms)`,
  );
  for (const cp of chunkWavs) {
    if (cp !== finalPath) await unlink(cp).catch(() => {});
  }

  // Persist combined subtitle files beside the WAV for download.
  if (allTimings.length > 0) {
    await writeFile(join(voDir, 'voiceover.srt'), segmentsToSrt(allTimings), 'utf8');
    await writeFile(join(voDir, 'voiceover.vtt'), segmentsToVtt(allTimings), 'utf8');
  }

  return {
    finalWavPath: finalPath,
    timings: allTimings,
    providerUsed: 'edge',
    voiceId: voice.voiceId,
  };
}

async function concatNormalize(
  ffmpeg: Ffmpeg,
  ffmpegAvail: boolean,
  chunkPaths: string[],
  voDir: string,
  finalPath: string,
  gapSec: number = INTER_SEGMENT_GAP_SEC,
): Promise<void> {
  // Enhancement (EQ + compressor + loudnorm) requires ffmpeg. Fail clearly
  // rather than storing unprocessed TTS — ffmpeg is an operational dependency.
  if (!ffmpegAvail) {
    throw new FfmpegNotAvailableError(ffmpeg.path);
  }

  const wavOut = ['-ar', '44100', '-ac', '1'] as const;

  if (chunkPaths.length === 1) {
    await ffmpeg.enhanceVoiceover(chunkPaths[0]!, finalPath);
    return;
  }

  const concatEntries: string[] = [];
  const tempSilence: string[] = [];
  for (let i = 0; i < chunkPaths.length; i++) {
    if (i > 0 && gapSec >= MIN_SILENCE_SEC) {
      const silPath = join(voDir, `gap_${String(i).padStart(3, '0')}.wav`);
      await ffmpeg.generateSilenceWav(silPath, gapSec);
      tempSilence.push(silPath);
      concatEntries.push(silPath);
    }
    concatEntries.push(chunkPaths[i]!);
  }

  const listPath = join(voDir, 'concat.txt');
  await writeFile(
    listPath,
    concatEntries.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
  );
  const concatPath = join(voDir, 'concat_raw.wav');
  // Sentence/segment clips with short silence between, then enhance once.
  await ffmpeg.exec([
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    ...wavOut,
    '-y',
    concatPath,
  ]);
  await ffmpeg.enhanceVoiceover(concatPath, finalPath);
  await unlink(listPath).catch(() => {});
  await unlink(concatPath).catch(() => {});
  for (const s of tempSilence) await unlink(s).catch(() => {});
}

/**
 * Never speed up VO. If audio somehow overruns picture, hard-trim only.
 * Scene-aligned clips keep natural pace even when longer than their beat.
 */
async function trimWavToMaxDuration(ffmpeg: Ffmpeg, srcPath: string, maxSec: number): Promise<void> {
  if (!(maxSec > 0)) return;
  const actual = await ffmpeg.probeDurationSec(srcPath);
  if (actual == null || actual <= maxSec * 1.02) return;
  const trimmed = srcPath.replace(/(\.[^.]+)$/, '.trim$1');
  await ffmpeg.trimAudioTo(srcPath, trimmed, maxSec);
  await copyFile(trimmed, srcPath);
  await unlink(trimmed).catch(() => {});
}

/**
 * Synth each timed line at natural pace, insert silence so clips start on
 * analysis timestamps (with a minimum inter-line gap). If a clip is longer
 * than its beat, do NOT speed it — place as-is; later lines start after it
 * (timelinePadPlan). Caption timings follow the actual concat timeline.
 */
async function synthesizeSceneAligned(opts: {
  lines: TimedNarrationLine[];
  voice: VoiceSettings;
  voDir: string;
  videoDurationSec: number | null;
}): Promise<SynthBundle> {
  const { lines, voice, voDir, videoDurationSec } = opts;
  await mkdir(voDir, { recursive: true });
  const ffmpeg = new Ffmpeg();
  if (!(await ffmpeg.available())) {
    throw new FfmpegNotAvailableError(ffmpeg.path);
  }

  const clipPaths: string[] = [];
  const clipMeta: { startSec: number; durationSec: number }[] = [];
  const rawLineTimings: TimedSegment[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text.trim();
    if (!text) continue;
    const base = `line_${String(i).padStart(3, '0')}`;
    const wavPath = join(voDir, `${base}.wav`);
    const synth = await synthesizeWithEdgeTts(text, {
      voice: voice.voiceId,
      rate: voice.rate,
      pitch: voice.pitch,
      volume: voice.volume,
      emotion: resolveSpokenEmotion(
        line.emotion,
        ttsEmotionFromVoiceSettings(voice),
        line.text,
      ),
      outDir: voDir,
      basename: base,
      writeSubtitles: true,
    });
    await ffmpeg.exec([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      synth.mediaPath,
      '-ar',
      '44100',
      '-ac',
      '1',
      '-y',
      wavPath,
    ]);
    if (synth.mediaPath !== wavPath) await unlink(synth.mediaPath).catch(() => {});
    if (synth.subtitlePath) await unlink(synth.subtitlePath).catch(() => {});

    const durSec =
      (await ffmpeg.probeDurationSec(wavPath)) ??
      Math.max(0.4, text.split(/\s+/).filter(Boolean).length / 2.2);
    clipPaths.push(wavPath);
    clipMeta.push({ startSec: Math.max(0, line.startSec), durationSec: durSec });
    rawLineTimings.push(Array.isArray(synth.timings) ? synth.timings : []);
  }

  if (clipPaths.length === 0) {
    throw new Error('Scene-aligned TTS produced no clips');
  }

  const plan = timelinePadPlan(clipMeta, videoDurationSec, {
    minGapSec: INTER_SEGMENT_GAP_SEC,
  });
  const actualStarts = clipStartsFromPadPlan(plan, clipMeta);
  const allTimings: TimedSegment[] = [];
  for (let i = 0; i < rawLineTimings.length; i++) {
    const offsetMs = Math.round((actualStarts[i] ?? 0) * 1000);
    allTimings.push(...offsetTimings(rawLineTimings[i]!, offsetMs));
  }

  const concatEntries: string[] = [];
  const tempSilence: string[] = [];
  let silenceIdx = 0;
  for (const step of plan) {
    if (step.kind === 'silence' && step.durationSec != null && step.durationSec >= MIN_SILENCE_SEC) {
      const silPath = join(voDir, `sil_${String(silenceIdx++).padStart(3, '0')}.wav`);
      await ffmpeg.generateSilenceWav(silPath, step.durationSec);
      tempSilence.push(silPath);
      concatEntries.push(silPath);
    } else if (step.kind === 'audio' && step.index != null) {
      const p = clipPaths[step.index];
      if (p) concatEntries.push(p);
    }
  }

  const listPath = join(voDir, 'scene_concat.txt');
  await writeFile(
    listPath,
    concatEntries.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'),
  );
  const concatPath = join(voDir, 'scene_raw.wav');
  const finalPath = join(voDir, 'voiceover.wav');
  await ffmpeg.exec([
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
    concatPath,
  ]);
  await ffmpeg.enhanceVoiceover(concatPath, finalPath);
  await unlink(listPath).catch(() => {});
  await unlink(concatPath).catch(() => {});
  for (const s of tempSilence) await unlink(s).catch(() => {});
  for (const c of clipPaths) await unlink(c).catch(() => {});

  if (videoDurationSec != null && videoDurationSec > 1) {
    await trimWavToMaxDuration(ffmpeg, finalPath, videoDurationSec);
  }

  return {
    finalWavPath: finalPath,
    timings: allTimings,
    providerUsed: 'edge',
    voiceId: voice.voiceId,
  };
}

export async function runTts(contentItemId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      idea: { select: { accountId: true } },
      sourceVideo: {
        select: {
          durationSec: true,
          watchedSource: { select: { targetAccountId: true } },
        },
      },
      assets: { where: { kind: { in: ['ORIGINAL', 'FINAL'] } }, select: { kind: true, localPath: true } },
    },
  });
  if (!item) {
    console.warn(`[worker:tts] content item ${contentItemId} not found — skipping`);
    return;
  }

  if (item.status !== 'SCRIPT_APPROVED') {
    console.log(
      `[worker:tts] item ${contentItemId} is ${item.status}, not SCRIPT_APPROVED — skipping`,
    );
    return;
  }

  const ksRow = await prisma.systemSetting.findUnique({ where: { key: 'killSwitches' } });
  const ks = (ksRow?.value ?? {}) as Record<string, boolean>;
  if (ks['ai.global'] || ks['ai.task.TTS']) {
    console.warn(`[worker:tts] TTS is disabled via kill switch — skipping ${contentItemId}`);
    return;
  }

  const mkRaw = process.env.MASTER_KEY;
  const masterKey = mkRaw ? loadMasterKey(mkRaw) : null;
  if (!masterKey) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'TTS failed: MASTER_KEY not configured',
    });
    return;
  }

  const currentStep = (item.currentStep ?? {}) as Record<string, unknown>;
  const rawScript = currentStep.script;
  const script =
    typeof rawScript === 'string'
      ? rawScript
      : rawScript &&
          typeof rawScript === 'object' &&
          typeof (rawScript as { script?: unknown }).script === 'string'
        ? String((rawScript as { script: string }).script)
        : typeof rawScript === 'object' && rawScript
          ? JSON.stringify(rawScript)
          : item.title;

  if (!script || !script.trim()) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'TTS failed: no script found in aiMeta',
    });
    return;
  }

  if (!STORAGE_ROOT) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'TTS failed: STORAGE_ROOT not configured',
    });
    return;
  }

  const accountId =
    item.idea?.accountId ?? item.sourceVideo?.watchedSource?.targetAccountId ?? null;
  const voice = await resolveChannelVoice(prisma, accountId);
  const voDir = join(STORAGE_ROOT, 'content', contentItemId, 'tts');

  try {
    let videoDur = analysisDurationSec(
      currentStep.analysis,
      typeof item.sourceVideo?.durationSec === 'number' ? item.sourceVideo.durationSec : null,
    );
    if (videoDur == null) {
      const probeFfmpeg = new Ffmpeg();
      const asset =
        item.assets.find((a) => a.kind === 'FINAL' && a.localPath) ??
        item.assets.find((a) => a.kind === 'ORIGINAL' && a.localPath);
      if (asset?.localPath && (await probeFfmpeg.available())) {
        videoDur = await probeFfmpeg.probeDurationSec(asset.localPath);
      }
    }
    const timedLines = timedLinesFromStep(currentStep)
      .filter((l) => l.text.trim())
      .map((l) => ({ ...l, emotion: REPURPOSED_VOICE_EMOTION }));
    let synth: SynthBundle;
    if (timedLines.length >= 2) {
      console.log(
        `[worker:tts] scene-aligned synth for ${contentItemId} (${timedLines.length} lines, natural pace, no speedup)` +
          (videoDur != null ? ` videoDur=${videoDur.toFixed(2)}s` : ''),
      );
      try {
        synth = await synthesizeSceneAligned({
          lines: timedLines,
          voice,
          voDir,
          videoDurationSec: videoDur,
        });
      } catch (err) {
        console.warn(
          `[worker:tts] scene-aligned failed, falling back to continuous: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        synth = await synthesizeScript({
          prisma,
          masterKey,
          script,
          voice,
          voDir,
          contentItemId,
          lines: timedLines,
          forceEmotion: REPURPOSED_VOICE_EMOTION,
        });
        if (videoDur != null) {
          const ffmpeg = new Ffmpeg();
          if (await ffmpeg.available()) {
            await trimWavToMaxDuration(ffmpeg, synth.finalWavPath, videoDur);
          }
        }
      }
    } else {
      console.log(
        `[worker:tts] continuous synth for ${contentItemId}` +
          (videoDur != null ? ` (trimTo=${videoDur.toFixed(2)}s if overrun)` : ''),
      );
      synth = await synthesizeScript({
        prisma,
        masterKey,
        script,
        voice,
        voDir,
        contentItemId,
        lines: timedLines,
        forceEmotion: REPURPOSED_VOICE_EMOTION,
      });
      if (videoDur != null) {
        const ffmpeg = new Ffmpeg();
        if (await ffmpeg.available()) {
          await trimWavToMaxDuration(ffmpeg, synth.finalWavPath, videoDur);
        }
      }
    }

    const stats = await stat(synth.finalWavPath);
    const existingVo = await prisma.asset.findFirst({
      where: { contentItemId, kind: 'VOICEOVER' },
      orderBy: { createdAt: 'desc' },
    });
    if (existingVo) {
      await prisma.asset.update({
        where: { id: existingVo.id },
        data: {
          localPath: synth.finalWavPath,
          bytes: BigInt(stats.size),
          storageState: 'LOCAL',
        },
      });
    } else {
      await prisma.asset.create({
        data: {
          contentItemId,
          kind: 'VOICEOVER',
          storageState: 'LOCAL',
          localPath: synth.finalWavPath,
          bytes: BigInt(stats.size),
        },
      });
    }

    // Always write SRT from timings (Edge continuous + scene-aligned) so burn-in works.
    const srtPath = join(dirname(synth.finalWavPath), 'voiceover.srt');
    if (synth.timings.length > 0) {
      await writeFile(srtPath, segmentsToSrt(synth.timings), 'utf8');
      await writeFile(
        join(dirname(synth.finalWavPath), 'voiceover.vtt'),
        segmentsToVtt(synth.timings),
        'utf8',
      );
    }
    try {
      const srtStats = await stat(srtPath);
      const existingSub = await prisma.asset.findFirst({
        where: { contentItemId, kind: 'SUBTITLE' },
        orderBy: { createdAt: 'desc' },
      });
      if (existingSub) {
        await prisma.asset.update({
          where: { id: existingSub.id },
          data: {
            localPath: srtPath,
            bytes: BigInt(srtStats.size),
            storageState: 'LOCAL',
          },
        });
      } else {
        await prisma.asset.create({
          data: {
            contentItemId,
            kind: 'SUBTITLE',
            storageState: 'LOCAL',
            localPath: srtPath,
            bytes: BigInt(srtStats.size),
          },
        });
      }
    } catch {
      console.warn(`[worker:tts] no SRT registered for ${contentItemId} (timings empty?)`);
    }

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'TTS_DONE' },
    });

    await boss.send(QUEUE.STORAGE, { kind: 'render', contentItemId } as RenderJob, {
      singletonKey: `render-${contentItemId}`,
    });

    console.log(
      `[worker:tts] TTS done for ${contentItemId} via ${synth.providerUsed}/${synth.voiceId} — enqueued render`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:tts] TTS failed for ${contentItemId}:`, errMsg);

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'FAILED' },
    });

    await raiseIncident(prisma, {
      kind: err instanceof AllProvidersExhaustedError ? 'RATE_LIMIT' : 'SYSTEM',
      contentItemId,
      title: `TTS failed: ${errMsg.slice(0, 200)}`,
      detail: { error: errMsg },
    });
  }
}

/**
 * AI-owner package voiceover. On success advances packageStage to VOICE and
 * enqueues the timed-transcript stage for narration packages.
 */
export async function runIdeaTts(ideaId: string, boss?: PgBoss): Promise<void> {
  const prisma = getPrisma();

  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, deletedAt: null },
    include: { brief: true },
  });
  if (!idea?.brief) {
    console.warn(`[worker:tts] idea ${ideaId} or brief missing — skipping idea TTS`);
    return;
  }

  const script = idea.brief.script?.trim() ?? '';
  if (!script) {
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        voiceoverStatus: 'FAILED',
        voiceoverLocalPath: null,
        packageStage: 'FAILED',
        packageStageError: 'Empty narration script — cannot synthesize voiceover.',
      },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'FAILED', status: 'APPROVED' },
    });
    return;
  }

  const ksRow = await prisma.systemSetting.findUnique({ where: { key: 'killSwitches' } });
  const ks = (ksRow?.value ?? {}) as Record<string, boolean>;
  if (ks['ai.global'] || ks['ai.task.TTS']) {
    console.warn(`[worker:tts] TTS disabled — skipping idea ${ideaId}`);
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        voiceoverStatus: 'FAILED',
        packageStage: 'FAILED',
        packageStageError: 'TTS disabled via kill switch',
      },
    });
    await prisma.idea.update({ where: { id: ideaId }, data: { packageStatus: 'FAILED', status: 'APPROVED' } });
    return;
  }

  const mkRaw = process.env.MASTER_KEY;
  const masterKey = mkRaw ? loadMasterKey(mkRaw) : null;
  if (!masterKey || !STORAGE_ROOT) {
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        voiceoverStatus: 'FAILED',
        packageStage: 'FAILED',
        packageStageError: !masterKey ? 'MASTER_KEY not configured' : 'STORAGE_ROOT not configured',
      },
    });
    await prisma.idea.update({ where: { id: ideaId }, data: { packageStatus: 'FAILED', status: 'APPROVED' } });
    return;
  }

  await prisma.productionBrief.update({
    where: { ideaId },
    data: {
      voiceoverStatus: 'GENERATING',
      packageStage: 'VOICE',
      packageStageError: null,
    },
  });

  const voice = await resolveChannelVoice(prisma, idea.accountId);
  const styleRow = await prisma.channelProfile.findUnique({
    where: { accountId: idea.accountId },
    select: { styleProfile: true },
  });
  const documentaryVo =
    isDocumentaryVoiceoverPackage(styleRow?.styleProfile) ||
    isDocumentaryIdeaGeneration(styleRow?.styleProfile);
  const forceEmotion = documentaryVo ? DOCUMENTARY_VOICE_EMOTION : undefined;
  const voDir = join(STORAGE_ROOT, 'ideas', ideaId, 'tts');
  const words = script.split(/\s+/).filter(Boolean).length;
  const extras = splitProductionBriefEditingExtras(idea.brief.editingInstructions ?? '');
  const storedLines = (() => {
    const fromTranscript = spokenLinesFromUnknown(idea.brief.timedTranscript);
    if (fromTranscript.length > 0) return fromTranscript;
    return spokenLinesFromUnknown(parseSpokenNarrationLines(extras.narrationLines));
  })();
  console.log(
    `[worker:tts] idea ${ideaId} VOICE start: chars=${script.length}, words≈${words}, provider=${voice.provider}, voiceId=${voice.voiceId}`,
  );

  try {
    const synth = await synthesizeScript({
      prisma,
      masterKey,
      script,
      voice,
      voDir,
      lines: storedLines,
      ...(forceEmotion ? { forceEmotion } : {}),
    });

    const transcriptPath =
      synth.timings.length > 0 ? join(voDir, 'voiceover.srt') : null;
    if (synth.timings.length > 0 && transcriptPath) {
      await writeFile(transcriptPath, segmentsToSrt(synth.timings), 'utf8');
      await writeFile(join(voDir, 'voiceover.vtt'), segmentsToVtt(synth.timings), 'utf8');
    }

    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        voiceoverStatus: 'READY',
        voiceoverLocalPath: synth.finalWavPath,
        timedTranscript: synth.timings as any,
        transcriptLocalPath: transcriptPath,
        voiceIdUsed: `${synth.providerUsed}:${synth.voiceId}`,
        packageStage: 'VOICE',
        packageStageError: null,
      },
    });

    console.log(
      `[worker:tts] idea voiceover ready for ${ideaId} via ${synth.providerUsed}/${synth.voiceId}`,
    );

    if (boss) {
      await boss.send(
        QUEUE.AI,
        { kind: 'idea_transcript', ideaId } satisfies IdeaTranscriptJob,
        { singletonKey: `idea-transcript-${ideaId}` },
      );
      console.log(`[worker:tts] enqueued transcript stage for idea ${ideaId}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:tts] idea TTS failed for ${ideaId}:`, errMsg);
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        voiceoverStatus: 'FAILED',
        voiceoverLocalPath: null,
        packageStage: 'FAILED',
        packageStageError: `Voice stage failed: ${errMsg.slice(0, 400)}`,
      },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'FAILED', status: 'APPROVED' },
    });
    await raiseIncident(prisma, {
      kind: err instanceof AllProvidersExhaustedError ? 'RATE_LIMIT' : 'SYSTEM',
      title: `Idea TTS failed: ${errMsg.slice(0, 200)}`,
      detail: { ideaId, error: errMsg },
    });
  }
}
