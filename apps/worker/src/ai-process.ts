/**
 * AI processor (docs/05, Phase 3.4). Consumes the AI queue with discriminated
 * jobs: analyze (video→structured summary), narration (summary→script),
 * metadata (script→title/desc/tags). Each advances the content-item state
 * machine via Prisma and chains to the next stage.
 *
 * Uses the @scp/ai-providers router with Prisma-backed stores for keys, cache,
 * and usage logging. Kill switches checked before every call.
 */
import type PgBoss from 'pg-boss';
import { QUEUE, TaskType } from '@scp/shared';
import { decryptSecret, loadMasterKey } from '@scp/shared';
import {
  AIRouter,
  KeyPool,
  GeminiProvider,
  OpenAIProvider,
  KokoroProvider,
  WhisperProvider,
  cacheKeyFor,
  hashText,
  AllProvidersExhaustedError,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type KeyStore,
  type KeyState,
  type AIProvider,
  type AIResult,
} from '@scp/ai-providers';
import type { AiJob } from './ai-jobs.js';
import { getPrisma, raiseIncident, type PrismaClient } from './publish-support.js';

// ── Worker-side Prisma stores ───────────────────────────────────────────────

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
          tokensIn: entry.tokensIn,
          tokensOut: entry.tokensOut,
          ttsSeconds: entry.ttsSeconds,
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
    VIDEO_ANALYSIS: ['gemini'],
    NARRATION_REWRITE: ['gemini'],
    METADATA: ['gemini'],
    IDEA_GENERATION: ['gemini'],
    BRIEF_GENERATION: ['gemini'],
    DRAMA_BIBLE: ['gemini'],
    DRAMA_EPISODE: ['gemini'],
    TTS: ['kokoro', 'gemini', 'openai'],
    TRANSCRIBE: ['whisper', 'gemini'],
  };

  return {
    get: (id: string) => providers.get(id),
    chainFor: (task) => chains[task as string] ?? ['gemini'],
  };
}

// ── Kill-switch check ───────────────────────────────────────────────────────

async function checkKillSwitch(prisma: PrismaClient, task: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'killSwitches' } });
  const ks = (row?.value ?? {}) as Record<string, boolean>;
  if (ks['ai.global']) return 'AI is globally disabled';
  if (ks[`ai.task.${task}`]) return `AI task "${task}" is disabled`;
  return null;
}

// ── Active prompt loader ────────────────────────────────────────────────────

async function getActivePrompt(
  prisma: PrismaClient,
  task: string,
  name: string,
  accountId?: string | null,
): Promise<{ template: string; version: number } | null> {
  if (accountId) {
    const scoped = await prisma.promptVersion.findFirst({
      where: { accountId, task, name, isActive: true },
    });
    if (scoped) return { template: scoped.template, version: scoped.version };
  }
  const global = await prisma.promptVersion.findFirst({
    where: { accountId: null, task, name, isActive: true },
  });
  return global ? { template: global.template, version: global.version } : null;
}

// ── Resolve accountId from content item's publish targets ────────────────────

async function resolveAccountId(prisma: PrismaClient, contentItemId: string): Promise<string | null> {
  const target = await prisma.publishTarget.findFirst({
    where: { contentItemId },
    select: { accountId: true },
  });
  return target?.accountId ?? null;
}

// ── Main AI processor ───────────────────────────────────────────────────────

