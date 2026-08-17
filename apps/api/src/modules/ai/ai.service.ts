import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AiKey, AiKeyStatus, AiProvider, Prisma } from '@scp/db';
import { TaskType } from '@scp/shared';
import { z } from 'zod';
import {
  AIRouter,
  KeyPool,
  NoKeyAvailableError,
  GeminiProvider,
  OpenAIProvider,
  KokoroProvider,
  WhisperProvider,
  diagnoseEdgeTts,
  listEdgeVoices,
  synthesizeWithEdgeTts,
  cacheKeyFor,
  hashText,
  uploadGeminiFile,
  deleteGeminiFile,
  type AIResult,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type AIProvider as AIProviderInterface,
  type EdgeVoiceInfo,
} from '@scp/ai-providers';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../system/settings.service';
import { PrismaKeyStore } from './store/prisma-key-store';
import type { CreateKeyDto, PlaygroundDto, TtsPreviewDto, ComposeMasterPromptDto } from './dto/ai.dto';
import {
  composeChannelStyles,
  formatOutputLanguagePolicy,
  languageDisplayName,
  styleProfileAnswersSchema,
  styleProfileHasAnswers,
  needsEnglishVoiceoverSummary,
  englishVoiceoverSummarySystemPrompt,
  extractEnglishSummaryText,
} from '@scp/shared';

function parseComposeJson(raw: string): {
  masterPrompt?: string;
  writingStyle?: string;
  narrationStyle?: string;
  tags?: string[];
} | null {
  const text = raw.trim();
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const tags = Array.isArray(parsed.tags)
      ? parsed.tags
          .filter((t): t is string => typeof t === 'string')
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
          .slice(0, 20)
      : undefined;
    return {
      masterPrompt: typeof parsed.masterPrompt === 'string' ? parsed.masterPrompt.trim() : undefined,
      writingStyle: typeof parsed.writingStyle === 'string' ? parsed.writingStyle.trim() : undefined,
      narrationStyle:
        typeof parsed.narrationStyle === 'string' ? parsed.narrationStyle.trim() : undefined,
      tags,
    };
  } catch {
    return null;
  }
}

