/**
 * Phase 4 AI processors (docs/01 FR-D2–D4, FR-E2–E3). Four functions that
 * follow the same pattern as ai-process.ts: build stores → check kill switch →
 * load prompt → route through AIRouter → store result → advance state machine.
 *
 * Graceful degradation: absent MASTER_KEY or exhausted providers → incident,
 * entity transitions to FAILED, never crash.
 */
import type PgBoss from 'pg-boss';
import {
  TaskType,
  QUEUE,
  styleVersionFromProfile,
  withChannelStyle,
  formatOurChannelAboutBlock,
  presentationNeedsVoiceover,
  parseStyleProfile,
  buildChannelPerformanceMemory,
  fingerprintVideos,
  formatChannelPerformanceForPrompt,
  parseChannelPerformanceMemory,
  formatThumbnailPromptInstructions,
  formatSceneVisualPromptRulesWithChannel,
  formatDramaDialoguePackageRules,
  formatCharacterReference,
  expandCharacterReferencesInText,
  embedNegativeGuidanceInPrompt,
  isDramaOrDialoguePackage,
  isDocumentaryIdeaGeneration,
  isDocumentaryVoiceoverPackage,
  isNarrationVoiceoverPackage,
  languageDisplayName,
  formatOutputLanguagePolicy,
  DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT,
  DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT,
  DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT,
  DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT,
  DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT,
  documentaryBeatSceneCount,
  ensureDocumentaryCollageImagePrompt,
  ensureDocumentaryThumbnailPrompt,
  ensureDocumentaryUniversalVideoPrompt,
  formatDocumentaryCollageVisualRules,
  formatDocumentaryIdeaRules,
  formatDocumentaryThumbnailInstructions,
  formatFernNarrationRules,
  joinProductionBriefEditingExtras,
  splitProductionBriefEditingExtras,
  needsEnglishVoiceoverSummary,
  type AiPerformanceInsights,
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
  EdgeTtsProvider,
  cacheKeyFor,
  hashText,
  AllProvidersExhaustedError,
  DEFAULT_GEMINI_TEXT_MODEL,
  segmentsToSrt,
  segmentsToVtt,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type KeyStore,
  type KeyState,
  type AIProvider,
  type AIResult,
  type TimedSegment,
} from '@scp/ai-providers';
import { z } from 'zod';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { getPrisma, raiseIncident, type PrismaClient } from './publish-support.js';
import type { IdeaTtsJob, IdeaVisualsJob } from './ai-jobs.js';
import { summarizeVoiceoverInEnglish } from './english-voiceover-summary.js';

// ── Shared infra (same as ai-process.ts) ───────────────────────────────────

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
  providers.set('edge', new EdgeTtsProvider());
  providers.set('whisper', new WhisperProvider());

  const chains: Record<string, string[]> = {
    IDEA_GENERATION: ['gemini'],
    BRIEF_GENERATION: ['gemini'],
    DRAMA_BIBLE: ['gemini'],
    DRAMA_EPISODE: ['gemini'],
    TTS: ['edge', 'kokoro', 'gemini', 'openai'],
  };

  return {
    get: (id: string) => providers.get(id),
    chainFor: (task) => chains[task as string] ?? ['gemini'],
  };
}

async function checkKillSwitch(prisma: PrismaClient, task: string): Promise<string | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'killSwitches' } });
  const ks = (row?.value ?? {}) as Record<string, boolean>;
  if (ks['ai.global']) return 'AI is globally disabled';
  if (ks[`ai.task.${task}`]) return `AI task "${task}" is disabled`;
  return null;
}

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

function buildRouter(prisma: PrismaClient, masterKey: Buffer) {
  return new AIRouter({
    cache: buildCacheStore(prisma),
    logger: buildUsageLogger(prisma),
    keyPool: new KeyPool(buildKeyStore(prisma, masterKey)),
    registry: buildRegistry(),
  });
}

function loadMasterKeyOrNull(): Buffer | null {
  const raw = process.env.MASTER_KEY;
  return raw ? loadMasterKey(raw) : null;
}

async function loadChannelStyle(
  prisma: PrismaClient,
  accountId: string | null | undefined,
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

// ── Model output parsing ───────────────────────────────────────────────────

/**
 * Gemini returns prose-wrapped JSON unless `responseMimeType` is set, so raw
 * `JSON.parse` throws on the ```json fence it emits by default. Strip the fence,
 * then fall back to the outermost {...} / [...] span before giving up.
 */
export function parseAiJson(output: unknown): unknown {
  if (output && typeof output === 'object') return output;
  const text = String(output ?? '').trim();
  if (!text) return null;

  const fenced = text.match(/^```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n?```\s*$/);
  const unfenced = (fenced?.[1] ?? text).trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    /* fall through to span extraction */
  }

  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    const start = unfenced.indexOf(open);
    const end = unfenced.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1));
      } catch {
        /* try next shape */
      }
    }
  }
  return null;
}

