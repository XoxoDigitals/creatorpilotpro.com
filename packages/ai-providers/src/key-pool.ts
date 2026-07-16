import type { AIErrorClass } from './types.js';

/**
 * Key pool selection + state transitions (docs/05 §4). Kept storage-agnostic
 * behind a small `KeyStore` port so the pool is unit-testable without the DB
 * and reusable from the API playground path (single request, no persistence)
 * as well as the worker (real Prisma-backed store).
 */

/** Per-key headroom limits (docs/05 §4). All optional; missing = unbounded. */
export interface KeyLimits {
  rpm?: number;
  rpd?: number;
  tpm?: number;
}

/** Rolling window state kept on each key row (mirrors AiKey schema). */
export interface KeyState {
  id: string;
  providerId: string;
  secret: string;
  label?: string;
  status: 'ACTIVE' | 'COOLDOWN' | 'EXHAUSTED' | 'DISABLED';
  cooldownUntil: Date | null;
  limits: KeyLimits;
  minuteWindowStartAt: Date | null;
  requestsInMinute: number;
  tokensInMinute: number;
  dayWindowStartAt: Date | null;
  requestsInDay: number;
  lastUsedAt: Date | null;
}

export interface KeyStore {
  /** Load every non-DISABLED key for a provider. Small set — no pagination. */
  listByProvider(providerId: string): Promise<KeyState[]>;
  /** Persist counter + lastUsedAt bumps. */
  recordSuccess(keyId: string, patch: {
    tokensUsed: number;
    minuteWindowStartAt: Date;
    dayWindowStartAt: Date;
    requestsInMinute: number;
    tokensInMinute: number;
    requestsInDay: number;
    lastUsedAt: Date;
  }): Promise<void>;
  /** Apply a status transition (COOLDOWN with `until`, EXHAUSTED, DISABLED). */
  recordStatus(keyId: string, patch: {
    status: KeyState['status'];
    cooldownUntil?: Date | null;
  }): Promise<void>;
}

export class NoKeyAvailableError extends Error {
  constructor(public readonly providerId: string, public readonly reason: string) {
    super(`No usable key for provider "${providerId}": ${reason}`);
    this.name = 'NoKeyAvailableError';
  }
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Same UTC day (compared by 24h window start rather than calendar date). */
function sameDay(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / DAY_MS) === Math.floor(b.getTime() / DAY_MS);
}

/**
 * Roll window counters forward against `now`. If the window has elapsed the
 * counters reset; otherwise they are carried through unchanged. Pure — never
 * touches the store, so it composes with the selection filter.
 */
export function rollWindows(key: KeyState, now: Date): {
  minuteWindowStartAt: Date;
  requestsInMinute: number;
  tokensInMinute: number;
  dayWindowStartAt: Date;
  requestsInDay: number;
} {
  const minuteStart =
    key.minuteWindowStartAt && now.getTime() - key.minuteWindowStartAt.getTime() < MINUTE_MS
      ? key.minuteWindowStartAt
      : now;
  const dayStart =
    key.dayWindowStartAt && sameDay(key.dayWindowStartAt, now)
      ? key.dayWindowStartAt
      : now;
  return {
    minuteWindowStartAt: minuteStart,
    requestsInMinute: minuteStart === key.minuteWindowStartAt ? key.requestsInMinute : 0,
    tokensInMinute: minuteStart === key.minuteWindowStartAt ? key.tokensInMinute : 0,
    dayWindowStartAt: dayStart,
    requestsInDay: dayStart === key.dayWindowStartAt ? key.requestsInDay : 0,
  };
}

/** True if the key has headroom for one more request under its configured limits. */
export function hasHeadroom(key: KeyState, now: Date): boolean {
  const rolled = rollWindows(key, now);
  const { rpm, rpd, tpm } = key.limits;
  if (rpm !== undefined && rolled.requestsInMinute + 1 > rpm) return false;
  if (rpd !== undefined && rolled.requestsInDay + 1 > rpd) return false;
  if (tpm !== undefined && rolled.tokensInMinute >= tpm) return false;
  return true;
}

