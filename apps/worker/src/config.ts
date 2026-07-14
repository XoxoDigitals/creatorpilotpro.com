/** Worker runtime config read from env (docs/02 — pg-boss lives in Postgres). */

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

export const DEFAULT_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? '4');
