/**
 * AI router (docs/05 §2, §4–5). One entry point for every feature that wants
 * AI: it looks up the cache, iterates the task's provider chain, checks out a
 * key from the pool, calls the adapter, validates the structured output, logs
 * usage/cost, and rotates on failure per the error matrix.
 *
 * Storage-agnostic behind small ports (CacheStore + UsageLogger) so it composes
 * from the worker (Prisma-backed) and the API playground (in-memory / one-shot)
 * with the same code path.
 */
import type { TaskType } from '@scp/shared';
import type { AIProvider, AIRequest, AIResult, AIErrorClass } from './types.js';
import type { KeyState } from './key-pool.js';
import { KeyPool, NoKeyAvailableError } from './key-pool.js';

/** Deterministic content cache (docs/05 §5). */
export interface CacheStore {
  lookup(cacheKey: string): Promise<AIResult | null>;
  save(cacheKey: string, entry: {
    task: TaskType;
    providerId: string;
    model: string;
    output: unknown;
    audioRef?: string;
    tokensIn?: number;
    tokensOut?: number;
    ttsSeconds?: number;
    contentItemId?: string;
  }): Promise<void>;
  /** Bump hitCount/lastHitAt (docs/05 §8 cost dashboard). */
  recordHit(cacheKey: string): Promise<void>;
}

/** One log row per provider call (or cache hit) — feeds FR-C7. */
export interface UsageLogger {
  log(entry: {
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
  }): Promise<void>;
}

/** Rate-card lookup: {tokensIn, tokensOut} → USD estimate (docs/05 §8). */
export type CostEstimator = (providerId: string, model: string, usage: {
  tokensIn?: number;
  tokensOut?: number;
  ttsSeconds?: number;
}) => number | undefined;

/**
 * Registry of providers by id, with the chain resolved per task type. Chain
 * entries name providers (`"gemini"`, `"openai"`, `"kokoro"`); the router
 * iterates in order and stops at the first success.
 */
export interface ProviderRegistry {
  get(providerId: string): AIProvider | undefined;
  chainFor(task: TaskType): string[];
}

export interface RouterOptions {
  cache: CacheStore;
  logger: UsageLogger;
  keyPool: KeyPool;
  registry: ProviderRegistry;
  estimateCost?: CostEstimator;
  /** How many times to retry a TRANSIENT error on the same key before rotating. */
  transientRetries?: number;
}

export interface RunInput extends AIRequest {
  cacheKey?: string;
  contentItemId?: string;
}

export class AllProvidersExhaustedError extends Error {
  constructor(
    public readonly task: TaskType,
    public readonly attempts: Array<{ providerId: string; error: string; errorClass?: AIErrorClass }>,
  ) {
    super(`All providers exhausted for task ${task} — tried ${attempts.map((a) => a.providerId).join(', ')}`);
    this.name = 'AllProvidersExhaustedError';
  }

  /** True when every attempt failed with a class that's expected to clear on its own. */
  get allTransient(): boolean {
    return (
      this.attempts.length > 0 &&
      this.attempts.every(
        (a) => a.errorClass === 'TRANSIENT' || a.errorClass === 'RATE_LIMITED' || a.errorClass === 'QUOTA_EXHAUSTED',
      )
    );
  }
}

/** Wall-clock helper; injectable for tests. */
export type Clock = () => Date;

/**
 * Route one AI request through cache → pool → provider chain. Returns the
 * validated result. Persistence + rotation stay off the hot path when the
 * cache serves the answer.
 */
export class AIRouter {
  private readonly transientRetries: number;

  constructor(private readonly opts: RouterOptions, private readonly now: Clock = () => new Date()) {
    // 4 same-key retries → up to 30s of backoff before rotating providers.
    // Google's Gemini Flash models return 503 "high demand" spikes that clear
    // within tens of seconds; the old 2-retry / sub-second budget bailed too fast.
    this.transientRetries = opts.transientRetries ?? 4;
  }

  async run(input: RunInput): Promise<AIResult> {
    // ── Cache lookup ─────────────────────────────────────────────────────────
    if (input.cacheKey) {
      const hit = await this.opts.cache.lookup(input.cacheKey);
      if (hit) {
        await this.opts.cache.recordHit(input.cacheKey);
        await this.opts.logger.log({
          task: input.task,
          model: hit.model || input.model,
          ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
          cacheHit: true,
        });
        return { ...hit, cached: true };
      }
    }

    // ── Provider chain ───────────────────────────────────────────────────────
    const chain = this.opts.registry.chainFor(input.task);
    const attempts: Array<{ providerId: string; error: string; errorClass?: AIErrorClass }> = [];

    for (const providerId of chain) {
      const provider = this.opts.registry.get(providerId);
      if (!provider) {
        attempts.push({ providerId, error: 'provider not registered' });
        continue;
      }
      if (!provider.supports.includes(input.task)) {
        attempts.push({ providerId, error: `does not support ${input.task}` });
        continue;
      }
      try {
        const result = await this.callWithRotation(provider, input);
        if (input.cacheKey) {
          await this.opts.cache.save(input.cacheKey, {
            task: input.task,
            providerId,
            model: result.model,
            output: result.output,
            ...(result.audioRef ? { audioRef: result.audioRef } : {}),
            ...(result.usage.tokensIn !== undefined ? { tokensIn: result.usage.tokensIn } : {}),
            ...(result.usage.tokensOut !== undefined ? { tokensOut: result.usage.tokensOut } : {}),
            ...(result.usage.ttsSeconds !== undefined ? { ttsSeconds: result.usage.ttsSeconds } : {}),
            ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
          });
        }
        return result;
      } catch (err) {
        // Best-effort: classify so the outer caller can decide job-level retry.
        let errorClass: AIErrorClass | undefined;
        try {
          errorClass = provider.classifyError(err);
        } catch {
          /* provider without classifyError — leave undefined */
        }
        attempts.push({
          providerId,
          error: err instanceof Error ? err.message : String(err),
          ...(errorClass ? { errorClass } : {}),
        });
      }
    }

    throw new AllProvidersExhaustedError(input.task, attempts);
  }

