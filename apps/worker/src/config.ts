/** Worker runtime config read from env (docs/02 — pg-boss lives in Postgres). */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

// The single .env lives at the repo root; cwd is apps/worker under
// `turbo run dev` but the repo root under pm2. Load the first match.
for (const candidate of ['.env', '../../.env']) {
  const path = resolve(process.cwd(), candidate);
  if (existsSync(path)) {
    loadEnv({ path, quiet: true });
    break;
  }
}

/**
 * Read lazily (only when the worker actually boots) so that building/importing
 * this module never requires a live database.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to start the worker (pg-boss runs on Postgres).');
  }
  return url;
}

export function getDefaultConcurrency(): number {
  return Number(process.env.WORKER_CONCURRENCY ?? '4');
}

/**
 * Storage hot-tier root (env STORAGE_ROOT) — where downloaded/processed media is
 * written. Read lazily so importing this module never requires it; the ingestion
 * processors call it only when they actually touch disk.
 */
export function getStorageRoot(): string {
  const root = process.env.STORAGE_ROOT;
  if (!root) {
    throw new Error('STORAGE_ROOT is required for media ingestion (download/process).');
  }
  return root;
}