/** Same as parseAiJson but always yields an object for field lookups. */
function parseAiJsonObject(output: unknown): Record<string, unknown> | null {
  const parsed = parseAiJson(output);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

// ── Idea generation (FR-D2) ────────────────────────────────────────────────

export const IDEA_TITLE_TARGET_MIN = 50;
export const IDEA_TITLE_TARGET_MAX = 60;
/** Soft persist window — target remains 50–60, but Gemini often drifts. */
export const IDEA_TITLE_ACCEPTED_MIN = 40;
export const IDEA_TITLE_ACCEPTED_MAX = 75;

/** Normalize model formatting without changing the title's wording. */
export function normalizeIdeaTitle(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ideaTitleLength(title: string): number {
  return Array.from(title).length;
}

export function isAcceptableIdeaTitle(title: string): boolean {
  const length = ideaTitleLength(normalizeIdeaTitle(title));
  return length >= IDEA_TITLE_ACCEPTED_MIN && length <= IDEA_TITLE_ACCEPTED_MAX;
}

/**
 * Fit a title into the accepted length window without failing the whole batch.
 * Too long → truncate at a word boundary. Too short → append hook/angle when helpful.
 */
export function fitIdeaTitleLength(
  title: string,
  extras: { hook?: string; angle?: string } = {},
): string {
  let fitted = normalizeIdeaTitle(title);
  let length = ideaTitleLength(fitted);
  if (length >= IDEA_TITLE_ACCEPTED_MIN && length <= IDEA_TITLE_ACCEPTED_MAX) {
    return fitted;
  }

  if (length > IDEA_TITLE_ACCEPTED_MAX) {
    const chars = Array.from(fitted);
    let cut = chars.slice(0, IDEA_TITLE_ACCEPTED_MAX).join('');
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace >= IDEA_TITLE_ACCEPTED_MIN) {
      cut = cut.slice(0, lastSpace);
    }
    return normalizeIdeaTitle(cut.replace(/[:\-—,.;!?]+$/u, ''));
  }

  const fillers = [extras.hook, extras.angle]
    .map((value) => normalizeIdeaTitle(value ?? ''))
    .filter(
      (value) =>
        value.length > 0 && value.toLowerCase() !== fitted.toLowerCase(),
    );

  for (const filler of fillers) {
    const joined = normalizeIdeaTitle(`${fitted}: ${filler}`);
    const joinedLen = ideaTitleLength(joined);
    if (joinedLen <= IDEA_TITLE_ACCEPTED_MAX) {
      fitted = joined;
      length = joinedLen;
      if (length >= IDEA_TITLE_ACCEPTED_MIN) return fitted;
      continue;
    }

    const room = IDEA_TITLE_ACCEPTED_MAX - ideaTitleLength(fitted) - 2;
    if (room < 8) continue;
    const part = Array.from(filler).slice(0, room).join('');
    const space = part.lastIndexOf(' ');
    const trimmed = space >= 4 ? part.slice(0, space) : part;
    const candidate = normalizeIdeaTitle(`${fitted}: ${trimmed}`);
    if (isAcceptableIdeaTitle(candidate)) return candidate;
  }

  return fitted;
}

function conciseProviderError(error: string): string {
  try {
    const parsed = JSON.parse(error) as Array<{ message?: unknown }>;
    if (Array.isArray(parsed)) {
      const messages = parsed
        .map((entry) => (typeof entry?.message === 'string' ? entry.message : ''))
        .filter(Boolean);
      if (messages.length > 0) return messages.join(', ');
    }
  } catch {
    // Provider errors are usually plain text; use them as-is.
  }
  return error;
}

export function ideaGenerationSchema(maxIdeas: number) {
  // Length is enforced after parse via fitIdeaTitleLength — putting a hard
  // 48–62 refine here caused Gemini to reject the entire batch when a few
  // titles drifted outside the window.
  const titleSchema = z
    .string()
    .transform(normalizeIdeaTitle)
    .refine((title) => title.length > 0, {
      message: 'Title is required',
    })
    .refine((title) => !/^(```|[[{])/.test(title), {
      message: 'Title must be plain text, not JSON or a markdown code fence',
    });

  const ideasSchema = z
    .array(
      z.object({
        title: titleSchema,
        angle: z.string(),
        hook: z.string(),
        rationale: z.string(),
        category: z.enum(['RELEVANT', 'SIMILAR', 'UNIQUE']),
        viralScore: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(maxIdeas);

  // Models occasionally return 51–52 entries when asked for 50. Keep the
  // requested prefix before validation instead of rejecting the whole useful
  // response; the worker also slices once more before persistence.
  return z.preprocess(
    (value) => (Array.isArray(value) ? value.slice(0, maxIdeas) : value),
    ideasSchema,
  );
}

/** Pull a clean title (and nested fields) when the model stringifies the whole idea. */
export function normalizeGeneratedIdea(raw: unknown): {
  title: string;
  angle: string;
  hook: string;
  rationale: string;
  category?: string;
  viralScore?: number;
} {
  let obj: Record<string, unknown> =
    raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : { title: String(raw ?? '') };

  // Title sometimes contains the entire JSON blob (optionally fenced).
  if (typeof obj.title === 'string' && /^(```|[[{])/.test(obj.title.trim())) {
    const nested = parseAiJson(obj.title);
    const first = Array.isArray(nested) ? nested[0] : nested;
    if (first && typeof first === 'object') {
      const nestedObj = first as Record<string, unknown>;
      obj = { ...nestedObj, ...obj, title: nestedObj.title ?? obj.title };
    }
  }

  const titleRaw = obj.title;
  let title =
    typeof titleRaw === 'string'
      ? normalizeIdeaTitle(titleRaw)
      : titleRaw != null
        ? normalizeIdeaTitle(titleRaw)
        : '';
  // Last-resort: recover the title field from any JSON-ish leftovers.
  if (/^(```|[[{])/.test(title)) {
    const nested = parseAiJson(title);
    const first = Array.isArray(nested) ? nested[0] : nested;
    const nestedTitle = (first as { title?: unknown } | null)?.title;
    if (typeof nestedTitle === 'string' && nestedTitle.trim()) {
      title = normalizeIdeaTitle(nestedTitle);
    } else {
      const match = title.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      if (match?.[1]) title = normalizeIdeaTitle(match[1].replace(/\\"/g, '"'));
    }
  }

  const viralRaw = obj.viralScore ?? obj.predictedScore ?? obj.score;
  let viralScore: number | undefined;
  if (typeof viralRaw === 'number' && Number.isFinite(viralRaw)) {
    viralScore = Math.max(0, Math.min(100, Math.round(viralRaw)));
  } else if (typeof viralRaw === 'string' && viralRaw.trim() !== '') {
    const n = Number(viralRaw);
    if (Number.isFinite(n)) viralScore = Math.max(0, Math.min(100, Math.round(n)));
  }

  return {
    title: title || 'Untitled Idea',
    angle: typeof obj.angle === 'string' ? obj.angle : '',
    hook: typeof obj.hook === 'string' ? obj.hook : '',
    rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
    category: typeof obj.category === 'string' ? obj.category : undefined,
    viralScore,
  };
}

export async function runIdeaGeneration(
  accountId: string,
  _boss: PgBoss,
  count = 50,
  generationRunId?: string,
  topicSeed?: string,
): Promise<void> {
  const prisma = getPrisma();
  const task = TaskType.IDEA_GENERATION;
  const targetCount = Math.max(1, Math.min(50, Math.round(count) || 50));
  const seed = topicSeed?.trim() || undefined;
  const updateRun = async (
    status: 'ACTIVE' | 'COMPLETED' | 'FAILED',
    error?: string,
  ): Promise<void> => {
    if (!generationRunId) return;
    await prisma.jobRun.updateMany({
      where: { id: generationRunId },
      data: {
        status,
        ...(status === 'ACTIVE' ? { startedAt: new Date() } : { finishedAt: new Date() }),
        ...(error ? { error: { message: error } } : {}),
      },
    });
  };
  await updateRun('ACTIVE');

  const killed = await checkKillSwitch(prisma, task);
  if (killed) {
    console.warn(`[worker:ai-p4] ${killed} — skipping idea generation for account ${accountId}`);
    await updateRun('FAILED', killed);
    return;
  }

  const masterKey = loadMasterKeyOrNull();
  if (!masterKey) {
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      title: `Idea generation skipped: MASTER_KEY not configured`,
      detail: { accountId },
    });
    await updateRun(
      'FAILED',
      'Idea generation is unavailable because MASTER_KEY is not configured.',
    );
    return;
  }

  const recentVideos = await prisma.competitorVideo.findMany({
    where: { competitorChannel: { ownAccountId: accountId, deletedAt: null } },
    orderBy: { fetchedAt: 'desc' },
    take: 30,
    select: {
      videoId: true,
      title: true,
      views: true,
      transcript: true,
      durationSec: true,
      competitorChannel: { select: { name: true } },
    },
  });

  const [refChannels, account] = await Promise.all([
    prisma.competitorChannel.findMany({
      where: { ownAccountId: accountId, deletedAt: null },
      select: { name: true, performanceMemory: true },
    }),
    prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { name: true, handle: true },
    }),
  ]);
  const channelMemoryBlocks = refChannels
    .map((ch) =>
      formatChannelPerformanceForPrompt(
        ch.name,
        parseChannelPerformanceMemory(ch.performanceMemory),
      ),
    )
    .filter(Boolean);

  const rejectedIdeas = await prisma.idea.findMany({
    where: { accountId, status: 'REJECTED', deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { title: true, rejectionReason: true },
  });

  const channelStyle = await loadChannelStyle(prisma, accountId);
  const documentaryIdeas = isDocumentaryIdeaGeneration(channelStyle?.styleProfile);
  const prompt = await getActivePrompt(prisma, task, 'default', accountId);
  const styleAnswers = parseStyleProfile(channelStyle?.styleProfile).answers;
  const ourChannelBlock = formatOurChannelAboutBlock(channelStyle, account?.name);
  const seedBlock = seed
    ? `\n\n---\nOwner topic seed (REQUIRED inspiration):\n"${seed}"
- Generate ideas inspired by and expanding on this seed topic — not unrelated tangents.
- Do NOT use the seed text itself (or a trivial rephrase) as any title; invent original, catchy titles.
- Still match competitor-channel headline FORMAT, pacing, and specificity when references are present.
- Categories RELEVANT / SIMILAR / UNIQUE are relative to this seed plus OUR channel niche and reference-channel patterns.
- Honor OUR channel about/niche and performance memory when choosing angles and hooks.`
    : '';
  const ideaOutputContract = `Return a JSON array of up to ${targetCount} ideas, each with {title, angle, hook, rationale, category, viralScore}.
- Every title SHOULD target ${IDEA_TITLE_TARGET_MIN}-${IDEA_TITLE_TARGET_MAX} characters INCLUDING spaces (aim for catchy clickbait length). Stay within ${IDEA_TITLE_ACCEPTED_MIN}-${IDEA_TITLE_ACCEPTED_MAX} characters.
- Make every title compelling, specific, and curiosity-driven/clickable while remaining natural language. Avoid vague, generic, sensational, repetitive, or spammy nonsense.
- Stay on OUR CHANNEL niche, audience, and brand. Use REFERENCE CHANNELS only for headline FORMAT, pacing, hooks, and proven topic shapes.
- Match the same headline FORMAT used by the strongest competitor-channel titles: mirror their structure (question, reveal, mystery, list/number, engineering/history breakdown, etc.), pacing, and specificity.
- Derive FRESH ORIGINAL ideas inspired by patterns — never copy or lightly rephrase reference titles.
- title MUST be a plain-text string only (never stringify the whole object into title).
- category MUST be exactly one of: RELEVANT, SIMILAR, UNIQUE.
- viralScore is REQUIRED and MUST be an integer from 0 through 100.
- viralScore MUST evaluate the complete idea. Title quality contributes 30/100 points: specificity (10), curiosity/click appeal (10), and channel/reference fit plus natural wording (10). Weak or generic titles cannot receive a high score.
- Return JSON only. Do not use markdown code fences.
- Never use em dashes (—) in titles or any other field. Use commas, colons, parentheses, or plain hyphens instead.
- Write every idea title, angle, hook, and rationale in English. Do not translate ideas into the channel audience language.`;
  const documentaryIdeaRules = documentaryIdeas ? `\n${formatDocumentaryIdeaRules()}` : '';
  const refChannelNames = refChannels.map((ch) => ch.name).filter(Boolean);
  const referenceBlock = [
    refChannelNames.length > 0
      ? `---\nREFERENCE CHANNELS (inspiration only — invent original on-niche ideas for OUR channel, never copy titles):\nTracked: ${refChannelNames.join(', ')}`
      : '',
    channelMemoryBlocks.length > 0 ? channelMemoryBlocks.join('\n\n') : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const systemPrompt = withChannelStyle(
    `${prompt?.template ?? 'You are a content strategist. Generate original video content ideas for OUR channel, using reference-channel analysis for patterns only.'}

${ideaOutputContract}
${documentaryIdeaRules}
Aim for a mix across the three categories. Every idea must fit OUR CHANNEL about/niche/brand; use reference channels for format and performance patterns only.${seedBlock}${ourChannelBlock ? `\n\n${ourChannelBlock}` : ''}${referenceBlock ? `\n\n${referenceBlock}` : ''}`,
    channelStyle,
  );
  const promptVersion = prompt?.version ?? 1;

  const inputText = JSON.stringify({
    count: targetCount,
    ...(seed ? { topicSeed: seed } : {}),
    ourChannel: {
      name: account?.name,
      handle: account?.handle,
      language: channelStyle?.language,
      niche: styleAnswers.niche || undefined,
      nicheTags: styleAnswers.nicheTags.length ? styleAnswers.nicheTags : undefined,
      audience: styleAnswers.audience || undefined,
      formats: styleAnswers.formats.length ? styleAnswers.formats : undefined,
      presentation: styleAnswers.presentation || undefined,
      avoid: styleAnswers.avoid || undefined,
      extraNotes: styleAnswers.extraNotes || undefined,
    },
    referenceChannels: refChannels.map((ch) => ch.name),
    competitorVideos: recentVideos.map((v) => ({
      channel: v.competitorChannel.name,
      title: v.title,
      views: v.views.toString(),
      transcript: v.transcript?.slice(0, 500),
      durationSec: v.durationSec,
    })),
    rejectedIdeas: rejectedIdeas.map((i) => ({
      title: i.title,
      reason: i.rejectionReason,
    })),
    channelPerformanceMemory: channelMemoryBlocks,
    documentaryCollage: documentaryIdeas,
  });

  const cacheKey = cacheKeyFor({
    task: task as any,
    model: DEFAULT_GEMINI_TEXT_MODEL,
    promptVersion,
    styleVersion: styleVersionFromProfile(channelStyle),
    // Contract marker busts caches that used the old hard length-refine schema.
    inputContentHash: hashText(
      `idea-title-contract-v6:${documentaryIdeas ? 'doc' : 'std'}:${inputText}`,
    ),
  });

  const router = buildRouter(prisma, masterKey);

  try {
    const result: AIResult = await router.run({
      task: task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: {
        kind: 'text',
        text: seed
          ? `${inputText}\n\nUsing OUR CHANNEL about/niche plus the owner topic seed above, and reference channels for patterns only, generate exactly ${targetCount} distinct ideas as a JSON array.`
          : `${inputText}\n\nUsing OUR CHANNEL about/niche as the topic ground truth and reference channels for patterns only, generate exactly ${targetCount} distinct ideas as a JSON array.`,
      },
      // Schema validates structure only; title length is fitted after parse so
      // a few off-target titles cannot fail the entire generation.
      schema: ideaGenerationSchema(targetCount),
      cacheKey,
    });

    const parsed = parseAiJson(result.output);
    let rawIdeas: unknown[];
    if (Array.isArray(parsed)) {
      rawIdeas = parsed;
    } else if (
      parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { ideas?: unknown }).ideas)
    ) {
      rawIdeas = (parsed as { ideas: unknown[] }).ideas;
    } else if (parsed && typeof parsed === 'object') {
      rawIdeas = [parsed];
    } else {
      // Unparseable model output is a generation failure, not an idea — storing
      // the raw blob as a title is what produced the JSON-looking cards.
      throw new Error(
        `Idea generation returned unparseable output: ${String(result.output).slice(0, 200)}`,
      );
    }

    const sourceVideoIds = recentVideos.slice(0, 5).map((v) => v.videoId);
    const validCategories = new Set(['RELEVANT', 'SIMILAR', 'UNIQUE']);
    const ideas = rawIdeas
      .map(normalizeGeneratedIdea)
      .map((idea) => ({
        ...idea,
        title: fitIdeaTitleLength(idea.title, {
          hook: idea.hook,
          angle: idea.angle,
        }),
      }))
      .filter(
        (idea): idea is ReturnType<typeof normalizeGeneratedIdea> & { viralScore: number } =>
          idea.viralScore != null &&
          isAcceptableIdeaTitle(idea.title) &&
          !/^(```|[[{])/.test(idea.title),
      )
      .slice(0, targetCount);
    if (ideas.length === 0) {
      throw new Error('Idea generation returned no valid ideas with a title and viralScore');
    }

    for (const idea of ideas) {
      const rawCat = (idea.category ?? '').toString().toUpperCase();
      const category = validCategories.has(rawCat)
        ? (rawCat as 'RELEVANT' | 'SIMILAR' | 'UNIQUE')
        : 'SIMILAR';
      await prisma.idea.create({
        data: {
          accountId,
          title: idea.title,
          angle: idea.angle,
          hook: idea.hook,
          rationale: idea.rationale,
          category,
          viralScore: idea.viralScore,
          sourceCompetitorVideoIds: sourceVideoIds,
          status: 'SUGGESTED',
          packageStatus: 'NONE',
        },
      });
    }

    console.log(
      `[worker:ai-p4] idea generation done for account ${accountId} — created ${ideas.length} idea(s) (requested ${targetCount})`,
    );
    await updateRun('COMPLETED');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const attemptDetails =
      err instanceof AllProvidersExhaustedError
        ? err.attempts
            .map((attempt) => `${attempt.providerId}: ${conciseProviderError(attempt.error)}`)
            .join('; ')
        : '';
    const readableError = attemptDetails
      ? `Idea generation could not complete. ${attemptDetails}`
      : errMsg;
    console.error(`[worker:ai-p4] idea generation failed for account ${accountId}:`, readableError);

    const incidentKind =
      err instanceof AllProvidersExhaustedError ? ('RATE_LIMIT' as const) : ('SYSTEM' as const);
    await raiseIncident(prisma, {
      kind: incidentKind,
      accountId,
      title: `Idea generation failed: ${errMsg.slice(0, 200)}`,
      detail: {
        accountId,
        error: readableError,
        ...(err instanceof AllProvidersExhaustedError ? { attempts: err.attempts } : {}),
      },
    });
    await updateRun('FAILED', readableError);
  }
}

// ── Brief generation (FR-D4) ──────────────────────────────────────────────

const dialogueLineSchema = z.object({
  speaker: z.string(),
  line: z.string(),
});

const characterPromptSchema = z.object({
  name: z.string(),
  appearance: z.string(),
  wardrobe: z.string(),
  age: z.string(),
  personality: z.string(),
  consistencyDetails: z.string(),
});

export const productionBriefOutputSchema = z.object({
  videoTitle: z.string(),
  videoDescription: z.string(),
  storySummary: z.string(),
  thumbnailPrompt: z.string(),
  thumbnailNegativePrompt: z.string().optional(),
  thumbnailPromptVariants: z.array(z.string()).optional(),
  narrationScript: z.string(),
  sceneBreakdown: z.array(
    z.object({
      sceneIndex: z.number().int().positive(),
      durationSec: z.number().positive(),
      imagePrompt: z.string(),
      animationPrompt: z.string(),
      negativePrompt: z.string().optional(),
      animationNegativePrompt: z.string().optional(),
      videoNegativePrompt: z.string().optional(),
      dialogue: z.union([z.string(), z.array(dialogueLineSchema)]),
    }),
  ),
  characters: z.array(characterPromptSchema),
  editingInstructions: z.string(),
  targetDurationSec: z.number().positive(),
});

export type PackagePresentation = 'voiceover' | 'dialogue' | 'mixed' | 'other';

function normalizedPresentation(value: unknown): PackagePresentation {
  return value === 'voiceover' || value === 'dialogue' || value === 'mixed' ? value : 'other';
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeDialogue(value: unknown): Array<{ speaker: string; line: string }> {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
        return {
          speaker: text(row.speaker ?? row.character ?? row.name),
          line: text(row.line ?? row.text),
        };
      })
      .filter((line) => line.line);
  }
  const raw = text(value);
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*([^:]{1,60}):\s*(.+)$/);
      return match
        ? { speaker: (match[1] ?? '').trim(), line: (match[2] ?? '').trim() }
        : { speaker: '', line };
    })
    .filter((line) => line.line);
}

