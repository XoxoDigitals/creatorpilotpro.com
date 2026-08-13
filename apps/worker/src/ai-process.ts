/**
 * AI processor (docs/05, Phase 3.4). Consumes the AI queue with discriminated
 * jobs: analyze (video→structured summary), narration (summary→script),
 * metadata (script→title/desc/tags). Each advances the content-item state
 * machine via Prisma and chains to the next stage.
 *
 * Uses the @scp/ai-providers router with Prisma-backed stores for keys, cache,
 * and usage logging. Kill switches checked before every call.
 */
import { stat } from 'node:fs/promises';
import type PgBoss from 'pg-boss';
import {
  QUEUE,
  TaskType,
  styleVersionFromProfile,
  withChannelStyle,
  type ChannelStyleFields,
} from '@scp/shared';
import { decryptSecret, loadMasterKey } from '@scp/shared/crypto';
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
  DEFAULT_GEMINI_TEXT_MODEL,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type KeyStore,
  type KeyState,
  type AIProvider,
  type AIResult,
  type AIInput,
} from '@scp/ai-providers';
import type { AiJob } from './ai-jobs.js';
import { getPrisma, raiseIncident, type PrismaClient } from './publish-support.js';
import {
  builtinSystemPrompt,
  extractNarrationScript,
  repurposePromptVersion,
  schemaForRepurposeTask,
} from './repurpose-prompts.js';
import {
  peekGeminiApiKey,
  prepareAnalysisMedia,
  type PreparedAnalysisMedia,
} from './video-for-analysis.js';

// ── Worker-side Prisma stores ───────────────────────────────────────────────

