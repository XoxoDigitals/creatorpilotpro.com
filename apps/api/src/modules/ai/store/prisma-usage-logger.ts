import type { UsageLogger } from '@scp/ai-providers';
import type { AIErrorClass } from '@scp/ai-providers';
import type { TaskType } from '@scp/shared';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export class PrismaUsageLogger implements UsageLogger {
  constructor(private readonly prisma: PrismaClient) {}

  async log(entry: {
    task: TaskType;
    providerId?: string;
    keyId?: string;
    model: string;
    contentItemId?: string;
    cacheHit: boolean;
    tokensIn?: number;
    tokensOut?: number;
    ttsSeconds?: number;
    estimatedCostUsd?: number;
    errorClass?: AIErrorClass;
    latencyMs?: number;
  }): Promise<void> {
    await this.prisma.aiUsageLog.create({
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
        estimatedCostUsd:
          entry.estimatedCostUsd !== undefined
            ? new Decimal(entry.estimatedCostUsd.toFixed(6))
            : undefined,
        errorClass: entry.errorClass,
        latencyMs: entry.latencyMs,
      },
    });
  }
}