function dialogueBlock(
  lines: Array<{ speaker: string; line: string }>,
  characters?: Array<{
    name: string;
    appearance: string;
    wardrobe: string;
    age: string;
    consistencyDetails: string;
  }>,
  expandSpeakers = false,
): string {
  return lines
    .map((line) => {
      const speaker = line.speaker || 'Speaker';
      if (!expandSpeakers || !characters?.length) return `${speaker}: ${line.line}`;
      const match = characters.find(
        (character) => character.name.toLowerCase() === speaker.toLowerCase(),
      );
      const label = match ? formatCharacterReference(match) : speaker;
      return `${label}: ${line.line}`;
    })
    .join('\n');
}

function ensureUltraRealistic(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return trimmed;
  return /\bultra\s+realistic\b/i.test(trimmed) ? trimmed : `${trimmed}, ultra realistic`;
}

/** Normalize both the current contract and legacy creative-package payloads. */
export function normalizeProductionBriefOutput(
  output: unknown,
  options: {
    presentation: PackagePresentation;
    clipDurationSec: number;
    videoDurationSec: number;
    fallbackTitle: string;
    dramaOrDialogue?: boolean;
    documentaryCollage?: boolean;
    narrationVoiceover?: boolean;
  },
) {
  const brief = (output && typeof output === 'object' ? output : {}) as Record<string, unknown>;
  const drama = options.dramaOrDialogue === true;
  const documentary = options.documentaryCollage === true;
  const narrationVoiceover =
    options.narrationVoiceover === true ||
    (!drama && (options.presentation === 'voiceover' || documentary));
  const sharedNegative = text(
    brief.sharedNegativePrompt ?? brief.negativePrompt ?? brief.thumbnailNegativePrompt,
  );
  const rawCharacters = Array.isArray(brief.characters)
    ? brief.characters
    : Array.isArray(brief.characterPrompts)
      ? brief.characterPrompts
      : [];
  const characters = rawCharacters
    .map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          name: `Character ${index + 1}`,
          appearance: entry.trim(),
          wardrobe: '',
          age: '',
          personality: '',
          consistencyDetails: entry.trim(),
        };
      }
      const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        name: text(row.name ?? row.characterName) || `Character ${index + 1}`,
        appearance: text(row.appearance ?? row.visualDescription ?? row.description),
        wardrobe: text(row.wardrobe ?? row.clothing),
        age: text(row.age ?? row.ageRange),
        personality: text(row.personality),
        consistencyDetails: text(
          row.consistencyDetails ?? row.consistency ?? row.generationPrompt ?? row.prompt,
        ),
      };
    })
    .filter((character) =>
      Boolean(character.appearance || character.consistencyDetails || character.wardrobe),
    );

  const rawScenes = Array.isArray(brief.sceneBreakdown)
    ? brief.sceneBreakdown
    : Array.isArray(brief.scenes)
      ? brief.scenes
      : [];
  const scenes = rawScenes.map((entry, index) => {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const dialogue = normalizeDialogue(row.dialogue ?? row.dialogues ?? row.lines ?? row.narration);
    let imagePrompt = text(row.imagePrompt ?? row.image);
    let animationPrompt = text(row.animationPrompt ?? row.videoPrompt ?? row.motionPrompt);
    const renderedDialogue = dialogueBlock(dialogue, characters, drama);
    if (
      renderedDialogue &&
      (options.presentation === 'dialogue' || options.presentation === 'mixed') &&
      !animationPrompt.includes(renderedDialogue) &&
      !dialogue.every((line) => animationPrompt.includes(line.line))
    ) {
      animationPrompt = `${animationPrompt}${animationPrompt ? '\n\n' : ''}Dialogue:\n${renderedDialogue}`;
    }
    if (drama && characters.length) {
      imagePrompt = expandCharacterReferencesInText(imagePrompt, characters);
      animationPrompt = expandCharacterReferencesInText(animationPrompt, characters);
      imagePrompt = ensureUltraRealistic(imagePrompt);
      animationPrompt = ensureUltraRealistic(animationPrompt);
    }
    if (documentary) {
      if (imagePrompt) imagePrompt = ensureDocumentaryCollageImagePrompt(imagePrompt);
      animationPrompt = ensureDocumentaryUniversalVideoPrompt(animationPrompt);
    }
    const negativePrompt =
      text(row.negativePrompt ?? row.negative) ||
      (drama
        ? sharedNegative || DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT
        : narrationVoiceover
          ? sharedNegative || DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT
          : sharedNegative);
    const animationNegativePrompt =
      text(
        row.animationNegativePrompt ??
          row.videoNegativePrompt ??
          row.animationNegative ??
          row.videoNegative,
      ) ||
      (drama
        ? DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT
        : narrationVoiceover
          ? DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT
          : negativePrompt);
    // Bake distinct negatives into copy-paste prompts (image vs video).
    if (negativePrompt) {
      imagePrompt = embedNegativeGuidanceInPrompt(imagePrompt, negativePrompt);
    }
    // Documentary animation uses a fixed universal prompt (already includes audio + no-dialogue).
    if (!documentary && animationNegativePrompt) {
      animationPrompt = embedNegativeGuidanceInPrompt(animationPrompt, animationNegativePrompt);
    }
    return {
      sceneIndex:
        typeof row.sceneIndex === 'number' && Number.isFinite(row.sceneIndex)
          ? Math.max(1, Math.round(row.sceneIndex))
          : index + 1,
      durationSec:
        typeof row.durationSec === 'number' && row.durationSec > 0
          ? row.durationSec
          : documentary
            ? Math.min(options.clipDurationSec, 3)
            : options.clipDurationSec,
      imagePrompt,
      animationPrompt,
      negativePrompt,
      animationNegativePrompt,
      dialogue,
    };
  });

  const canNarrate = options.presentation === 'voiceover' || options.presentation === 'mixed';
  let narrationScript = canNarrate
    ? text(brief.narrationScript ?? brief.voiceoverNarration ?? brief.script)
    : '';
  if (documentary && narrationScript) {
    narrationScript = narrationScript.replace(/\u2014/g, '-');
  }

  let thumbnailPrompt = text(brief.thumbnailPrompt);
  if (drama && thumbnailPrompt) {
    if (characters.length) {
      thumbnailPrompt = expandCharacterReferencesInText(thumbnailPrompt, characters);
    }
    thumbnailPrompt = ensureUltraRealistic(thumbnailPrompt);
  }
  if (documentary && thumbnailPrompt) {
    thumbnailPrompt = ensureDocumentaryThumbnailPrompt(thumbnailPrompt);
  }
  const thumbnailNegativePrompt =
    text(brief.thumbnailNegativePrompt) ||
    (drama ? sharedNegative || DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT : '');

  const rawVariants = brief.thumbnailPromptVariants ?? brief.thumbnailVariants;
  const thumbnailPromptVariants = Array.isArray(rawVariants)
    ? rawVariants
        .map((entry) => ensureDocumentaryThumbnailPrompt(text(entry)))
        .filter(Boolean)
        .join('\n\n')
    : text(rawVariants);

  return {
    videoTitle: text(brief.videoTitle) || options.fallbackTitle,
    videoDescription: text(brief.videoDescription ?? brief.description),
    storySummary: text(brief.storySummary ?? brief.researchSummary ?? brief.conceptSummary),
    thumbnailPrompt,
    thumbnailNegativePrompt,
    thumbnailPromptVariants: documentary ? thumbnailPromptVariants : text(rawVariants),
    universalVideoPrompt: documentary ? DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT : '',
    narrationScript,
    scenes,
    characters,
    editingInstructions: text(brief.editingInstructions),
    targetDurationSec:
      typeof brief.targetDurationSec === 'number' && brief.targetDurationSec > 0
        ? Math.round(brief.targetDurationSec)
        : options.videoDurationSec,
  };
}