function buildKeyStore(prisma: PrismaClient, masterKey: Buffer): KeyStore {
  return {
    async listByProvider(providerId: string): Promise<KeyState[]> {
      // `providerId` is the provider slug ("gemini"), not the ai_providers cuid —
      // match on the relation's name, not the raw FK.
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

// ── Resolve accountId (+ platform) for channel style & metadata ──────────────

/**
 * Prefer an existing publish target, then the watched-source target account
 * (REPURPOSED ingest), then the linked idea's account (AI packages).
 */
async function resolveAccountContext(
  prisma: PrismaClient,
  contentItemId: string,
): Promise<{ accountId: string; platform: string } | null> {
  const target = await prisma.publishTarget.findFirst({
    where: { contentItemId },
    select: { accountId: true, account: { select: { platform: true } } },
  });
  if (target?.accountId) {
    return { accountId: target.accountId, platform: target.account.platform };
  }

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: {
      idea: { select: { accountId: true, account: { select: { platform: true } } } },
      sourceVideo: {
        select: {
          watchedSource: {
            select: {
              targetAccountId: true,
              targetAccount: { select: { platform: true } },
            },
          },
        },
      },
    },
  });

  const watchedId = item?.sourceVideo?.watchedSource?.targetAccountId;
  const watchedPlatform = item?.sourceVideo?.watchedSource?.targetAccount?.platform;
  if (watchedId && watchedPlatform) {
    return { accountId: watchedId, platform: watchedPlatform };
  }

  const ideaId = item?.idea?.accountId;
  const ideaPlatform = item?.idea?.account?.platform;
  if (ideaId && ideaPlatform) {
    return { accountId: ideaId, platform: ideaPlatform };
  }

  return null;
}

async function loadChannelStyle(
  prisma: PrismaClient,
  accountId: string | null,
): Promise<ChannelStyleFields | null> {
  if (!accountId) return null;
  const profile = await prisma.channelProfile.findUnique({ where: { accountId } });
  if (!profile) return null;
  return {
    masterPrompt: profile.masterPrompt,
    writingStyle: profile.writingStyle,
    narrationStyle: profile.narrationStyle,
    language: profile.language,
    styleProfile: profile.styleProfile,
    thumbnailReferencePrompt: profile.thumbnailReferencePrompt,
    animationReferencePrompt: profile.animationReferencePrompt,
  };
}

// ── Main AI processor ───────────────────────────────────────────────────────

export async function runAi(job: AiJob, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const { kind, contentItemId } = job;

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: {
      sourceVideo: true,
      // Load FINAL + ORIGINAL for VIDEO_ANALYSIS — analyze reads the actual
      // pixels, not just the title/URL, so we can identify beats, characters,
      // pacing, etc. (docs/05 §3 — Gemini multimodal input).
      assets: { where: { kind: { in: ['FINAL', 'ORIGINAL'] } } },
    },
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

  const accountCtx = await resolveAccountContext(prisma, contentItemId);
  const accountId = accountCtx?.accountId ?? null;
  const platform = accountCtx?.platform ?? null;
  const channelStyle = await loadChannelStyle(prisma, accountId);
  const prompt = await getActivePrompt(prisma, spec.task, 'default', accountId);
  const systemPrompt = withChannelStyle(
    prompt?.template ??
      builtinSystemPrompt(spec.task, channelStyle?.language, platform),
    channelStyle,
  );
  const promptVersion = repurposePromptVersion(prompt?.version);

  // Use currentStep (Json) to store/retrieve AI results
  const currentStep = (item.currentStep ?? {}) as Record<string, unknown>;

  let media: PreparedAnalysisMedia | null = null;
  let inputText: string;
  let runInput: AIInput;

  if (kind === 'analyze') {
    // Prefer FINAL (trimmed+normalized) then ORIGINAL for provenance.
    const asset =
      item.assets.find((a) => a.kind === 'FINAL' && a.localPath) ??
      item.assets.find((a) => a.kind === 'ORIGINAL' && a.localPath);

    const durationSec =
      typeof item.sourceVideo?.durationSec === 'number' ? item.sourceVideo.durationSec : null;

    if (asset?.localPath) {
      try {
        const s = await stat(asset.localPath);
        const apiKey = await peekGeminiApiKey(async () =>
          (await keyStore.listByProvider('gemini')).map((k) => ({
            secret: k.secret,
            status: k.status,
          })),
        );
        media = await prepareAnalysisMedia({
          videoPath: asset.localPath,
          sizeBytes: s.size,
          durationSec,
          apiKey,
          contentItemId,
        });
        if (media.mode === 'metadata_only' || media.mode === 'frames') {
          await raiseIncident(prisma, {
            kind: 'SYSTEM',
            severity: 'LOW',
            contentItemId,
            title:
              media.mode === 'frames'
                ? `AI analyze: using ${media.detail?.frameCount ?? '?'} timeline frame samples (full-file upload unavailable)`
                : `AI analyze: video ${s.size} bytes — analyzing metadata only`,
            detail: media.detail ?? { assetPath: asset.localPath, sizeBytes: s.size },
          });
        }
      } catch (err) {
        await raiseIncident(prisma, {
          kind: 'SYSTEM',
          severity: 'LOW',
          contentItemId,
          title: `AI analyze: could not read video for multimodal upload — falling back to metadata`,
          detail: { error: err instanceof Error ? err.message : String(err) },
        });
        media = {
          mode: 'metadata_only',
          parts: [],
          cleanup: async () => {},
        };
      }
    }

    inputText = JSON.stringify({
      title: item.title,
      sourceUrl: item.sourceVideo?.sourceUrl,
      uploaderName: item.sourceVideo?.uploaderName,
      durationSec,
      mediaMode: media?.mode ?? 'metadata_only',
      instruction:
        'Analyze the full video timeline. Return beat-by-beat segments covering start→end. Prefer the attached video/frames over metadata.',
    });

    if (media && media.parts.length > 0) {
      runInput = {
        kind: 'multimodal',
        parts: [{ text: inputText }, ...media.parts],
      };
    } else {
      runInput = { kind: 'text', text: inputText };
    }
  } else if (kind === 'narration') {
    inputText = JSON.stringify({
      title: item.title,
      durationSec: item.sourceVideo?.durationSec ?? null,
      analysis: currentStep.analysis ?? item.title,
      instruction:
        'Write a hooky storytelling narration script timed to the analysis segments and video length. Output JSON with script + hook.',
    });
    runInput = { kind: 'text', text: inputText };
  } else {
    // metadata — platform shapes title/description/tags for the SocialAccount.
    inputText = JSON.stringify({
      title: item.title,
      platform: platform ?? 'UNKNOWN',
      script: currentStep.script ?? item.title,
      analysis: currentStep.analysis ?? null,
      // Present when the owner clicks Regenerate — busts the AI response cache.
      ...(currentStep.metadataNonce != null
        ? { regenerateNonce: currentStep.metadataNonce }
        : {}),
      instruction:
        'Write publish-ready title, description, and tags optimized for the given platform. Follow channel style. Return JSON only.',
    });
    runInput = { kind: 'text', text: inputText };
  }

  const cacheKey = cacheKeyFor({
    task: spec.task as any,
    model: DEFAULT_GEMINI_TEXT_MODEL,
    promptVersion,
    styleVersion: styleVersionFromProfile(channelStyle),
    // Attach the video's md5 to the cache key so the same clip re-uses its
    // analysis but a different clip does not collide. Include media mode so
    // a later full-file analyze does not collide with an older frames-only run.
    inputContentHash: hashText(
      inputText + (item.sourceVideo?.md5 ?? '') + (media?.mode ?? kind),
    ),
  });

  const schema = schemaForRepurposeTask(spec.task);

  try {
    const result: AIResult = await router.run({
      task: spec.task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: runInput,
      ...(schema ? { schema } : {}),
      cacheKey,
      contentItemId,
      ...(kind === 'analyze' || kind === 'narration' ? { maxTokens: 8192 } : {}),
    });

    const updatedStep = { ...currentStep };

    if (kind === 'analyze') {
      updatedStep.analysis = result.output;
      updatedStep.analysisMediaMode = media?.mode ?? 'metadata_only';
      await prisma.contentItem.update({
        where: { id: contentItemId },
        data: { currentStep: updatedStep as any },
      });
      await boss.send(QUEUE.AI, { kind: 'narration', contentItemId } as AiJob, {
        singletonKey: `narration-${contentItemId}`,
      });
      // eslint-disable-next-line no-console
      console.log(
        `[worker:ai] analyze done for ${contentItemId} (media=${media?.mode ?? 'none'}) — enqueued narration`,
      );
    } else if (kind === 'narration') {
      // Persist plain TTS-ready script; keep structured output for review UI.
      const scriptText = extractNarrationScript(result.output);
      updatedStep.script = scriptText;
      updatedStep.narration = result.output;
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
      // Chain A/B suggestions (Phase 7 #10) — non-blocking, uses cached input.
      await boss.send(QUEUE.AI, { kind: 'ab_suggestions', contentItemId }, {
        singletonKey: `ab-${contentItemId}`,
      });
      // eslint-disable-next-line no-console
      console.log(`[worker:ai] metadata done for ${contentItemId} — enqueued A/B suggestions`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[worker:ai] ${kind} failed for ${contentItemId}:`, errMsg);

    // Transient upstream failures (Gemini 503 "high demand", rate limits, quota
    // resets) shouldn't burn the item's slot in FAILED — pg-boss will re-queue
    // this job with exponential backoff, and the analyze step will re-run against
    // whichever key/model recovers first. Only permanent failures kill the item.
    const isTransient =
      err instanceof AllProvidersExhaustedError && err.allTransient;
    if (isTransient) {
      // Keep the item where it is (ANALYZING/etc.); throw so pg-boss retries.
      // eslint-disable-next-line no-console
      console.warn(
        `[worker:ai] ${kind} transient failure for ${contentItemId} — letting pg-boss retry`,
      );
      throw err;
    }

    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'FAILED' },
    });

    const incidentKind = err instanceof AllProvidersExhaustedError ? 'RATE_LIMIT' as const : 'SYSTEM' as const;
    // AllProvidersExhaustedError's message is only a summary ("tried gemini") —
    // the real per-provider reasons live on `.attempts`. Record them or the
    // incident is undiagnosable.
    const attempts =
      err instanceof AllProvidersExhaustedError ? err.attempts : undefined;
    if (attempts?.length) {
      // eslint-disable-next-line no-console
      console.error(`[worker:ai] provider attempts:`, JSON.stringify(attempts));
    }
    await raiseIncident(prisma, {
      kind: incidentKind,
      contentItemId,
      title: `AI ${kind} failed: ${errMsg.slice(0, 200)}`,
      detail: { error: errMsg, task: spec.task, ...(attempts ? { attempts } : {}) },
    });
  } finally {
    if (media) {
      await media.cleanup().catch(() => undefined);
    }
  }
}
