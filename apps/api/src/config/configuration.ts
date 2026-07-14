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
  };
}

export type AppConfig = ReturnType<typeof configuration>;
