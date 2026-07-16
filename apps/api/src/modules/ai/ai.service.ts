import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AiKey, AiKeyStatus, AiProvider, Prisma } from '@scp/db';
import type { TaskType } from '@scp/shared';
import {
  AIRouter,
  KeyPool,
  GeminiProvider,
  OpenAIProvider,
  KokoroProvider,
  WhisperProvider,
  cacheKeyFor,
  hashText,
  type AIResult,
  type CacheStore,
  type UsageLogger,
  type ProviderRegistry,
  type AIProvider as AIProviderInterface,
} from '@scp/ai-providers';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../system/settings.service';
import { PrismaKeyStore } from './store/prisma-key-store';
import type { CreateKeyDto, PlaygroundDto } from './dto/ai.dto';

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
}
