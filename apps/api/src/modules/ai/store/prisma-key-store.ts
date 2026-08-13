import type { KeyState, KeyStore } from '@scp/ai-providers';
import type { PrismaClient } from '@prisma/client';
import type { CryptoService } from '../../../common/crypto/crypto.service';

export class PrismaKeyStore implements KeyStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly crypto: CryptoService,
  ) {}

  async listByProvider(providerId: string): Promise<KeyState[]> {
    // `providerId` is the provider slug ("gemini"), not the ai_providers cuid —
    // match on the relation's name, not the raw FK.
    const rows = await this.prisma.aiKey.findMany({
      where: { provider: { name: providerId }, status: { not: 'DISABLED' } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      providerId,
      secret: this.crypto.decrypt(r.keyEnc),
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
  }

  async recordSuccess(
    keyId: string,
    patch: {
      tokensUsed: number;
      minuteWindowStartAt: Date;
      dayWindowStartAt: Date;
      requestsInMinute: number;
      tokensInMinute: number;
      requestsInDay: number;
      lastUsedAt: Date;
    },
  ): Promise<void> {
    await this.prisma.aiKey.update({
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
  }

  async recordStatus(
    keyId: string,
    patch: { status: KeyState['status']; cooldownUntil?: Date | null },
  ): Promise<void> {
    await this.prisma.aiKey.update({
      where: { id: keyId },
      data: {
        status: patch.status,
        ...(patch.cooldownUntil !== undefined ? { cooldownUntil: patch.cooldownUntil } : {}),
      },
    });
  }
}