  /**
   * Try one provider, rotating through its key pool on RATE_LIMITED /
   * QUOTA_EXHAUSTED / INVALID_KEY. Same-key retries only for TRANSIENT; a FATAL
   * or CONTENT_BLOCKED aborts this provider (the outer loop moves on).
   */
  private async callWithRotation(provider: AIProvider, input: RunInput): Promise<AIResult> {
    const keyless = provider.requiresKey === false;
    for (let rotations = 0; rotations < 32; rotations++) {
      let key: KeyState;
      try {
        if (keyless) {
          // Self-hosted / CLI providers (edge, kokoro, whisper) — no vault key.
          key = {
            id: `${provider.id}:local`,
            providerId: provider.id,
            secret: '',
            status: 'ACTIVE',
            cooldownUntil: null,
            limits: {},
            minuteWindowStartAt: null,
            requestsInMinute: 0,
            tokensInMinute: 0,
            dayWindowStartAt: null,
            requestsInDay: 0,
            lastUsedAt: null,
          };
        } else {
          key = await this.opts.keyPool.checkout(provider.id, this.now());
        }
      } catch (err) {
        if (err instanceof NoKeyAvailableError) throw err;
        throw err;
      }

      let transientAttempts = 0;
      while (true) {
        const started = Date.now();
        try {
          const result = await provider.generate(input, key);
          const latencyMs = Date.now() - started;
          if (!keyless) {
            await this.opts.keyPool.recordSuccess(
              key,
              (result.usage.tokensIn ?? 0) + (result.usage.tokensOut ?? 0),
              this.now(),
            );
          }
          const cost = this.opts.estimateCost?.(provider.id, result.model, result.usage);
          await this.opts.logger.log({
            task: input.task,
            providerId: provider.id,
            keyId: key.id,
            model: result.model,
            ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
            cacheHit: false,
            ...(result.usage.tokensIn !== undefined ? { tokensIn: result.usage.tokensIn } : {}),
            ...(result.usage.tokensOut !== undefined ? { tokensOut: result.usage.tokensOut } : {}),
            ...(result.usage.ttsSeconds !== undefined ? { ttsSeconds: result.usage.ttsSeconds } : {}),
            ...(cost !== undefined ? { estimatedCostUsd: cost } : {}),
            latencyMs,
          });
          return result;
        } catch (err) {
          const cls = provider.classifyError(err);
          const latencyMs = Date.now() - started;
          await this.opts.logger.log({
            task: input.task,
            providerId: provider.id,
            keyId: key.id,
            model: input.model,
            ...(input.contentItemId ? { contentItemId: input.contentItemId } : {}),
            cacheHit: false,
            errorClass: cls,
            latencyMs,
          });

          if (cls === 'TRANSIENT' && transientAttempts < this.transientRetries) {
            transientAttempts++;
            // Exponential backoff (2s, 4s, 8s, 16s), or the server's Retry-After
            // hint capped to 30s — Google returns 503 "high demand" often, and
            // 400ms/800ms is far too aggressive to give the model time to recover.
            const backoff = 1000 * 2 ** transientAttempts;
            const retryAfter = extractRetryAfter(err);
            const waitMs = retryAfter ? Math.min(retryAfter * 1000, 30_000) : backoff;
            await sleep(waitMs);
            continue;
          }
          if (cls === 'RATE_LIMITED' || cls === 'QUOTA_EXHAUSTED' || cls === 'INVALID_KEY') {
            if (keyless) {
              // No keys to rotate — fail this provider so the outer chain continues.
              throw err;
            }
            const retryAfter = extractRetryAfter(err);
            await this.opts.keyPool.recordError(
              key.id,
              cls,
              ...(retryAfter !== undefined ? [retryAfter] as const : [] as const),
            );
            break; // rotate to the next key
          }
          // TRANSIENT budget exhausted, or FATAL / CONTENT_BLOCKED — this provider is done.
          throw err;
        }
      }
    }
    throw new Error(`Key rotation limit exceeded for provider ${provider.id}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Look for a Retry-After hint on a rate-limit error (SDKs surface it inconsistently). */
function extractRetryAfter(err: unknown): number | undefined {
  const e = err as { retryAfter?: unknown; headers?: Record<string, unknown> };
  const direct = typeof e.retryAfter === 'number' ? e.retryAfter : undefined;
  if (direct !== undefined) return direct;
  const header = e.headers?.['retry-after'] ?? e.headers?.['Retry-After'];
  if (typeof header === 'string') {
    const n = Number(header);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