/** Pull TTS-ready prose from a rewrite result (plain text or `{ script }`). */
function extractSpokenScript(output: unknown): string {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const script = (output as { script?: unknown }).script;
    if (typeof script === 'string' && script.trim()) return script.trim();
  }
  if (typeof output === 'string') {
    let trimmed = output.trim();
    trimmed = trimmed.replace(/^```(?:json|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { script?: unknown };
        if (typeof parsed.script === 'string' && parsed.script.trim()) return parsed.script.trim();
      } catch {
        /* fall through */
      }
    }
    return trimmed;
  }
  return String(output ?? '').trim();
}

import { readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Sanitized key view — the secret (keyEnc) is NEVER included (docs/08 §2). */
export interface AiKeyView {
  id: string;
  providerId: string;
  label: string;
  last4: string;
  priority: number;
  status: AiKeyStatus;
  cooldownUntil: Date | null;
  createdAt: Date;
}

export interface AiProviderView {
  id: string;
  name: string;
  kind: AiProvider['kind'];
  enabled: boolean;
  baseConfig: Prisma.JsonValue;
  keys: AiKeyView[];
}

export interface PromptVersionView {
  id: string;
  accountId: string | null;
  task: string;
  name: string;
  version: number;
  template: string;
  schemaHint: Prisma.JsonValue;
  isActive: boolean;
  createdAt: Date;
}

function toKeyView(k: AiKey): AiKeyView {
  return {
    id: k.id,
    providerId: k.providerId,
    label: k.label,
    last4: k.keyLast4,
    priority: k.priority,
    status: k.status,
    cooldownUntil: k.cooldownUntil,
    createdAt: k.createdAt,
  };
}

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
  ) {}

  // ── Kill switches ─────────────────────────────────────────────────────────

  async getKillSwitches(): Promise<Record<string, boolean>> {
    return (await this.settings.getDecrypted<Record<string, boolean>>('killSwitches')) ?? {};
  }

  async assertNotKilled(task: TaskType, providerId?: string): Promise<void> {
    const ks = await this.getKillSwitches();
    if (ks['ai.global']) throw new ForbiddenException('AI is globally disabled via kill switch');
    if (ks[`ai.task.${task}`])
      throw new ForbiddenException(`AI task "${task}" is disabled via kill switch`);
    if (providerId && ks[`ai.provider.${providerId}`])
      throw new ForbiddenException(`AI provider "${providerId}" is disabled via kill switch`);
  }

  // ── Providers ─────────────────────────────────────────────────────────────

  async listProviders(): Promise<AiProviderView[]> {
    const providers = await this.prisma.client.aiProvider.findMany({
      orderBy: { name: 'asc' },
      include: { keys: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] } },
    });
    return providers.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      enabled: p.enabled,
      baseConfig: p.baseConfig,
      keys: p.keys.map(toKeyView),
    }));
  }

  async setProviderEnabled(id: string, enabled: boolean): Promise<AiProviderView> {
    await this.getProviderOrThrow(id);
    await this.prisma.client.aiProvider.update({ where: { id }, data: { enabled } });
    return this.getProviderView(id);
  }

  // ── Keys ──────────────────────────────────────────────────────────────────

  async createKey(providerId: string, dto: CreateKeyDto): Promise<AiKeyView> {
    await this.getProviderOrThrow(providerId);

    const keyEnc = this.crypto.encrypt(dto.key);
    const keyLast4 = this.crypto.last4(dto.key);
    const priority =
      dto.priority ??
      ((
        await this.prisma.client.aiKey.aggregate({
          where: { providerId },
          _max: { priority: true },
        })
      )._max.priority ?? 0) + 10;

    const key = await this.prisma.client.aiKey.create({
      data: {
        providerId,
        label: dto.label,
        keyEnc,
        keyLast4,
        priority,
        limits: (dto.limits ?? {}) as Prisma.InputJsonValue,
      },
    });
    return toKeyView(key);
  }

  async setKeyStatus(id: string, status: 'ACTIVE' | 'DISABLED'): Promise<AiKeyView> {
    await this.getKeyOrThrow(id);
    const key = await this.prisma.client.aiKey.update({ where: { id }, data: { status } });
    return toKeyView(key);
  }

  async deleteKey(id: string): Promise<{ id: string }> {
    await this.getKeyOrThrow(id);
    await this.prisma.client.aiKey.delete({ where: { id } });
    return { id };
  }

  async reorderKey(id: string, direction: 'up' | 'down'): Promise<AiKeyView[]> {
    const key = await this.getKeyOrThrow(id);
    const neighbor = await this.prisma.client.aiKey.findFirst({
      where:
        direction === 'up'
          ? { providerId: key.providerId, priority: { lt: key.priority } }
          : { providerId: key.providerId, priority: { gt: key.priority } },
      orderBy: { priority: direction === 'up' ? 'desc' : 'asc' },
    });
    if (!neighbor)
      throw new BadRequestException(
        `Key is already at the ${direction === 'up' ? 'top' : 'bottom'}`,
      );

    await this.prisma.client.$transaction([
      this.prisma.client.aiKey.update({
        where: { id: key.id },
        data: { priority: neighbor.priority },
      }),
      this.prisma.client.aiKey.update({
        where: { id: neighbor.id },
        data: { priority: key.priority },
      }),
    ]);

    const keys = await this.prisma.client.aiKey.findMany({
      where: { providerId: key.providerId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return keys.map(toKeyView);
  }

  // ── Prompt versions ───────────────────────────────────────────────────────

  async listPromptVersions(filters?: {
    task?: string;
    accountId?: string | null;
    activeOnly?: boolean;
  }): Promise<PromptVersionView[]> {
    const where: Prisma.PromptVersionWhereInput = {};
    if (filters?.task) where.task = filters.task;
    if (filters?.accountId !== undefined) where.accountId = filters.accountId;
    if (filters?.activeOnly) where.isActive = true;

    const rows = await this.prisma.client.promptVersion.findMany({
      where,
      orderBy: [{ task: 'asc' }, { name: 'asc' }, { version: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      task: r.task,
      name: r.name,
      version: r.version,
      template: r.template,
      schemaHint: r.schemaHint,
      isActive: r.isActive,
      createdAt: r.createdAt,
    }));
  }

  async createPromptVersion(dto: {
    accountId?: string | null;
    task: string;
    name: string;
    template: string;
    schemaHint?: unknown;
  }): Promise<PromptVersionView> {
    const accountId = dto.accountId ?? null;

    const latest = await this.prisma.client.promptVersion.findFirst({
      where: { accountId, task: dto.task, name: dto.name },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    // Deactivate prior versions for this (accountId, task, name)
    await this.prisma.client.promptVersion.updateMany({
      where: { accountId, task: dto.task, name: dto.name, isActive: true },
      data: { isActive: false },
    });

    const row = await this.prisma.client.promptVersion.create({
      data: {
        accountId,
        task: dto.task,
        name: dto.name,
        version: nextVersion,
        template: dto.template,
        schemaHint: dto.schemaHint as Prisma.InputJsonValue,
        isActive: true,
      },
    });
    return {
      id: row.id,
      accountId: row.accountId,
      task: row.task,
      name: row.name,
      version: row.version,
      template: row.template,
      schemaHint: row.schemaHint,
      isActive: row.isActive,
      createdAt: row.createdAt,
    };
  }

  async setPromptActive(id: string, isActive: boolean): Promise<PromptVersionView> {
    const pv = await this.prisma.client.promptVersion.findUnique({ where: { id } });
    if (!pv) throw new NotFoundException('Prompt version not found');

    if (isActive) {
      // Deactivate siblings before activating this one
      await this.prisma.client.promptVersion.updateMany({
        where: { accountId: pv.accountId, task: pv.task, name: pv.name, isActive: true },
        data: { isActive: false },
      });
    }

    const updated = await this.prisma.client.promptVersion.update({
      where: { id },
      data: { isActive },
    });
    return {
      id: updated.id,
      accountId: updated.accountId,
      task: updated.task,
      name: updated.name,
      version: updated.version,
      template: updated.template,
      schemaHint: updated.schemaHint,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
    };
  }

  // ── Playground ────────────────────────────────────────────────────────────

  async runPlayground(dto: PlaygroundDto): Promise<AIResult> {
    const task = dto.task as TaskType;
    await this.assertNotKilled(task);

    const registry = this.buildRegistry();
    const keyStore = new PrismaKeyStore(this.prisma.client, this.crypto);

    // Playground uses in-memory cache + logger (no persistence)
    const noopCache: CacheStore = {
      lookup: async () => null,
      save: async () => {},
      recordHit: async () => {},
    };
    const memLogger: UsageLogger = {
      log: async () => {},
    };

    const pool = new KeyPool(keyStore);
    const router = new AIRouter({ cache: noopCache, logger: memLogger, keyPool: pool, registry });

    const cacheKey = dto.skipCache
      ? undefined
      : cacheKeyFor({
          task,
          model: dto.model,
          promptVersion: dto.promptVersion ?? 1,
          styleVersion: dto.styleVersion ?? 1,
          inputContentHash: hashText(typeof dto.input === 'string' ? dto.input : JSON.stringify(dto.input)),
        });

    const result = await router.run({
      task,
      model: dto.model,
      system: dto.system ?? '',
      input: { kind: 'text', text: typeof dto.input === 'string' ? dto.input : JSON.stringify(dto.input) },
      cacheKey,
    });

    return result;
  }

  // ── Compose channel master prompt ───────────────────────────────────────

  /**
   * Build a heavy channel master prompt from ALL channel settings fields.
   * Uses the deterministic system-style composer, then optionally expands via
   * BRIEF_GENERATION. Falls back to local compose if the LLM is unavailable.
   */
  async composeMasterPrompt(dto: ComposeMasterPromptDto): Promise<{
    masterPrompt: string;
    writingStyle: string;
    narrationStyle: string;
    tags: string[];
    source: 'ai' | 'local';
  }> {
    const answers = styleProfileAnswersSchema.parse(dto.answers ?? {});
    const hasExtras = Boolean(
      dto.animationReferencePrompt?.trim() ||
        dto.thumbnailReferencePrompt?.trim() ||
        dto.titleTemplate?.trim() ||
        dto.descriptionTemplate?.trim() ||
        dto.writingStyle?.trim() ||
        dto.narrationStyle?.trim() ||
        dto.voiceNotes?.trim(),
    );
    if (!styleProfileHasAnswers(answers) && !hasExtras) {
      throw new BadRequestException(
        'Fill in the style questionnaire (or paste animation / thumbnail guidelines) before generating a prompt.',
      );
    }

    const local = composeChannelStyles(answers, dto.language ?? 'en', {
      animationReferencePrompt: dto.animationReferencePrompt,
      thumbnailReferencePrompt: dto.thumbnailReferencePrompt,
      titleTemplate: dto.titleTemplate,
      descriptionTemplate: dto.descriptionTemplate,
      writingStyle: dto.writingStyle,
      narrationStyle: dto.narrationStyle,
      contentType: dto.contentType,
      voiceNotes: dto.voiceNotes,
      lockedCharacters: dto.lockedCharacters,
    });

    if (dto.localOnly) {
      return { ...local, source: 'local' };
    }

    const task = 'BRIEF_GENERATION' as TaskType;
    try {
      await this.assertNotKilled(task);
      const registry = this.buildRegistry();
      const keyStore = new PrismaKeyStore(this.prisma.client, this.crypto);
      const noopCache: CacheStore = {
        lookup: async () => null,
        save: async () => {},
        recordHit: async () => {},
      };
      const memLogger: UsageLogger = { log: async () => {} };
      const pool = new KeyPool(keyStore);
      const router = new AIRouter({ cache: noopCache, logger: memLogger, keyPool: pool, registry });

      const result = await router.run({
        task,
        model: '',
        system: `You write channel master briefs for Social Creator Pilot (short-form social video).
Return ONLY valid JSON (no markdown fences, no preamble) with this shape:
{
  "masterPrompt": string,
  "writingStyle": string,
  "narrationStyle": string,
  "tags": string[]
}

masterPrompt requirements:
- Long, detailed, production-ready brand brief (aim for substantial coverage — not a short bullet list).
- Use clear markdown sections (## headings) covering: Role, Channel identity, Brand voice & writing,
  Presentation/pacing/narration, Visual & editing, Animation guidelines (if provided), Thumbnail style (if provided),
  Hard rules / do-not, Additional owner notes, Operating checklist.
- Incorporate ALL fields from the user JSON: questionnaire answers, animation guidelines, thumbnail reference,
  language, title/description templates, writing/narration notes, content type, voice notes.
- Keep practical imperative tone. Do not invent unrelated niches.
- Preserve owner animation / thumbnail guideline text in dedicated sections when present.
- Include the LANGUAGE POLICY from the user JSON verbatim in Channel identity (ideas/stories/image+video prompts stay English; voiceover, dialogue, on-screen text, and publish title/description/tags use the selected language).

writingStyle / narrationStyle: concise operator-facing summaries (1–3 sentences each).
tags: 8–15 lowercase discovery tags without #, niche-relevant, no spam.`,
        input: {
          kind: 'text',
          text: JSON.stringify(
            {
              language: dto.language ?? 'en',
              languagePolicy: formatOutputLanguagePolicy(dto.language ?? 'en'),
              contentType: dto.contentType ?? null,
              answers,
              animationReferencePrompt: dto.animationReferencePrompt?.trim() || null,
              thumbnailReferencePrompt: dto.thumbnailReferencePrompt?.trim() || null,
              titleTemplate: dto.titleTemplate?.trim() || null,
              descriptionTemplate: dto.descriptionTemplate?.trim() || null,
              writingStyle: dto.writingStyle?.trim() || null,
              narrationStyle: dto.narrationStyle?.trim() || null,
              voiceNotes: dto.voiceNotes?.trim() || null,
              lockedCharacters: dto.lockedCharacters ?? [],
              systemStyleDraft: {
                masterPrompt: local.masterPrompt,
                writingStyle: local.writingStyle,
                narrationStyle: local.narrationStyle,
                tags: local.tags,
              },
            },
            null,
            2,
          ),
        },
      });

      const out = typeof result.output === 'string' ? result.output.trim() : '';
      if (!out) return { ...local, source: 'local' };

      const parsed = parseComposeJson(out);
      if (parsed?.masterPrompt) {
        return {
          masterPrompt: parsed.masterPrompt,
          writingStyle: parsed.writingStyle || local.writingStyle,
          narrationStyle: parsed.narrationStyle || local.narrationStyle,
          tags: parsed.tags?.length ? parsed.tags : local.tags,
          source: 'ai',
        };
      }

      // Model returned plain text instead of JSON — treat as master prompt only.
      return {
        masterPrompt: out,
        writingStyle: local.writingStyle,
        narrationStyle: local.narrationStyle,
        tags: local.tags,
        source: 'ai',
      };
    } catch {
      return { ...local, source: 'local' };
    }
  }

  // ── Translation helper ────────────────────────────────────────────────────

  /**
   * Translate a short piece of text (video title, caption) to English via the
   * NARRATION_REWRITE chain — the most permissive text-in/text-out task. Returns
   * the input unchanged if the router fails so callers can degrade gracefully.
   */
  async translateToEnglish(text: string): Promise<string> {
    const task = 'NARRATION_REWRITE' as TaskType;
    try {
      await this.assertNotKilled(task);
      const registry = this.buildRegistry();
      const keyStore = new PrismaKeyStore(this.prisma.client, this.crypto);
      const noopCache: CacheStore = {
        lookup: async () => null,
        save: async () => {},
        recordHit: async () => {},
      };
      const memLogger: UsageLogger = { log: async () => {} };
      const pool = new KeyPool(keyStore);
      const router = new AIRouter({ cache: noopCache, logger: memLogger, keyPool: pool, registry });
      const result = await router.run({
        task,
        model: '',
        system:
          'You translate short video titles to fluent, natural English. Return ONLY the translated title — no quotes, no explanation, no source language notes. If the input is already English, return it verbatim.',
        input: { kind: 'text', text },
      });
      const out = typeof result.output === 'string' ? result.output.trim() : '';
      return out || text;
    } catch {
      return text;
    }
  }

  /**
   * Instruction-driven rewrite of a narration script. System prompt stays English;
   * spoken output follows the channel language policy. Not cached (one-shot).
   */
  async rewriteNarrationScript(input: {
    script: string;
    instruction: string;
    analysis?: string | null;
    language?: string | null;
  }): Promise<string> {
    const task = 'NARRATION_REWRITE' as TaskType;
    await this.assertNotKilled(task);
    const lang = input.language ?? 'en';
    const analysis =
      typeof input.analysis === 'string' && input.analysis.trim()
        ? input.analysis.trim().slice(0, 8000)
        : '';

    const registry = this.buildRegistry();
    const keyStore = new PrismaKeyStore(this.prisma.client, this.crypto);
    const noopCache: CacheStore = {
      lookup: async () => null,
      save: async () => {},
      recordHit: async () => {},
    };
    const memLogger: UsageLogger = { log: async () => {} };
    const pool = new KeyPool(keyStore);
    const router = new AIRouter({ cache: noopCache, logger: memLogger, keyPool: pool, registry });

    const result = await router.run({
      task,
      model: '',
      maxTokens: 8192,
      system: `You rewrite short-form video voiceover narration for Social Creator Pilot.
Keep these instructions in English.
${formatOutputLanguagePolicy(lang)}
Return ONLY the rewritten spoken narration as plain prose. No JSON, no markdown fences, no stage directions, no title, no commentary.
Apply the user's instruction. Keep facts the analysis supports; do not invent events, people, or claims.
Keep spoken duration within the source video length (a little under is fine; never longer). If the instruction is not about length, still do not add so many words that the VO would overrun the picture.
The spoken script must be in ${languageDisplayName(lang)}.`,
      input: {
        kind: 'text',
        text: JSON.stringify({
          currentScript: input.script,
          instruction: input.instruction,
          ...(analysis ? { analysis } : {}),
        }),
      },
    });

    const spoken = extractSpokenScript(result.output);
    if (!spoken) {
      throw new BadRequestException('AI returned an empty narration script.');
    }
    return spoken;
  }

  /**
   * Concise English summary of a non-English voiceover script for the owner.
   * Returns empty string when the channel language is English or the script is empty.
   */
  async summarizeNarrationInEnglish(input: {
    script: string;
    language?: string | null;
  }): Promise<string> {
    if (!needsEnglishVoiceoverSummary(input.language)) return '';
    const script = input.script.trim();
    if (!script) return '';

    const task = 'NARRATION_REWRITE' as TaskType;
    await this.assertNotKilled(task);

    const registry = this.buildRegistry();
    const keyStore = new PrismaKeyStore(this.prisma.client, this.crypto);
    const noopCache: CacheStore = {
      lookup: async () => null,
      save: async () => {},
      recordHit: async () => {},
    };
    const memLogger: UsageLogger = { log: async () => {} };
    const pool = new KeyPool(keyStore);
    const router = new AIRouter({ cache: noopCache, logger: memLogger, keyPool: pool, registry });

    const result = await router.run({
      task,
      model: '',
      maxTokens: 1024,
      system: englishVoiceoverSummarySystemPrompt(input.language),
      input: {
        kind: 'text',
        text: JSON.stringify({
          sourceLanguage: languageDisplayName(input.language),
          spokenScript: script,
          instruction: 'Write a concise English summary of this voiceover for the channel owner.',
        }),
      },
    });

    return extractEnglishSummaryText(result.output);
  }

  // ── Usage stats ───────────────────────────────────────────────────────────

  async getUsageStats(filters?: {
    providerId?: string;
    since?: Date;
    until?: Date;
  }): Promise<{
    totalCalls: number;
    cacheHits: number;
    totalTokensIn: number;
    totalTokensOut: number;
    estimatedCostUsd: number;
  }> {
    const where: Prisma.AiUsageLogWhereInput = {};
    if (filters?.providerId) where.providerId = filters.providerId;
    if (filters?.since || filters?.until) {
      where.createdAt = {};
      if (filters?.since) where.createdAt.gte = filters.since;
      if (filters?.until) where.createdAt.lte = filters.until;
    }

    const [agg, cacheHitCount] = await Promise.all([
      this.prisma.client.aiUsageLog.aggregate({
        where,
        _count: true,
        _sum: { tokensIn: true, tokensOut: true, estimatedCostUsd: true },
      }),
      this.prisma.client.aiUsageLog.count({ where: { ...where, cacheHit: true } }),
    ]);

    return {
      totalCalls: agg._count,
      cacheHits: cacheHitCount,
      totalTokensIn: agg._sum.tokensIn ?? 0,
      totalTokensOut: agg._sum.tokensOut ?? 0,
      estimatedCostUsd: Number(agg._sum.estimatedCostUsd ?? 0),
    };
  }

  // ── Visual style analysis from a reference video ────────────────────────

  /**
   * Watch an uploaded reference clip and return production visual/editing DNA
   * the owner can paste into Brand → Visuals.
   */
  async analyzeVisualStyle(opts: {
    filePath: string;
    mimeType: string;
    filename: string;
  }): Promise<{ visualStyle: string }> {
    const task = TaskType.VIDEO_ANALYSIS;
    await this.assertNotKilled(task);

    const { stat, readFile } = await import('node:fs/promises');
    const size = (await stat(opts.filePath)).size;
    const maxBytes = 80 * 1024 * 1024;
    if (size <= 0) throw new BadRequestException('Empty video file.');
    if (size > maxBytes) {
      throw new BadRequestException(
        'Reference video is too large (max 80 MB). Upload a 20–90 second clip of the look you want.',
      );
    }

    const keyStore = new PrismaKeyStore(this.prisma.client, this.crypto);
    const pool = new KeyPool(keyStore);
    let key;
    try {
      key = await pool.checkout('gemini');
    } catch (err) {
      if (err instanceof NoKeyAvailableError) {
        throw new BadRequestException(
          err.reason === 'no keys configured'
            ? 'Gemini key pool is empty. The same Settings → AI Gemini keys used for Generate prompt are required here.'
            : `Gemini keys are all throttled or exhausted (${err.reason}). Retry shortly.`,
        );
      }
      throw err;
    }

    const mime = opts.mimeType || 'video/mp4';
    const inlineCap = 13 * 1024 * 1024;
    let parts: Array<{ text?: string; uri?: string; data?: string; mimeType?: string }> = [];
    let uploadedName: string | null = null;

    if (size <= inlineCap) {
      const buf = await readFile(opts.filePath);
      parts = [{ data: buf.toString('base64'), mimeType: mime }];
    } else {
      const uploaded = await uploadGeminiFile({
        apiKey: key.secret,
        filePath: opts.filePath,
        mimeType: mime,
        displayName: `style-ref-${opts.filename.slice(0, 40)}`,
      });
      uploadedName = uploaded.name;
      parts = [{ uri: uploaded.uri, mimeType: uploaded.mimeType || mime }];
    }

    const schema = z.object({ visualStyle: z.string().min(40) });
    const gemini = new GeminiProvider();
    try {
      const result = await gemini.generate(
        {
          task,
          model: '',
          system: `You are an elite editorial art director and motion-graphics supervisor.
Watch the reference video. Reverse-engineer its LOOK so another AI can recreate the same visual language on NEW topics (not a copy of this story).
Return JSON only: { "visualStyle": string }.
visualStyle must be a production-ready English brief (400–1200 words) with these headings:
LOOK / MEDIUM (2D cartoon, 3D CGI, photoreal, collage, motion graphics, etc.)
COLOR / LIGHTING
CAMERA LANGUAGE
EDITING PACE (cut rhythm, impact hits, holds)
GRAPHICS / TYPE / UI overlays
MOTION / ANIMATION (how stills should move; timed beats if relevant)
CHARACTER / SUBJECT treatment
SOUND DESIGN in prompts (SFX/music only — VO is external)
NEGATIVES / what this style never does
PROMPT DNA: one reusable SCENE / STYLE / FRAMING / LIGHTING / MOTION / CLOSER template
Write as imperative rules. Do not retell the video's plot. Do not mention stock footage or live camera plates unless the look is explicitly photoreal AI.`,
          input: {
            kind: 'multimodal',
            parts: [
              ...parts,
              {
                text: 'Analyze this reference video and fill visualStyle as specified.',
              },
            ],
          },
          schema,
        },
        { id: key.id, providerId: 'gemini', secret: key.secret, label: key.label },
      );
      await pool.recordSuccess(
        key,
        (result.usage.tokensIn ?? 0) + (result.usage.tokensOut ?? 0),
      );
      const parsed = schema.safeParse(result.output);
      if (parsed.success) return { visualStyle: parsed.data.visualStyle.trim() };
      if (typeof result.output === 'string' && result.output.trim().length >= 40) {
        return { visualStyle: result.output.trim() };
      }
      throw new BadRequestException('AI did not return a usable visual style. Try a clearer clip.');
    } finally {
      if (uploadedName) {
        await deleteGeminiFile({ apiKey: key.secret, name: uploadedName }).catch(() => undefined);
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildRegistry(): ProviderRegistry {
    const providers = new Map<string, AIProviderInterface>();
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
      chainFor: (task: TaskType) => chains[task as string] ?? ['gemini'],
    };
  }

  private async getProviderOrThrow(id: string): Promise<AiProvider> {
    const p = await this.prisma.client.aiProvider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('AI provider not found');
    return p;
  }

  private async getKeyOrThrow(id: string): Promise<AiKey> {
    const k = await this.prisma.client.aiKey.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('AI key not found');
    return k;
  }

  private async getProviderView(id: string): Promise<AiProviderView> {
    const providers = await this.listProviders();
    const found = providers.find((p) => p.id === id);
    if (!found) throw new NotFoundException('AI provider not found');
    return found;
  }

  // ── Edge Neural TTS ─────────────────────────────────────────────────────

  async getTtsStatus(): Promise<{
    ok: boolean;
    source: string;
    detail: string;
    versionHint: string;
    defaultProvider: string;
  }> {
    const diag = await diagnoseEdgeTts();
    return {
      ok: diag.ok,
      source: diag.binary.source,
      detail: diag.binary.detail,
      versionHint: diag.versionHint,
      defaultProvider: 'edge',
    };
  }

  async listTtsVoices(opts?: {
    locale?: string;
    forceRefresh?: boolean;
  }): Promise<{ voices: EdgeVoiceInfo[]; cached: boolean; locale: string | null }> {
    try {
      const voices = await listEdgeVoices({
        locale: opts?.locale,
        forceRefresh: opts?.forceRefresh,
      });
      return {
        voices,
        cached: !opts?.forceRefresh,
        locale: opts?.locale ?? null,
      };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Failed to list Edge TTS voices',
      );
    }
  }

  async previewTts(dto: TtsPreviewDto): Promise<{
    voiceId: string;
    mimeType: string;
    audioBase64: string;
    timings: Array<{ startMs: number; endMs: number; text: string }>;
  }> {
    const text =
      dto.text?.trim() ||
      'Hello from Social Creator Pilot. This is a short voice preview.';
    try {
      const synth = await synthesizeWithEdgeTts(text, {
        voice: dto.voiceId,
        rate: dto.rate,
        pitch: dto.pitch,
        volume: dto.volume,
        emotion: dto.emotion,
        writeSubtitles: true,
      });
      const buf = await readFile(synth.mediaPath);
      // Clean temp dir owned by synthesizeWithEdgeTts when outDir was default.
      await rm(dirname(synth.mediaPath), { recursive: true, force: true }).catch(() => {});
      return {
        voiceId: dto.voiceId,
        mimeType: 'audio/mpeg',
        audioBase64: buf.toString('base64'),
        timings: synth.timings,
      };
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Edge TTS preview failed',
      );
    }
  }
}
