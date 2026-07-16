/**
 * TTS processor (docs/05 §6, Phase 3.5). Consumes the TTS queue after a
 * content item's script has been approved (SCRIPT_APPROVED). Synthesizes
 * voiceover via the AI router's TTS chain: Kokoro→Gemini→OpenAI.
 *
 * Long scripts are chunked at sentence boundaries, synthesized in parallel,
 * concatenated with silence padding, and loudness-normalized (EBU R128) via
 * the existing ffmpeg wrapper. The result is archived as a VOICEOVER asset.
 */
import { join } from 'node:path';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import { decryptSecret, loadMasterKey } from '@scp/shared';
import {
  AIRouter,
  KeyPool,
  GeminiProvider,
  OpenAIProvider,
  KokoroProvider,
  WhisperProvider,
  AllProvidersExhaustedError,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type KeyStore,
  type KeyState,
  type AIProvider,
} from '@scp/ai-providers';
import { Ffmpeg, FfmpegNotAvailableError } from './media/ffmpeg.js';
import type { RenderJob } from './ai-jobs.js';
import { getPrisma, raiseIncident, type PrismaClient } from './publish-support.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '';

// ── Sentence chunking ───────────────────────────────────────────────────────

const SENTENCE_SPLIT = /(?<=[.!?。！？])\s+/;
const MAX_CHUNK_CHARS = 4000;

function chunkScript(script: string): string[] {
  const sentences = script.split(SENTENCE_SPLIT).filter((s) => s.trim());
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > MAX_CHUNK_CHARS && current) {
      chunks.push(current.trim());
      current = '';
    }
    current += (current ? ' ' : '') + sentence;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [script];
}

// ── Store builders (same as ai-process.ts — inline to avoid circular deps) ──