/**
 * Rank comparator: least-recently-used first, tie-broken by cuid (stable across
 * process restarts, so behavior is reproducible). Never-used keys come first.
 */
function lruCompare(a: KeyState, b: KeyState): number {
  const aT = a.lastUsedAt?.getTime() ?? 0;
  const bT = b.lastUsedAt?.getTime() ?? 0;
  if (aT !== bT) return aT - bT;
  return a.id.localeCompare(b.id);
}

export class KeyPool {
  constructor(private readonly store: KeyStore) {}

  /**
   * Pick a usable key for the provider: ACTIVE (or COOLDOWN whose window has
   * passed), with headroom in every configured limit, least-recently-used first.
   * EXHAUSTED keys reactivate when their day window rolls; DISABLED stays out.
   */
  async checkout(providerId: string, now: Date = new Date()): Promise<KeyState> {
    const all = await this.store.listByProvider(providerId);
    if (all.length === 0) {
      throw new NoKeyAvailableError(providerId, 'no keys configured');
    }

    const eligible: KeyState[] = [];
    for (const key of all) {
      if (key.status === 'DISABLED') continue;
      if (key.status === 'COOLDOWN' && key.cooldownUntil && key.cooldownUntil > now) continue;
      if (key.status === 'EXHAUSTED') {
        // Auto-clear when the day window has rolled over.
        if (key.dayWindowStartAt && sameDay(key.dayWindowStartAt, now)) continue;
      }
      if (!hasHeadroom(key, now)) continue;
      eligible.push(key);
    }
    if (eligible.length === 0) {
      throw new NoKeyAvailableError(providerId, `all ${all.length} key(s) throttled or exhausted`);
    }

    eligible.sort(lruCompare);
    return eligible[0]!;
  }

  /** Bump counters + lastUsedAt after a successful provider call. */
  async recordSuccess(key: KeyState, tokensUsed: number, now: Date = new Date()): Promise<void> {
    const rolled = rollWindows(key, now);
    await this.store.recordSuccess(key.id, {
      tokensUsed,
      minuteWindowStartAt: rolled.minuteWindowStartAt,
      dayWindowStartAt: rolled.dayWindowStartAt,
      requestsInMinute: rolled.requestsInMinute + 1,
      tokensInMinute: rolled.tokensInMinute + Math.max(0, tokensUsed),
      requestsInDay: rolled.requestsInDay + 1,
      lastUsedAt: now,
    });
  }

  /**
   * Apply the error-class → status transitions from docs/05 §4:
   *   RATE_LIMITED   → COOLDOWN(now + retryAfter | 60s)
   *   QUOTA_EXHAUSTED→ EXHAUSTED (auto-clears on next day roll)
   *   INVALID_KEY    → DISABLED (owner is notified via incident at the router)
   *   TRANSIENT/FATAL/CONTENT_BLOCKED → no state change (caller decides retry/rotate)
   */
  async recordError(keyId: string, cls: AIErrorClass, retryAfterSec?: number): Promise<void> {
    if (cls === 'RATE_LIMITED') {
      const until = new Date(Date.now() + Math.max(1, retryAfterSec ?? 60) * 1000);
      await this.store.recordStatus(keyId, { status: 'COOLDOWN', cooldownUntil: until });
      return;
    }
    if (cls === 'QUOTA_EXHAUSTED') {
      await this.store.recordStatus(keyId, { status: 'EXHAUSTED', cooldownUntil: null });
      return;
    }
    if (cls === 'INVALID_KEY') {
      await this.store.recordStatus(keyId, { status: 'DISABLED', cooldownUntil: null });
      return;
    }
    // TRANSIENT / FATAL / CONTENT_BLOCKED — no key-state change.
  }
}
