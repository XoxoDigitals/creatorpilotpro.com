import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Environment validation (docs/02 — config module reading .env).
 * Secrets/URLs are optional at boot so the app can build/start in Phase 0
 * without a live database. Later phases tighten these where required.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  APP_VERSION: z.string().default('0.0.0'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().optional(),
  MASTER_KEY: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  // Public web origin (used to build OAuth redirect URIs + post-connect redirects).
  // The browser reaches the API through the web's same-origin /api rewrite, so
  // OAuth redirect URIs live under the web origin and stay first-party.
  WEB_APP_URL: z.string().default('http://localhost:3000'),
  // Local hot-tier storage root (docs/02 §6). Absolute paths are stored on
  // assets so the worker reads the exact file the API wrote (shared filesystem).
  STORAGE_ROOT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  return envSchema.parse(config);
}

/** Typed config namespace consumed via ConfigService. */
export function configuration() {
  const env = validateEnv(process.env);
  return {
    nodeEnv: env.NODE_ENV,
    port: env.API_PORT,
    host: env.API_HOST,
    version: env.APP_VERSION,
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()),
    databaseUrl: env.DATABASE_URL,
    masterKey: env.MASTER_KEY,
    sessionSecret: env.SESSION_SECRET,
    webAppUrl: env.WEB_APP_URL.replace(/\/$/, ''),
    storageRoot: env.STORAGE_ROOT
      ? resolve(env.STORAGE_ROOT)
      : resolve(process.cwd(), '.data'),
    isProduction: env.NODE_ENV === 'production',
  };
}

export type AppConfig = ReturnType<typeof configuration>;
