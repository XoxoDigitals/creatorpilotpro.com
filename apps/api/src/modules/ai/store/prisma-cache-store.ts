import type { CacheStore } from '@scp/ai-providers';
import type { AIResult } from '@scp/ai-providers';
import type { TaskType } from '@scp/shared';
import type { PrismaClient } from '@prisma/client';

export class PrismaCacheStore implements CacheStore {
  constructor(private readonly prisma: PrismaClient) {}

  async lookup(cacheKey: string): Promise<AIResult | null> {
    const row = await this.prisma.aiOutput.findUnique({ where: { cacheKey } });
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
  }

  async save(
    cacheKey: string,
    entry: {
      task: TaskType;
      providerId: string;
      model: string;
      output: unknown;
      audioRef?: string;
      tokensIn?: number;
      tokensOut?: number;
      ttsSeconds?: number;
      contentItemId?: string;
    },
  ): Promise<void> {
    await this.prisma.aiOutput.upsert({
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
  }

  async recordHit(cacheKey: string): Promise<void> {
    await this.prisma.aiOutput.update({
      where: { cacheKey },
      data: {
        hitCount: { increment: 1 },
        lastHitAt: new Date(),
      },
    });
  }
}
