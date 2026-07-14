import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { AiKey, AiKeyStatus, AiProvider, Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import type { CreateKeyDto } from './dto/ai.dto';

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
  ) {}

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

  /** Swap priority with the adjacent key in the same provider (up/down buttons). */
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