export async function runBriefGeneration(ideaId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const task = TaskType.BRIEF_GENERATION;

  const idea = await prisma.idea.findUnique({ where: { id: ideaId } });
  if (!idea || idea.deletedAt) {
    console.log(`[worker:ai-p4] idea ${ideaId} missing — skipping package generation`);
    return;
  }
  if (idea.status !== 'APPROVED' && idea.packageStatus !== 'GENERATING') {
    console.log(`[worker:ai-p4] idea ${ideaId} not ready for package generation — skipping`);
    return;
  }

  const killed = await checkKillSwitch(prisma, task);
  if (killed) {
    console.warn(`[worker:ai-p4] ${killed} — skipping brief generation for idea ${ideaId}`);
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'NONE' },
    });
    return;
  }

  const masterKey = loadMasterKeyOrNull();
  if (!masterKey) {
    await prisma.idea.update({
      where: { id: ideaId },
      data: { status: 'APPROVED', packageStatus: 'NONE' },
    });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      title: `Brief generation skipped: MASTER_KEY not configured`,
      detail: { ideaId },
    });
    return;
  }

  const videoDurationSec = idea.requestedVideoDurationSec ?? 60;
  const clipDurationSec = idea.requestedClipDurationSec ?? 10;
  const sceneCount = Math.max(1, Math.round(videoDurationSec / clipDurationSec));

  const channelStyle = await loadChannelStyle(prisma, idea.accountId);
  const styleAnswers = parseStyleProfile(channelStyle?.styleProfile).answers;
  const presentation = normalizedPresentation(styleAnswers.presentation);
  const dramaOrDialogue = isDramaOrDialoguePackage(channelStyle?.styleProfile);
  const documentaryCollage = isDocumentaryVoiceoverPackage(channelStyle?.styleProfile);
  const narrationVoiceover =
    documentaryCollage || isNarrationVoiceoverPackage(channelStyle?.styleProfile);
  const channelLanguage = channelStyle?.language ?? 'en';
  const needsVo = presentationNeedsVoiceover(channelStyle?.styleProfile);
  const audioFirst = presentation === 'voiceover' || presentation === 'mixed';
  const prompt = await getActivePrompt(prisma, task, 'default', idea.accountId);

  await prisma.idea.update({
    where: { id: ideaId },
    data: { packageStatus: 'GENERATING' },
  });

  const packageOutputContract = audioFirst
    ? `Return JSON only (no prose or markdown fences) with:
{
  "videoTitle": string,
  "videoDescription": string,
  "storySummary": string,
  "thumbnailPrompt": string,
  "thumbnailNegativePrompt": string,
  "thumbnailPromptVariants": [string],
  "narrationScript": string,
  "characters": [{
    "name": string,
    "appearance": string,
    "wardrobe": string,
    "age": string,
    "personality": string,
    "consistencyDetails": string
  }],
  "editingInstructions": string,
  "targetDurationSec": number
}
Do NOT include sceneBreakdown, imagePrompt, or animationPrompt yet — visuals are generated later from the timed voiceover transcript.`
    : `Return JSON only (no prose or markdown fences) with:
{
  "videoTitle": string,
  "videoDescription": string,
  "storySummary": string,
  "thumbnailPrompt": string,
  "thumbnailNegativePrompt": string,
  "thumbnailPromptVariants": [string],
  "narrationScript": string,
  "sceneBreakdown": [
    {
      "sceneIndex": number,
      "durationSec": number,
      "imagePrompt": string,
      "animationPrompt": string,
      "negativePrompt": string,
      "animationNegativePrompt": string,
      "dialogue": [{"speaker": string, "line": string}]
    }
  ],
  "characters": [{
    "name": string,
    "appearance": string,
    "wardrobe": string,
    "age": string,
    "personality": string,
    "consistencyDetails": string
  }],
  "editingInstructions": string,
  "targetDurationSec": number
}`;

  const presentationInstructions =
    presentation === 'voiceover'
      ? documentaryCollage
        ? `Presentation mode is DOCUMENTARY VOICEOVER NARRATION (audio-first pipeline).
${formatFernNarrationRules(videoDurationSec)}
- Focus on title, description, story, characters, narration, and thumbnailPrompt only in this stage.
- Do not invent scene image/video prompts yet.`
        : `Presentation mode is VOICEOVER NARRATION (audio-first pipeline).
- narrationScript must be one complete, cohesive narration covering the full ${videoDurationSec} seconds (roughly ${Math.round(videoDurationSec * 2.3)}-${Math.round(videoDurationSec * 2.8)} spoken words).
- Open with a HOOKY first sentence. If the idea/hook/angle is about a person (or characters[] will include a notable person), write like a compelling host: "this person from [place] is famous for…" / "you've seen this face — here's why they matter…" — specific to the idea, never a generic template, never invent biography.
- Focus on title, description, story, characters, narration, and thumbnailPrompt only in this stage.
- Do not invent scene image/video prompts yet.`
      : presentation === 'dialogue'
        ? `Presentation mode is STORYTELLING / DIALOGUE.
- narrationScript must be an empty string.
- Every spoken line must be in its scene's dialogue array with the exact stable character name and must ALSO appear, clearly labeled "Dialogue: Speaker: line", inside that scene's animationPrompt (use expanded character references for speaker labels in animationPrompt).
- animationPrompt must combine camera, motion, action, timing, and exact dialogue so it can be pasted directly into a video-generation tool.
- Return exactly ${sceneCount} scenes (~${clipDurationSec}s each, totaling ~${videoDurationSec}s).
- Dialogue language: ALL spoken lines MUST be in ${languageDisplayName(channelLanguage)}.`
        : presentation === 'mixed'
          ? documentaryCollage
            ? `Presentation mode is MIXED with DOCUMENTARY NARRATOR portions (audio-first for narrator).
${formatFernNarrationRules(videoDurationSec)}
- narrationScript contains only the narrator portions (Fern continuous prose), cohesive across the full ${videoDurationSec} seconds (in ${languageDisplayName(channelLanguage)}).
- Character names must be defined in characters[].
- Do not invent scene image/video prompts yet — those are generated after the narrator voiceover is timed.
- Note any character dialogue ideas inside storySummary or editingInstructions for the later visual stage (spoken character lines in ${languageDisplayName(channelLanguage)}).`
            : `Presentation mode is MIXED VOICEOVER + DIALOGUE (audio-first for narrator).
- narrationScript contains only the narrator portions, cohesive across the full ${videoDurationSec} seconds (in ${languageDisplayName(channelLanguage)}).
- Open narrator portions with a hooky person/subject line when the idea is about a notable person (same "this person from [place] is famous for…" energy), then continue the story.
- Character names must be defined in characters[].
- Do not invent scene image/video prompts yet — those are generated after the narrator voiceover is timed.
- Note any character dialogue ideas inside storySummary or editingInstructions for the later visual stage (spoken character lines in ${languageDisplayName(channelLanguage)}).`
          : `Presentation mode is ${presentation || 'unspecified'}. Use narrationScript only when the saved style explicitly calls for narration.`;

  const dramaRules = dramaOrDialogue
    ? `\n${formatDramaDialoguePackageRules({
        clipDurationSec,
        language: channelLanguage,
        includeNegativePrompts: !audioFirst,
      })}`
    : '';

  const documentaryVisualRules =
    documentaryCollage && !audioFirst
      ? `\n${formatDocumentaryCollageVisualRules({
          sceneCount: documentaryBeatSceneCount(videoDurationSec, clipDurationSec),
          videoDurationSec,
          clipDurationSec,
        })}`
      : '';

  const thumbnailInstructions = documentaryCollage
    ? formatDocumentaryThumbnailInstructions(channelStyle?.thumbnailReferencePrompt)
    : formatThumbnailPromptInstructions(channelStyle);

  const languageRules = formatOutputLanguagePolicy(channelLanguage);

  const systemPrompt = withChannelStyle(
    `${prompt?.template ?? 'You are a creative package writer for short-form video. The owner will produce the video externally (no in-app render).'}

${packageOutputContract}
${languageRules}
- videoTitle and videoDescription are publish-facing: write them in ${languageDisplayName(channelLanguage)}.
- storySummary and character appearance/wardrobe/personality stay in English.
- narrationScript (voiceover) and dialogue[].line are spoken output: write them in ${languageDisplayName(channelLanguage)}.
- imagePrompt, animationPrompt, and thumbnailPrompt stay in English except quoted on-screen text and spoken lines, which must be in ${languageDisplayName(channelLanguage)}.
${presentationInstructions}
${dramaRules}
${documentaryVisualRules}
${
  audioFirst
    ? ''
    : `Return exactly ${sceneCount} scenes, ordered Scene 1 through Scene ${sceneCount}. Their durations must total approximately ${videoDurationSec} seconds and use approximately ${clipDurationSec} seconds per clip.
${formatSceneVisualPromptRulesWithChannel(sceneCount, channelStyle, {
  dramaOrDialogue,
  clipDurationSec,
  narrationVoiceover,
})}`
}
${thumbnailInstructions}
${
  dramaOrDialogue
    ? 'thumbnailPrompt must include the phrase "ultra realistic". Also return thumbnailNegativePrompt.'
    : ''
}
${
  documentaryCollage
    ? 'Never use em dashes (—) in any field. Prefer empty characters[] unless a real historical figure must appear as a labeled collage cutout.'
    : ''
}
Define every recurring person once in characters with a stable name, appearance, wardrobe, age, personality, and invariant consistency details.
Match the channel brand & style for tone, presentation, visuals, and captions.`,
    channelStyle,
  );
  const promptVersion = prompt?.version ?? 1;

  const inputText = JSON.stringify({
    title: idea.title,
    angle: idea.angle,
    hook: idea.hook,
    rationale: idea.rationale,
    category: idea.category,
    requestedVideoDurationSec: videoDurationSec,
    requestedClipDurationSec: clipDurationSec,
    suggestedSceneCount: sceneCount,
    pipeline: audioFirst ? 'audio-first-v1' : 'full-package-v3',
    dramaOrDialogue,
    documentaryCollage,
    narrationVoiceover,
    language: channelLanguage,
    thumbnailReferencePrompt: channelStyle?.thumbnailReferencePrompt?.trim() || undefined,
  });

  const cacheKey = cacheKeyFor({
    task: task as any,
    model: DEFAULT_GEMINI_TEXT_MODEL,
    promptVersion,
    styleVersion: styleVersionFromProfile(channelStyle),
    inputContentHash: hashText(
      `creative-package-v9:${presentation}:${dramaOrDialogue ? 'drama' : documentaryCollage ? 'doc-collage' : narrationVoiceover ? 'narration' : 'std'}:${channelLanguage}:${inputText}`,
    ),
  });

  const router = buildRouter(prisma, masterKey);

  try {
    const result: AIResult = await router.run({
      task: task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: { kind: 'text', text: inputText },
      schema: audioFirst
        ? z.object({
            videoTitle: z.string(),
            videoDescription: z.string(),
            storySummary: z.string(),
            thumbnailPrompt: z.string(),
            thumbnailNegativePrompt: z.string().optional(),
            thumbnailPromptVariants: z.array(z.string()).optional(),
            narrationScript: z.string(),
            characters: z.array(characterPromptSchema),
            editingInstructions: z.string(),
            targetDurationSec: z.number().positive(),
          })
        : productionBriefOutputSchema,
      cacheKey,
    });

    const brief = parseAiJsonObject(result.output);
    if (!brief) {
      throw new Error(
        `Package generation returned unparseable output: ${String(result.output).slice(0, 200)}`,
      );
    }

    const normalized = normalizeProductionBriefOutput(brief, {
      presentation,
      clipDurationSec,
      videoDurationSec,
      fallbackTitle: idea.title,
      dramaOrDialogue,
      documentaryCollage,
      narrationVoiceover,
    });
    const scriptText = normalized.narrationScript;
    const editingInstructions = joinProductionBriefEditingExtras({
      editingInstructions: normalized.editingInstructions,
      universalVideoPrompt: documentaryCollage
        ? normalized.universalVideoPrompt || DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT
        : '',
      thumbnailPromptVariants: documentaryCollage ? normalized.thumbnailPromptVariants : '',
      thumbnailNegativePrompt: normalized.thumbnailNegativePrompt,
    });

    let englishSummary = '';
    if (
      needsEnglishVoiceoverSummary(channelLanguage) &&
      needsVo &&
      scriptText.trim()
    ) {
      englishSummary = await summarizeVoiceoverInEnglish(router, {
        script: scriptText,
        language: channelLanguage,
        ideaId,
      });
    }

    await prisma.productionBrief.deleteMany({ where: { ideaId } });
    await prisma.productionBrief.create({
      data: {
        ideaId,
        researchSummary: normalized.storySummary,
        script: scriptText,
        englishSummary,
        sceneBreakdown: (audioFirst ? [] : normalized.scenes) as any,
        characterPrompts: normalized.characters as any,
        editingInstructions,
        targetDurationSec: normalized.targetDurationSec,
        videoTitle: normalized.videoTitle,
        videoDescription: normalized.videoDescription,
        thumbnailPrompt: normalized.thumbnailPrompt,
        voiceoverStatus: needsVo ? 'GENERATING' : 'NONE',
        voiceoverLocalPath: null,
        packageStage: 'SCRIPT',
        packageStageError: null,
        timedTranscript: [],
        transcriptLocalPath: null,
        voiceIdUsed: null,
      },
    });

    if (audioFirst && needsVo && scriptText.trim()) {
      // Stay GENERATING until visuals finish.
      await prisma.idea.update({
        where: { id: ideaId },
        data: { status: 'IN_PRODUCTION', packageStatus: 'GENERATING' },
      });
      await boss.send(QUEUE.TTS, { kind: 'idea_tts', ideaId } satisfies IdeaTtsJob, {
        singletonKey: `idea-tts-${ideaId}`,
        // Recover from worker restarts that orphan ACTIVE TTS jobs (tsx watch).
        expireInSeconds: 12 * 60,
      });
      console.log(`[worker:ai-p4] script stage done for idea ${ideaId} — enqueued voice`);
      return;
    }

    // Dialogue / non-VO: package is complete after this single stage.
    await prisma.productionBrief.update({
      where: { ideaId },
      data: { packageStage: 'READY', voiceoverStatus: 'NONE' },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { status: 'IN_PRODUCTION', packageStatus: 'READY' },
    });
    console.log(`[worker:ai-p4] package generation done for idea ${ideaId}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:ai-p4] package generation failed for idea ${ideaId}:`, errMsg);

    await prisma.productionBrief.updateMany({
      where: { ideaId },
      data: {
        packageStage: 'FAILED',
        packageStageError: `Script stage failed: ${errMsg.slice(0, 400)}`,
      },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'FAILED', status: 'APPROVED' },
    });

    const incidentKind =
      err instanceof AllProvidersExhaustedError ? ('RATE_LIMIT' as const) : ('SYSTEM' as const);
    await raiseIncident(prisma, {
      kind: incidentKind,
      title: `Brief generation failed: ${errMsg.slice(0, 200)}`,
      detail: { ideaId, error: errMsg },
    });
  }
}