export async function runAi(job: AiJob, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const { kind, contentItemId } = job;

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { sourceVideo: true },
  });
  if (!item) {
    // eslint-disable-next-line no-console
    console.warn(`[worker:ai] content item ${contentItemId} not found — skipping`);
    return;
  }

  const taskMap: Record<string, { task: string; fromStatus: string }> = {
    analyze: { task: TaskType.VIDEO_ANALYSIS, fromStatus: 'APPROVED' },
    narration: { task: TaskType.NARRATION_REWRITE, fromStatus: 'ANALYZING' },
    metadata: { task: TaskType.METADATA, fromStatus: 'RENDERED' },
  };

  const spec = taskMap[kind];
  if (!spec) {
    // eslint-disable-next-line no-console
    console.warn(`[worker:ai] unknown AI job kind "${kind}" — skipping`);
    return;
  }

  const killed = await checkKillSwitch(prisma, spec.task);
  if (killed) {
    // eslint-disable-next-line no-console
    console.warn(`[worker:ai] ${killed} — skipping job for ${contentItemId}`);
    return;
  }

  // For 'analyze': transition APPROVED→ANALYZING
  if (kind === 'analyze') {
    if (item.status !== 'APPROVED') {
      // eslint-disable-next-line no-console
      console.log(`[worker:ai] item ${contentItemId} is ${item.status}, not APPROVED — skipping analyze`);
      return;
    }
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'ANALYZING' },
    });
  }

  const mkRaw = process.env.MASTER_KEY;
  const masterKey = mkRaw ? loadMasterKey(mkRaw) : null;
  if (!masterKey) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: `AI ${kind} failed: MASTER_KEY not configured`,
    });
    return;
  }

  const keyStore = buildKeyStore(prisma, masterKey);
  const cacheStore = buildCacheStore(prisma);
  const usageLogger = buildUsageLogger(prisma);
  const pool = new KeyPool(keyStore);
  const router = new AIRouter({
    cache: cacheStore,
    logger: usageLogger,
    keyPool: pool,
    registry: buildRegistry(),
  });

  const accountId = await resolveAccountId(prisma, contentItemId);
  const prompt = await getActivePrompt(prisma, spec.task, 'default', accountId);
  const systemPrompt = prompt?.template ?? `You are a video content processing AI. Task: ${spec.task}`;
  const promptVersion = prompt?.version ?? 1;

  // Use currentStep (Json) to store/retrieve AI results
  const currentStep = (item.currentStep ?? {}) as Record<string, unknown>;

  let inputText: string;
  if (kind === 'analyze') {
    inputText = JSON.stringify({
      title: item.title,
      sourceUrl: item.sourceVideo?.sourceUrl,
      uploaderName: item.sourceVideo?.uploaderName,
      durationSec: item.sourceVideo?.durationSec,
    });
  } else if (kind === 'narration') {
    inputText = JSON.stringify({
      title: item.title,
      analysis: currentStep.analysis ?? item.title,
    });
  } else {
    inputText = JSON.stringify({
      title: item.title,
      script: currentStep.script ?? item.title,
    });
  }

  const cacheKey = cacheKeyFor({
    task: spec.task as any,
    model: 'gemini-2.5-flash',
    promptVersion,
    styleVersion: 1,
    inputContentHash: hashText(inputText),
  });

  try {
    const result: AIResult = await router.run({
      task: spec.task as any,
      model: 'gemini-2.5-flash',
      system: systemPrompt,
      input: { kind: 'text', text: inputText },
      cacheKey,
      contentItemId,
    });

    const updatedStep = { ...currentStep };

    if (kind === 'analyze') {
      updatedStep.analysis = result.output;
      await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { currentStep: updatedStep as any },
      });
      await boss.send(QUEUE.AI, { kind: 'narration', contentItemId } as AiJob, {
        singletonKey: `narration-${contentItemId}`,
      });
      // eslint-disable-next-line no-console
      console.log(`[worker:ai] analyze done for ${contentItemId} — enqueued narration`);
    } else if (kind === 'narration') {
      updatedStep.script = result.output;
      await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { currentStep: updatedStep as any, status: 'SCRIPT_READY' },
      });
      // eslint-disable-next-line no-console
      console.log(`[worker:ai] narration done for ${contentItemId} — awaiting script approval`);
    } else {
      updatedStep.metadata = result.output;
      await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { currentStep: updatedStep as any, status: 'METADATA_READY' },
      });
      // eslint-disable-next-line no-console
      console.log(`[worker:ai] metadata done for ${contentItemId}`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[worker:ai] ${kind} failed for ${contentItemId}:`, errMsg);

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'FAILED' },
    });

    const incidentKind = err instanceof AllProvidersExhaustedError ? 'RATE_LIMIT' as const : 'SYSTEM' as const;
    await raiseIncident(prisma, {
      kind: incidentKind,
      contentItemId,
      title: `AI ${kind} failed: ${errMsg.slice(0, 200)}`,
      detail: { error: errMsg, task: spec.task },
    });
  }
}