function buildKeyStore(prisma: PrismaClient, masterKey: Buffer): KeyStore {
  return {
    async listByProvider(providerId: string): Promise<KeyState[]> {
      const rows = await prisma.aiKey.findMany({
        where: { providerId, status: { not: 'DISABLED' } },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      });
      return rows.map((r) => ({
        id: r.id,
        providerId: r.providerId,
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

function buildRegistry(): ProviderRegistry {
  const providers = new Map<string, AIProvider>();
  providers.set('gemini', new GeminiProvider());
  providers.set('openai', new OpenAIProvider());
  providers.set('kokoro', new KokoroProvider());
  providers.set('whisper', new WhisperProvider());

  const chains: Record<string, string[]> = {
    TTS: ['kokoro', 'gemini', 'openai'],
  };

  return {
    get: (id: string) => providers.get(id),
    chainFor: (task) => chains[task as string] ?? ['kokoro', 'gemini', 'openai'],
  };
}

// ── TTS voice config ────────────────────────────────────────────────────────

interface VoiceConfig {
  provider?: string;
  voiceId?: string;
  speed?: number;
  language?: string;
}

async function getVoiceConfig(prisma: PrismaClient): Promise<VoiceConfig> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'tts.default' } });
  return (row?.value ?? {}) as VoiceConfig;
}

// ── Main TTS processor ─────────────────────────────────────────────────────

export async function runTts(contentItemId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();

  const item = await prisma.contentItem.findUnique({ where: { id: contentItemId } });
  if (!item) {
    // eslint-disable-next-line no-console
    console.warn(`[worker:tts] content item ${contentItemId} not found — skipping`);
    return;
  }

  if (item.status !== 'SCRIPT_APPROVED') {
    // eslint-disable-next-line no-console
    console.log(`[worker:tts] item ${contentItemId} is ${item.status}, not SCRIPT_APPROVED — skipping`);
    return;
  }

  // Kill-switch check
  const ksRow = await prisma.systemSetting.findUnique({ where: { key: 'killSwitches' } });
  const ks = (ksRow?.value ?? {}) as Record<string, boolean>;
  if (ks['ai.global'] || ks['ai.task.TTS']) {
    // eslint-disable-next-line no-console
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

  // Extract script from currentStep
  const currentStep = (item.currentStep ?? {}) as Record<string, unknown>;
  const script = typeof currentStep.script === 'string'
    ? currentStep.script
    : typeof currentStep.script === 'object'
      ? JSON.stringify(currentStep.script)
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

  const voiceConfig = await getVoiceConfig(prisma);
  const chunks = chunkScript(script);

  // Build router
  const keyStore = buildKeyStore(prisma, masterKey);
  const cacheStore = buildCacheStore(prisma);
  const usageLogger = buildUsageLogger(prisma);
  const pool = new KeyPool(keyStore);
  const router = new AIRouter({ cache: cacheStore, logger: usageLogger, keyPool: pool, registry: buildRegistry() });

  // Prepare output directory
  if (!STORAGE_ROOT) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'TTS failed: STORAGE_ROOT not configured',
    });
    return;
  }

  const voDir = join(STORAGE_ROOT, 'content', contentItemId, 'tts');
  await mkdir(voDir, { recursive: true });

  try {
    // Synthesize chunks (parallel for throughput)
    const chunkPaths: string[] = [];
    const synthPromises = chunks.map(async (chunk, i) => {
      const chunkPath = join(voDir, `chunk_${String(i).padStart(3, '0')}.wav`);

      const result = await router.run({
        task: 'TTS' as any,
        model: voiceConfig.provider ?? 'kokoro',
        system: JSON.stringify({
          voiceId: voiceConfig.voiceId ?? 'default',
          speed: voiceConfig.speed ?? 1.0,
          language: voiceConfig.language ?? 'en',
        }),
        input: { kind: 'text', text: chunk },
        contentItemId,
      });

      // If audioRef is a base64 data URI, decode and write
      if (result.audioRef) {
        const b64Match = result.audioRef.match(/^data:[^;]*;base64,(.+)$/);
        if (b64Match) {
          await writeFile(chunkPath, Buffer.from(b64Match[1]!, 'base64'));
        } else {
          // audioRef is a file path — the provider already wrote it
          chunkPaths[i] = result.audioRef;
          return;
        }
      } else if (typeof result.output === 'string') {
        // Some TTS providers return base64 audio as the output
        await writeFile(chunkPath, Buffer.from(result.output, 'base64'));
      }
      chunkPaths[i] = chunkPath;
    });

    await Promise.all(synthPromises);

    // Concatenate chunks + silence padding + EBU R128 normalize
    const finalPath = join(voDir, 'voiceover.wav');
    const ffmpeg = new Ffmpeg();
    const ffmpegAvail = await ffmpeg.available();

    if (chunkPaths.length === 1) {
      // Single chunk — just normalize if ffmpeg is available
      if (ffmpegAvail) {
        await ffmpeg.trimNormalize(chunkPaths[0]!, finalPath, {});
      } else {
        // Copy the single chunk as the final file
        const { copyFile } = await import('node:fs/promises');
        await copyFile(chunkPaths[0]!, finalPath);
      }
    } else if (ffmpegAvail) {
      // Build concat file list
      const listPath = join(voDir, 'concat.txt');
      const listContent = chunkPaths
        .map((p) => `file '${p!.replace(/\\/g, '/')}'`)
        .join('\n');
      await writeFile(listPath, listContent);

      // Concat with silence padding + loudness normalize
      const concatPath = join(voDir, 'concat_raw.wav');
      await ffmpeg.exec([
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-af', 'apad=pad_dur=0.3',
        '-y', concatPath,
      ]);

      // EBU R128 loudness normalization
      await ffmpeg.exec([
        '-i', concatPath,
        '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5',
        '-y', finalPath,
      ]);

      // Clean up intermediate files
      await unlink(listPath).catch(() => {});
      await unlink(concatPath).catch(() => {});
    } else {
      // No ffmpeg — use first chunk, raise warning incident
      const { copyFile } = await import('node:fs/promises');
      await copyFile(chunkPaths[0]!, finalPath);
      await raiseIncident(prisma, {
        kind: 'SYSTEM',
        severity: 'LOW',
        contentItemId,
        title: 'TTS: ffmpeg absent — chunks not concatenated/normalized',
      });
    }

    // Clean up individual chunk files
    for (const cp of chunkPaths) {
      if (cp && cp !== finalPath) {
        await unlink(cp).catch(() => {});
      }
    }

    // Create VOICEOVER asset
    const { stat } = await import('node:fs/promises');
    const stats = await stat(finalPath);
    await prisma.asset.create({
      data: {
        contentItemId,
        kind: 'VOICEOVER',
        storageState: 'LOCAL',
        localPath: finalPath,
        bytes: BigInt(stats.size),
      },
    });

    // Transition to TTS_DONE
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'TTS_DONE' },
    });

    // Chain: enqueue render job
    await boss.send(QUEUE.STORAGE, { kind: 'render', contentItemId } as RenderJob, {
      singletonKey: `render-${contentItemId}`,
    });

    // eslint-disable-next-line no-console
    console.log(`[worker:tts] TTS done for ${contentItemId} — enqueued render`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[worker:tts] TTS failed for ${contentItemId}:`, errMsg);

    await prisma.contentItem.update({
      where: { id: contentItemId }, data: { status: 'FAILED' },
    });

    const incidentKind = err instanceof AllProvidersExhaustedError
      ? 'RATE_LIMIT' as const
      : err instanceof FfmpegNotAvailableError
        ? 'SYSTEM' as const
        : 'SYSTEM' as const;
    await raiseIncident(prisma, {
      kind: incidentKind,
      contentItemId,
      title: `TTS failed: ${errMsg.slice(0, 200)}`,
      detail: { error: errMsg },
    });
  }
}