function parseTimedTranscript(raw: unknown): TimedSegment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      const startMs = typeof row.startMs === 'number' ? row.startMs : Number(row.startMs);
      const endMs = typeof row.endMs === 'number' ? row.endMs : Number(row.endMs);
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      return { startMs, endMs, text };
    })
    .filter((s): s is TimedSegment => s != null);
}

/** Heuristic fallback when Edge subtitles are missing: evenly split sentences. */
function heuristicTimingsFromScript(script: string, totalMs: number): TimedSegment[] {
  const sentences = script
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) {
    return [{ startMs: 0, endMs: Math.max(1000, totalMs), text: script.trim() }];
  }
  const weights = sentences.map((s) => Math.max(1, s.length));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  return sentences.map((text, i) => {
    const share = Math.round((weights[i]! / weightSum) * totalMs);
    const startMs = cursor;
    const endMs = i === sentences.length - 1 ? totalMs : cursor + Math.max(400, share);
    cursor = endMs;
    return { startMs, endMs, text };
  });
}

/**
 * Timed transcript stage: prefer Edge TTS subtitle timings already stored on the
 * brief; otherwise build a heuristic sentence timeline. Writes SRT/VTT to disk.
 */
export async function runIdeaTranscript(ideaId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, deletedAt: null },
    include: { brief: true },
  });
  if (!idea?.brief) {
    console.warn(`[worker:ai-p4] idea ${ideaId} missing for transcript stage`);
    return;
  }

  await prisma.productionBrief.update({
    where: { ideaId },
    data: { packageStage: 'TRANSCRIPT', packageStageError: null },
  });

  try {
    let timings = parseTimedTranscript(idea.brief.timedTranscript);
    const script = idea.brief.script?.trim() ?? '';

    if (timings.length === 0 && script) {
      const targetMs = (idea.brief.targetDurationSec ?? idea.requestedVideoDurationSec ?? 60) * 1000;
      timings = heuristicTimingsFromScript(script, targetMs);
      console.warn(
        `[worker:ai-p4] no Edge timings for idea ${ideaId} — using heuristic sentence timeline`,
      );
    }

    const storageRoot = process.env.STORAGE_ROOT ?? '';
    let transcriptPath = idea.brief.transcriptLocalPath;
    if (timings.length > 0 && storageRoot) {
      const dir = join(storageRoot, 'ideas', ideaId, 'tts');
      await mkdir(dir, { recursive: true });
      transcriptPath = join(dir, 'voiceover.srt');
      await writeFile(transcriptPath, segmentsToSrt(timings), 'utf8');
      await writeFile(join(dir, 'voiceover.vtt'), segmentsToVtt(timings), 'utf8');
    }

    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        timedTranscript: timings as any,
        transcriptLocalPath: transcriptPath,
        packageStage: 'TRANSCRIPT',
        packageStageError: null,
      },
    });

    await boss.send(
      QUEUE.AI,
      { kind: 'idea_visuals', ideaId } satisfies IdeaVisualsJob,
      { singletonKey: `idea-visuals-${ideaId}` },
    );
    console.log(`[worker:ai-p4] transcript stage done for idea ${ideaId} — enqueued visuals`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        packageStage: 'FAILED',
        packageStageError: `Transcript stage failed: ${errMsg.slice(0, 400)}`,
      },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'FAILED', status: 'APPROVED' },
    });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      title: `Idea transcript failed: ${errMsg.slice(0, 200)}`,
      detail: { ideaId, error: errMsg },
    });
  }
}

