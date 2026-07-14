import { BadRequestException, Injectable } from '@nestjs/common';
import { z, type ZodSchema } from 'zod';
import type { Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

/**
 * Whitelisted system settings (docs/03 Domain 8). Only these keys are writable
 * via the API; each has a Zod schema. `secret: true` values are encrypted at
 * rest and NEVER returned to the client (docs/08 §2) — the UI sees only a
 * "configured" flag; adapters read the decrypted value server-side.
 */
interface SettingSpec {
  schema: ZodSchema;
  secret: boolean;
}

const SETTINGS_WHITELIST: Record<string, SettingSpec> = {
  'tts.default': {
    schema: z.object({
      provider: z.string(),
      voiceId: z.string().optional(),
      speed: z.number().optional(),
      language: z.string().optional(),
    }),
    secret: false,
  },
  killSwitches: {
    schema: z.record(z.string(), z.boolean()),
    secret: false,
  },
  'storage.thresholds': {
    schema: z.object({ warnPercent: z.number(), evictPercent: z.number() }),
    secret: false,
  },
  'notifications.telegram': {
    schema: z.object({ botToken: z.string().optional(), chatId: z.string().optional() }),
    secret: true,
  },
  'notifications.smtp': {
    schema: z.object({
      url: z.string().optional(),
      from: z.string().optional(),
    }),
    secret: true,
  },
};

export interface SettingView {
  key: string;
  value?: Prisma.JsonValue;
  secret: boolean;
  configured: boolean;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** List all whitelisted settings; secret values are masked (docs/08 §2). */
  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.client.systemSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r.value]));

    return Object.entries(SETTINGS_WHITELIST).map(([key, spec]) => {
      const stored = byKey.get(key);
      const configured = stored != null;
      if (spec.secret) {
        return { key, secret: true, configured };
      }
      return { key, secret: false, configured, value: stored ?? null };
    });
  }

  async put(key: string, value: unknown): Promise<SettingView> {
    const spec = SETTINGS_WHITELIST[key];
    if (!spec) throw new BadRequestException(`Unknown setting key: ${key}`);

    const parsed = spec.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({
        message: `Invalid value for ${key}`,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const stored: Prisma.InputJsonValue = spec.secret
      ? { __enc: this.crypto.encrypt(JSON.stringify(parsed.data)) }
      : (parsed.data as Prisma.InputJsonValue);

    await this.prisma.client.systemSetting.upsert({
      where: { key },
      update: { value: stored },
      create: { key, value: stored },
    });

    return spec.secret
      ? { key, secret: true, configured: true }
      : { key, secret: false, configured: true, value: parsed.data as Prisma.JsonValue };
  }

  /**
   * Server-side read of a setting's decrypted value (for notification adapters).
   * Returns undefined if unset.
   */
  async getDecrypted<T = unknown>(key: string): Promise<T | undefined> {
    const spec = SETTINGS_WHITELIST[key];
    if (!spec) return undefined;
    const row = await this.prisma.client.systemSetting.findUnique({ where: { key } });
    if (!row) return undefined;

    if (spec.secret) {
      const wrapped = row.value as { __enc?: string } | null;
      if (!wrapped?.__enc) return undefined;
      return JSON.parse(this.crypto.decrypt(wrapped.__enc)) as T;
    }
    return row.value as T;
  }
}
