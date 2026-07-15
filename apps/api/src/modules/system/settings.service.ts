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

  // --- Platform Apps (docs mission §3) — owner-supplied provider credentials.
  // Secret object settings: partial-merge on write (blank fields keep the stored
  // value) and a per-field last-4 preview is kept in clear for the UI.
  'platform_apps.postqued': {
    schema: z.object({
      apiKey: z.string().optional(),
      workspaceId: z.string().optional(),
    }),
    secret: true,
  },
  'platform_apps.google': {
    schema: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      directUpload: z.boolean().optional(),
    }),
    secret: true,
  },
  'platform_apps.meta': {
    schema: z.object({
      appId: z.string().optional(),
      appSecret: z.string().optional(),
    }),
    secret: true,
  },
  'platform_apps.tiktok': {
    schema: z.object({
      clientKey: z.string().optional(),
      clientSecret: z.string().optional(),
    }),
    secret: true,
  },

  // Demo data toggle (docs mission §4). Default ON until real accounts exist.
  demo_mode: {
    schema: z.object({ enabled: z.boolean() }),
    secret: false,
  },
};

/** Secret string fields whose last-4 we keep in clear for the UI preview. */
const SECRET_STRING_FIELDS = new Set([
  'apiKey',
  'workspaceId',
  'clientId',
  'clientSecret',
  'appId',
  'appSecret',
  'clientKey',
  'botToken',
  'chatId',
  'url',
  'from',
]);

export interface SettingView {
  key: string;
  value?: Prisma.JsonValue;
  secret: boolean;
  configured: boolean;
  /** For secret object settings: per-field last-4 of stored string values. */
  preview?: Record<string, string>;
}

/** Last-4 preview for each secret string field present in an object value. */
function previewOf(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0 && SECRET_STRING_FIELDS.has(k)) {
        out[k] = v.slice(-4);
      }
    }
  }
  return out;
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
        const wrapped = stored as { __preview?: Record<string, string> } | null;
        return { key, secret: true, configured, preview: wrapped?.__preview ?? {} };
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

    if (!spec.secret) {
      await this.prisma.client.systemSetting.upsert({
        where: { key },
        update: { value: parsed.data as Prisma.InputJsonValue },
        create: { key, value: parsed.data as Prisma.InputJsonValue },
      });
      return { key, secret: false, configured: true, value: parsed.data as Prisma.JsonValue };
    }

    // Secret object setting: partial-merge over the existing decrypted value so
    // blank fields don't wipe stored secrets ("paste once"). Empty strings and
    // undefined are ignored; booleans always apply.
    const existing = (await this.getDecrypted<Record<string, unknown>>(key)) ?? {};
    const incoming = parsed.data as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      if (v === undefined) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      merged[k] = v;
    }

    const stored: Prisma.InputJsonValue = {
      __enc: this.crypto.encrypt(JSON.stringify(merged)),
      __preview: previewOf(merged),
    };
    await this.prisma.client.systemSetting.upsert({
      where: { key },
      update: { value: stored },
      create: { key, value: stored },
    });

    return { key, secret: true, configured: true, preview: previewOf(merged) };
  }

  /** Demo-data toggle (docs mission §4). Defaults ON until explicitly disabled. */
  async getDemoMode(): Promise<{ enabled: boolean }> {
    const row = await this.prisma.client.systemSetting.findUnique({ where: { key: 'demo_mode' } });
    const value = row?.value as { enabled?: boolean } | null;
    return { enabled: value?.enabled ?? true };
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