const visualPromptsOutputSchema = z.object({
  thumbnailPrompt: z.string().optional(),
  thumbnailNegativePrompt: z.string().optional(),
  thumbnailPromptVariants: z.array(z.string()).optional(),
  sceneBreakdown: z.array(
    z.object({
      sceneIndex: z.number().int().positive(),
      startMs: z.number().nonnegative().optional(),
      endMs: z.number().nonnegative().optional(),
      durationSec: z.number().positive(),
      narrationSegment: z.string().optional(),
      imagePrompt: z.string(),
      animationPrompt: z.string(),
      negativePrompt: z.string().optional(),
      animationNegativePrompt: z.string().optional(),
      videoNegativePrompt: z.string().optional(),
      dialogue: z.union([z.string(), z.array(dialogueLineSchema)]).optional(),
    }),
  ),
  editingInstructions: z.string().optional(),
});

/**
 * Visual prompts stage: feed narration + timed transcript back to AI to produce
 * scene-aligned image and video prompts. Marks package READY when done.
 */
export async function runIdeaVisuals(ideaId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const task = TaskType.BRIEF_GENERATION;

  const idea = await prisma.idea.findFirst({
    where: { id: ideaId, deletedAt: null },
    include: { brief: true },
  });
  if (!idea?.brief) {
    console.warn(`[worker:ai-p4] idea ${ideaId} missing for visuals stage`);
    return;
  }

  const killed = await checkKillSwitch(prisma, task);
  if (killed) {
    await prisma.productionBrief.update({
      where: { ideaId },
      data: { packageStage: 'FAILED', packageStageError: killed },
    });
    await prisma.idea.update({ where: { id: ideaId }, data: { packageStatus: 'FAILED', status: 'APPROVED' } });
    return;
  }

  const masterKey = loadMasterKeyOrNull();
  if (!masterKey) {
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        packageStage: 'FAILED',
        packageStageError: 'MASTER_KEY not configured',
      },
    });
    await prisma.idea.update({ where: { id: ideaId }, data: { packageStatus: 'FAILED', status: 'APPROVED' } });
    return;
  }

  await prisma.productionBrief.update({
    where: { ideaId },
    data: { packageStage: 'VISUALS', packageStageError: null },
  });

  const videoDurationSec =
    idea.brief.targetDurationSec ?? idea.requestedVideoDurationSec ?? 60;
  const clipDurationSec = idea.requestedClipDurationSec ?? 10;
  const channelStyle = await loadChannelStyle(prisma, idea.accountId);
  const presentation = normalizedPresentation(
    parseStyleProfile(channelStyle?.styleProfile).answers.presentation,
  );
  const dramaOrDialogue = isDramaOrDialoguePackage(channelStyle?.styleProfile);
  const documentaryCollage = isDocumentaryVoiceoverPackage(channelStyle?.styleProfile);
  const narrationVoiceover =
    documentaryCollage || isNarrationVoiceoverPackage(channelStyle?.styleProfile);
  const sceneCount = documentaryCollage
    ? documentaryBeatSceneCount(videoDurationSec, clipDurationSec)
    : Math.max(1, Math.round(videoDurationSec / clipDurationSec));
  const channelLanguage = channelStyle?.language ?? 'en';
  const timings = parseTimedTranscript(idea.brief.timedTranscript);
  const priorEditing = splitProductionBriefEditingExtras(idea.brief.editingInstructions ?? '');

  const router = buildRouter(prisma, masterKey);
  const dramaRules = dramaOrDialogue
    ? `\n${formatDramaDialoguePackageRules({
        clipDurationSec,
        language: channelLanguage,
        includeNegativePrompts: true,
      })}`
    : '';
  const documentaryRules = documentaryCollage
    ? `\n${formatDocumentaryCollageVisualRules({
        sceneCount,
        videoDurationSec,
        clipDurationSec,
      })}`
    : '';
  const thumbnailInstructions = documentaryCollage
    ? formatDocumentaryThumbnailInstructions(channelStyle?.thumbnailReferencePrompt)
    : formatThumbnailPromptInstructions(channelStyle);
  const languageRules = formatOutputLanguagePolicy(channelLanguage);
  const systemPrompt = withChannelStyle(
    `You generate production visual prompts for a short-form video whose voiceover already exists.
Return JSON only:
{
  "thumbnailPrompt": string,
  "thumbnailNegativePrompt": string,
  "thumbnailPromptVariants": [string],
  "sceneBreakdown": [{
    "sceneIndex": number,
    "startMs": number,
    "endMs": number,
    "durationSec": number,
    "narrationSegment": string,
    "imagePrompt": string,
    "animationPrompt": string,
    "negativePrompt": string,
    "animationNegativePrompt": string,
    "dialogue": [{"speaker": string, "line": string}]
  }],
  "editingInstructions": string
}
Rules:
${languageRules}
- imagePrompt and animationPrompt bodies stay in English; quote any on-screen overlay text and spoken dialogue in ${languageDisplayName(channelLanguage)}.
- Return about ${sceneCount} scenes covering the full narration timeline (~${videoDurationSec}s total${
      documentaryCollage
        ? ', preferring ~2-3s beats / 5-8 words per beat where practical'
        : `, ~${clipDurationSec}s per clip`
    }).
- Each scene MUST include startMs/endMs aligned to the timed transcript ranges (or evenly cover the narration if ranges must be grouped).
- narrationSegment is the exact voiceover text spoken during that time range.
- imagePrompt and animationPrompt must match that narration segment only — no unrelated dialogue for pure voiceover.
${
  presentation === 'mixed'
    ? `- Mixed mode: narrator text stays in narrationSegment; put any character dialogue in dialogue[] AND embed it in animationPrompt labeled by speaker (expanded character references). Spoken character dialogue must be in ${languageDisplayName(channelLanguage)}.`
    : '- Voiceover mode: dialogue must be [] for every scene. Do not invent spoken character lines.'
}
${
  documentaryCollage
    ? documentaryRules
    : formatSceneVisualPromptRulesWithChannel(sceneCount, channelStyle, {
        dramaOrDialogue,
        clipDurationSec,
        narrationVoiceover,
      })
}
${dramaRules}
${thumbnailInstructions}
${
  dramaOrDialogue
    ? 'thumbnailPrompt must include the phrase "ultra realistic". Also return thumbnailNegativePrompt plus per-scene negativePrompt (image) and animationNegativePrompt (video) — embed each into its own prompt only.'
    : narrationVoiceover
      ? 'Also return per-scene negativePrompt (image, with no-dialogue forbids) and animationNegativePrompt (video, with no-dialogue plus motion/audio avoids). Embed image negatives only in imagePrompt and video negatives only in animationPrompt. Animation prompts must include scene sound design (music, dramatic SFX such as impact hits/whooshes/tension risers, ambience); VO is external.'
      : 'Also return per-scene negativePrompt (image) and animationNegativePrompt (video); embed each into its own prompt only — do not reuse the same list.'
}
${
  documentaryCollage
    ? 'Never use em dashes (—). Each imagePrompt must be fully self-contained with the verbatim style block and closer so prompts can be exported blank-line-separated for bulk generation.'
    : 'Reuse character appearance details from the provided character sheets when people appear.'
}`,
    channelStyle,
  );

  const inputText = JSON.stringify({
    videoTitle: idea.brief.videoTitle,
    videoDescription: idea.brief.videoDescription,
    storySummary: idea.brief.researchSummary,
    narrationScript: idea.brief.script,
    characters: idea.brief.characterPrompts,
    timedTranscript: timings,
    clipDurationSec,
    videoDurationSec,
    suggestedSceneCount: sceneCount,
    dramaOrDialogue,
    documentaryCollage,
    narrationVoiceover,
    language: channelLanguage,
    thumbnailReferencePrompt: channelStyle?.thumbnailReferencePrompt?.trim() || undefined,
    universalVideoPrompt: documentaryCollage ? DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT : undefined,
  });

  try {
    const result = await router.run({
      task: task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: { kind: 'text', text: inputText },
      schema: visualPromptsOutputSchema,
      cacheKey: cacheKeyFor({
        task: task as any,
        model: DEFAULT_GEMINI_TEXT_MODEL,
        promptVersion: 1,
        styleVersion: styleVersionFromProfile(channelStyle),
        inputContentHash: hashText(
          `visual-prompts-v5:${dramaOrDialogue ? 'drama' : documentaryCollage ? 'doc-collage' : narrationVoiceover ? 'narration' : 'std'}:${channelLanguage}:${ideaId}:${hashText(inputText)}`,
        ),
      }),
    });

    const parsed = parseAiJsonObject(result.output) ?? {};
    const normalized = normalizeProductionBriefOutput(
      {
        ...parsed,
        videoTitle: idea.brief.videoTitle,
        videoDescription: idea.brief.videoDescription,
        storySummary: idea.brief.researchSummary,
        narrationScript: idea.brief.script,
        characters: idea.brief.characterPrompts,
        thumbnailPrompt:
          (parsed as { thumbnailPrompt?: string }).thumbnailPrompt || idea.brief.thumbnailPrompt,
      },
      {
        presentation,
        clipDurationSec,
        videoDurationSec,
        fallbackTitle: idea.brief.videoTitle || idea.title,
        dramaOrDialogue,
        documentaryCollage,
        narrationVoiceover,
      },
    );

    // Attach timing + narration segment onto scenes when the model provided them.
    const rawScenes = Array.isArray((parsed as { sceneBreakdown?: unknown }).sceneBreakdown)
      ? ((parsed as { sceneBreakdown: unknown[] }).sceneBreakdown ?? [])
      : [];
    const beatMs = documentaryCollage
      ? Math.min(clipDurationSec, 3) * 1000
      : clipDurationSec * 1000;
    const scenesWithTiming = normalized.scenes.map((scene, index) => {
      const raw = (rawScenes[index] && typeof rawScenes[index] === 'object'
        ? rawScenes[index]
        : {}) as Record<string, unknown>;
      const startMs =
        typeof raw.startMs === 'number'
          ? raw.startMs
          : timings[index]?.startMs ?? index * beatMs;
      const endMs =
        typeof raw.endMs === 'number'
          ? raw.endMs
          : timings[index]?.endMs ?? startMs + beatMs;
      const narrationSegment =
        typeof raw.narrationSegment === 'string' && raw.narrationSegment.trim()
          ? raw.narrationSegment.trim()
          : timings
              .filter((t) => t.startMs < endMs && t.endMs > startMs)
              .map((t) => t.text)
              .join(' ') || scene.dialogue.map((d) => d.line).join(' ');
      return {
        ...scene,
        startMs,
        endMs,
        narrationSegment,
      };
    });

    const editingInstructions = joinProductionBriefEditingExtras({
      editingInstructions:
        normalized.editingInstructions || priorEditing.editingInstructions,
      universalVideoPrompt: documentaryCollage
        ? normalized.universalVideoPrompt ||
          priorEditing.universalVideoPrompt ||
          DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT
        : priorEditing.universalVideoPrompt,
      thumbnailPromptVariants:
        normalized.thumbnailPromptVariants || priorEditing.thumbnailPromptVariants,
      thumbnailNegativePrompt:
        normalized.thumbnailNegativePrompt || priorEditing.thumbnailNegativePrompt,
    });

    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        sceneBreakdown: scenesWithTiming as any,
        thumbnailPrompt: normalized.thumbnailPrompt || idea.brief.thumbnailPrompt,
        editingInstructions,
        packageStage: 'READY',
        packageStageError: null,
      },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'READY', status: 'IN_PRODUCTION' },
    });
    console.log(`[worker:ai-p4] visuals stage done — package READY for idea ${ideaId}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:ai-p4] visuals failed for idea ${ideaId}:`, errMsg);
    await prisma.productionBrief.update({
      where: { ideaId },
      data: {
        packageStage: 'FAILED',
        packageStageError: `Visuals stage failed: ${errMsg.slice(0, 400)}`,
      },
    });
    await prisma.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'FAILED', status: 'APPROVED' },
    });
    await raiseIncident(prisma, {
      kind: err instanceof AllProvidersExhaustedError ? 'RATE_LIMIT' : 'SYSTEM',
      title: `Idea visuals failed: ${errMsg.slice(0, 200)}`,
      detail: { ideaId, error: errMsg },
    });
  }
}

// ── Drama bible generation (FR-E2) ────────────────────────────────────────

export async function runDramaBible(seriesId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const task = TaskType.DRAMA_BIBLE;

  const series = await prisma.dramaSeries.findUnique({ where: { id: seriesId } });
  if (!series || series.deletedAt) {
    console.log(`[worker:ai-p4] series ${seriesId} not found — skipping bible generation`);
    return;
  }
  if (series.status !== 'BIBLE_GENERATING') {
    console.log(
      `[worker:ai-p4] series ${seriesId} is ${series.status}, not BIBLE_GENERATING — skipping`,
    );
    return;
  }

  const killed = await checkKillSwitch(prisma, task);
  if (killed) {
    await prisma.dramaSeries.update({ where: { id: seriesId }, data: { status: 'FAILED' } });
    console.warn(`[worker:ai-p4] ${killed} — skipping bible generation for series ${seriesId}`);
    return;
  }

  const masterKey = loadMasterKeyOrNull();
  if (!masterKey) {
    await prisma.dramaSeries.update({ where: { id: seriesId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      title: `Drama bible generation failed: MASTER_KEY not configured`,
      detail: { seriesId },
    });
    return;
  }

  const prompt = await getActivePrompt(prisma, task, 'default', series.accountId);
  const channelStyle = await loadChannelStyle(prisma, series.accountId);
  const systemPrompt = withChannelStyle(
    `${prompt?.template ?? 'You are a drama series writer. Given series parameters, generate a series bible as JSON with {outline, world, tone} and characterSheets as a JSON array of {name, description, visualDescriptor, role, personality}.'}
${formatOutputLanguagePolicy(channelStyle?.language)}
- Write outline, world, tone, and character descriptions/visualDescriptor in English.
- Character names may stay in the form natural to the series; spoken sample lines, if any, must be in ${languageDisplayName(channelStyle?.language)}.`,
    channelStyle,
  );
  const promptVersion = prompt?.version ?? 1;

  const inputText = JSON.stringify({
    title: series.title,
    genre: series.genre,
    theme: series.theme,
    audience: series.audience,
    episodeCount: series.episodeCount,
    episodeDurationSec: series.episodeDurationSec,
    styleReferences: series.styleReferences,
  });

  const cacheKey = cacheKeyFor({
    task: task as any,
    model: DEFAULT_GEMINI_TEXT_MODEL,
    promptVersion,
    styleVersion: styleVersionFromProfile(channelStyle),
    inputContentHash: hashText(inputText),
  });

  const router = buildRouter(prisma, masterKey);

  try {
    const result: AIResult = await router.run({
      task: task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: { kind: 'text', text: inputText },
      cacheKey,
    });

    const parsed: Record<string, unknown> = parseAiJsonObject(result.output) ?? {
      outline: String(result.output),
    };

    const seriesBible = {
      outline: parsed.outline ?? '',
      world: parsed.world ?? '',
      tone: parsed.tone ?? '',
    };
    const characterSheets = Array.isArray(parsed.characterSheets) ? parsed.characterSheets : [];

    await prisma.dramaSeries.update({
      where: { id: seriesId },
      data: {
        seriesBible: seriesBible as any,
        characterSheets: characterSheets as any,
        status: 'BIBLE_READY',
      },
    });

    const existingEpisodes = await prisma.dramaEpisode.count({ where: { seriesId } });
    if (existingEpisodes === 0) {
      const episodeData = Array.from({ length: series.episodeCount }, (_, i) => ({
        seriesId,
        number: i + 1,
        status: 'PENDING' as const,
      }));
      await prisma.dramaEpisode.createMany({ data: episodeData });
    }

    console.log(
      `[worker:ai-p4] bible generation done for series ${seriesId} — ${series.episodeCount} episode(s) created`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:ai-p4] bible generation failed for series ${seriesId}:`, errMsg);

    await prisma.dramaSeries.update({ where: { id: seriesId }, data: { status: 'FAILED' } });

    const incidentKind =
      err instanceof AllProvidersExhaustedError ? ('RATE_LIMIT' as const) : ('SYSTEM' as const);
    await raiseIncident(prisma, {
      kind: incidentKind,
      title: `Drama bible generation failed: ${errMsg.slice(0, 200)}`,
      detail: { seriesId, error: errMsg },
    });
  }
}

// ── Drama episode generation (FR-E3) ──────────────────────────────────────

export async function runDramaEpisode(episodeId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const task = TaskType.DRAMA_EPISODE;

  const episode = await prisma.dramaEpisode.findUnique({
    where: { id: episodeId },
    include: { series: true },
  });
  if (!episode) {
    console.log(`[worker:ai-p4] episode ${episodeId} not found — skipping`);
    return;
  }
  if (episode.status !== 'GENERATING') {
    console.log(
      `[worker:ai-p4] episode ${episodeId} is ${episode.status}, not GENERATING — skipping`,
    );
    return;
  }

  const series = episode.series;
  if (!series || series.deletedAt) {
    console.log(`[worker:ai-p4] series for episode ${episodeId} not found — skipping`);
    return;
  }

  const killed = await checkKillSwitch(prisma, task);
  if (killed) {
    await prisma.dramaEpisode.update({ where: { id: episodeId }, data: { status: 'FAILED' } });
    console.warn(`[worker:ai-p4] ${killed} — skipping episode generation for ${episodeId}`);
    return;
  }

  const masterKey = loadMasterKeyOrNull();
  if (!masterKey) {
    await prisma.dramaEpisode.update({ where: { id: episodeId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      title: `Drama episode generation failed: MASTER_KEY not configured`,
      detail: { episodeId, seriesId: series.id },
    });
    return;
  }

  const previousEpisodes = await prisma.dramaEpisode.findMany({
    where: { seriesId: series.id, number: { lt: episode.number } },
    orderBy: { number: 'asc' },
    select: { number: true, summary: true, recap: true },
  });

  const prompt = await getActivePrompt(prisma, task, 'default', series.accountId);
  const channelStyle = await loadChannelStyle(prisma, series.accountId);
  const lang = languageDisplayName(channelStyle?.language);
  const systemPrompt = withChannelStyle(
    `${prompt?.template ?? 'You are a drama episode writer. Given the series bible, character sheets, and previous episode recaps, generate the next episode as JSON with {summary, script, scenePrompts (array of {description, imagePrompt, videoPrompt}), narration, productionNotes, recap}.'}
${formatOutputLanguagePolicy(channelStyle?.language)}
- summary, recap, and productionNotes stay in English.
- script and narration are spoken output: write them in ${lang}.
- scenePrompts description/imagePrompt/videoPrompt stay in English; quote spoken dialogue and on-screen text in ${lang}.`,
    channelStyle,
  );
  const promptVersion = prompt?.version ?? 1;

  const inputText = JSON.stringify({
    seriesTitle: series.title,
    episodeNumber: episode.number,
    totalEpisodes: series.episodeCount,
    episodeDurationSec: series.episodeDurationSec,
    seriesBible: series.seriesBible,
    characterSheets: series.characterSheets,
    previousRecaps: previousEpisodes.map((e) => ({
      episode: e.number,
      recap: e.recap ?? e.summary ?? '',
    })),
  });

  const cacheKey = cacheKeyFor({
    task: task as any,
    model: DEFAULT_GEMINI_TEXT_MODEL,
    promptVersion,
    styleVersion: styleVersionFromProfile(channelStyle),
    inputContentHash: hashText(inputText),
  });

  const router = buildRouter(prisma, masterKey);

  try {
    const result: AIResult = await router.run({
      task: task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: { kind: 'text', text: inputText },
      cacheKey,
    });

    const parsed: Record<string, unknown> = parseAiJsonObject(result.output) ?? {
      script: String(result.output),
    };

    await prisma.dramaEpisode.update({
      where: { id: episodeId },
      data: {
        summary: typeof parsed.summary === 'string' ? parsed.summary : null,
        script: typeof parsed.script === 'string' ? parsed.script : null,
        scenePrompts: (parsed.scenePrompts as any) ?? [],
        narration: typeof parsed.narration === 'string' ? parsed.narration : null,
        productionNotes: typeof parsed.productionNotes === 'string' ? parsed.productionNotes : null,
        recap: typeof parsed.recap === 'string' ? parsed.recap : null,
        generatedAt: new Date(),
        status: 'GENERATED',
      },
    });

    const allGenerated = await prisma.dramaEpisode.count({
      where: {
        seriesId: series.id,
        status: { in: ['GENERATED', 'IN_PRODUCTION', 'UPLOADED', 'PUBLISHED'] },
      },
    });
    if (allGenerated >= series.episodeCount && series.status === 'BIBLE_READY') {
      await prisma.dramaSeries.update({
        where: { id: series.id },
        data: { status: 'IN_PRODUCTION' },
      });
    }

    console.log(
      `[worker:ai-p4] episode ${episode.number}/${series.episodeCount} generated for series "${series.title}"`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:ai-p4] episode generation failed for ${episodeId}:`, errMsg);

    await prisma.dramaEpisode.update({ where: { id: episodeId }, data: { status: 'FAILED' } });

    const incidentKind =
      err instanceof AllProvidersExhaustedError ? ('RATE_LIMIT' as const) : ('SYSTEM' as const);
    await raiseIncident(prisma, {
      kind: incidentKind,
      title: `Drama episode generation failed: ${errMsg.slice(0, 200)}`,
      detail: { episodeId, seriesId: series.id, episodeNumber: episode.number, error: errMsg },
    });
  }
}

// ── A/B suggestions (Phase 7 #10) ──────────────────────────────────────────

/**
 * Generate 3 title candidates + 3 thumbnail-prompt candidates for a rendered
 * content item. Persist as PostSuggestion rows for the metadata editor to pick.
 */
export async function runAbSuggestions(contentItemId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const task = TaskType.AB_SUGGESTIONS;

  const killed = await checkKillSwitch(prisma, task);
  if (killed) {
    console.warn(`[worker:ai-p7] ${killed} — skipping A/B suggestions for ${contentItemId}`);
    return;
  }

  const masterKey = loadMasterKeyOrNull();
  if (!masterKey) {
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'A/B suggestions skipped: MASTER_KEY not configured',
    });
    return;
  }

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { publishTargets: { select: { accountId: true }, take: 1 } },
  });
  if (!item) return;

  const accountId = item.publishTargets[0]?.accountId;
  const channelStyle = await loadChannelStyle(prisma, accountId ?? null);
  const prompt = await getActivePrompt(prisma, task, 'default', accountId ?? null);
  const systemPrompt = withChannelStyle(
    prompt?.template ??
      `You generate viral video variants. Given a video title and its script/analysis, produce a JSON object with two arrays: {"titles": ["...", "...", "..."], "thumbnailPrompts": ["...", "...", "..."]}. Titles should be under 70 chars, use curiosity or specificity, avoid clickbait, and be written in ${languageDisplayName(channelStyle?.language)} (publish-facing). Thumbnail prompts describe a single striking image in English; quote any on-image lettering in ${languageDisplayName(channelStyle?.language)}. Match the channel brand & style.`,
    channelStyle,
  );
  const promptVersion = prompt?.version ?? 1;

  const step = (item.currentStep ?? {}) as Record<string, unknown>;
  const inputText = JSON.stringify({
    title: item.title,
    analysis: step.analysis,
    script: step.script,
  });

  const cacheKey = cacheKeyFor({
    task: task as any,
    model: DEFAULT_GEMINI_TEXT_MODEL,
    promptVersion,
    styleVersion: styleVersionFromProfile(channelStyle),
    inputContentHash: hashText(inputText),
  });

  const router = buildRouter(prisma, masterKey);

  try {
    const result: AIResult = await router.run({
      task: task as any,
      model: DEFAULT_GEMINI_TEXT_MODEL,
      system: systemPrompt,
      input: { kind: 'text', text: inputText },
      cacheKey,
      contentItemId,
    });

    // Parse failure leaves both arrays empty; the job succeeds with zero suggestions.
    const p = (parseAiJsonObject(result.output) ?? {}) as {
      titles?: unknown;
      thumbnailPrompts?: unknown;
    };
    const titles = Array.isArray(p.titles) ? (p.titles as unknown[]).map(String).slice(0, 3) : [];
    const thumbs = Array.isArray(p.thumbnailPrompts)
      ? (p.thumbnailPrompts as unknown[]).map(String).slice(0, 3)
      : [];

    // Replace any existing (unpicked) suggestions with a fresh batch.
    await prisma.postSuggestion.deleteMany({
      where: { contentItemId, chosen: false },
    });

    const rows = [
      ...titles.map((t, i) => ({ contentItemId, kind: 'TITLE' as const, content: t, rank: i })),
      ...thumbs.map((t, i) => ({
        contentItemId,
        kind: 'THUMBNAIL_PROMPT' as const,
        content: t,
        rank: i,
      })),
    ];
    if (rows.length > 0) {
      await prisma.postSuggestion.createMany({ data: rows });
    }

    console.log(
      `[worker:ai-p7] A/B suggestions done for ${contentItemId} — ${titles.length} titles, ${thumbs.length} thumbnails`,
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:ai-p7] A/B suggestions failed for ${contentItemId}:`, errMsg);

    const incidentKind =
      err instanceof AllProvidersExhaustedError ? ('RATE_LIMIT' as const) : ('SYSTEM' as const);
    await raiseIncident(prisma, {
      kind: incidentKind,
      contentItemId,
      title: `A/B suggestions failed: ${errMsg.slice(0, 200)}`,
      detail: { error: errMsg },
    });
  }
}

// ── Reference-channel performance analysis (channel memory) ───────────────

const performanceAiSchema = z.object({
  summary: z.string(),
  whyTopPerformed: z.array(z.string()).max(8),
  winningHooks: z.array(z.string()).max(8),
  avoidPatterns: z.array(z.string()).max(8),
  caveat: z.string(),
});

/**
 * Build deterministic performance signals from stored titles/views, optionally
 * enrich with an AI narrative, and persist as CompetitorChannel.performanceMemory.
 * Never fails the poll path — AI unavailability keeps deterministic memory.
 */
export async function runCompetitorPerformanceAnalysis(
  competitorChannelId: string,
  _boss: PgBoss,
  force = false,
): Promise<void> {
  const prisma = getPrisma();

  const channel = await prisma.competitorChannel.findUnique({
    where: { id: competitorChannelId },
  });
  if (!channel || channel.deletedAt) {
    console.log(
      `[worker:ai-p4] performance analysis skipped — channel ${competitorChannelId} missing`,
    );
    return;
  }

  const videos = await prisma.competitorVideo.findMany({
    where: { competitorChannelId },
    select: { videoId: true, title: true, views: true, publishedAt: true },
  });

  if (videos.length === 0) {
    console.log(`[worker:ai-p4] performance analysis skipped — no videos for ${channel.name}`);
    return;
  }

  const inputVideos = videos.map((v) => ({
    videoId: v.videoId,
    title: v.title,
    views: v.views,
    publishedAt: v.publishedAt,
  }));
  const fp = fingerprintVideos(inputVideos);
  const existing = parseChannelPerformanceMemory(channel.performanceMemory);
  if (!force && existing?.dataFingerprint === fp) {
    console.log(
      `[worker:ai-p4] performance analysis skipped — fingerprint unchanged for ${channel.name}`,
    );
    return;
  }

  let aiInsights: AiPerformanceInsights | null = null;
  let aiAvailable = false;

  const killed = await checkKillSwitch(prisma, TaskType.IDEA_GENERATION);
  const masterKey = loadMasterKeyOrNull();

  if (!killed && masterKey) {
    try {
      const memoryDraft = buildChannelPerformanceMemory(inputVideos, null, false);
      const d = memoryDraft.deterministic;
      const router = buildRouter(prisma, masterKey);
      const system = `You analyze YouTube channel title performance using ONLY titles, view counts, and publish dates.
Frame every claim as inference — not causal proof. Never claim you watched the videos.
Return JSON with {summary, whyTopPerformed[], winningHooks[], avoidPatterns[], caveat}.
caveat MUST state that insights are inferred from titles and views only.`;
      const input = JSON.stringify({
        channel: channel.name,
        sampleSize: d.sampleSize,
        topVideos: d.topVideos.slice(0, 8),
        weakVideos: d.weakVideos.slice(0, 4),
        titlePatternsTop: d.titlePatternsTop,
        titlePatternsOverall: d.titlePatternsOverall,
        winningTopics: d.winningTopics,
        avoidPatterns: d.avoidPatterns,
        keywordClusters: d.keywordClusters.slice(0, 8),
      });

      const result: AIResult = await router.run({
        task: TaskType.IDEA_GENERATION as any,
        model: DEFAULT_GEMINI_TEXT_MODEL,
        system,
        input: { kind: 'text', text: input },
        schema: performanceAiSchema,
      });

      const parsed = performanceAiSchema.safeParse(parseAiJson(result.output));
      if (parsed.success) {
        aiInsights = {
          summary: parsed.data.summary.trim(),
          whyTopPerformed: parsed.data.whyTopPerformed.map((s) => s.trim()).filter(Boolean),
          winningHooks: parsed.data.winningHooks.map((s) => s.trim()).filter(Boolean),
          avoidPatterns: parsed.data.avoidPatterns.map((s) => s.trim()).filter(Boolean),
          caveat:
            parsed.data.caveat.trim() ||
            'Inferred from titles and view counts only — not causal proof.',
        };
        aiAvailable = true;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[worker:ai-p4] performance AI enrichment failed for ${channel.name} — keeping deterministic only:`,
        errMsg,
      );
      // Do not raise incident for optional enrichment; deterministic memory still saves.
    }
  } else if (killed) {
    console.warn(`[worker:ai-p4] ${killed} — saving deterministic performance memory only`);
  }

  const memory = buildChannelPerformanceMemory(inputVideos, aiInsights, aiAvailable);
  await prisma.competitorChannel.update({
    where: { id: competitorChannelId },
    data: {
      performanceMemory: memory as any,
      performanceAnalyzedAt: new Date(memory.analyzedAt),
    },
  });

  console.log(
    `[worker:ai-p4] performance memory saved for ${channel.name} — sample=${memory.sampleSize} ai=${aiAvailable}`,
  );
}


