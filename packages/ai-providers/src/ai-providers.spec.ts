import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { TaskType } from '@scp/shared';
import { cacheKeyFor, hashText } from './cache-key.js';
import {
  KeyPool,
  NoKeyAvailableError,
  hasHeadroom,
  rollWindows,
  type KeyState,
  type KeyStore,
} from './key-pool.js';
import {
  AIRouter,
  AllProvidersExhaustedError,
  type CacheStore,
  type ProviderRegistry,
  type UsageLogger,
} from './router.js';
import { GeminiProvider } from './gemini.js';
import type { AIProvider, AIRequest, AIResult, PooledKey } from './types.js';

// ── cache-key ──────────────────────────────────────────────────────────────

describe('cacheKeyFor', () => {
  const base = {
    task: TaskType.VIDEO_ANALYSIS,
    model: 'gemini-2.5-flash',
    promptVersion: 1,
    styleVersion: 1,
    inputContentHash: 'md5abc',
  };

  it('is deterministic for the same inputs', () => {
    expect(cacheKeyFor(base)).toBe(cacheKeyFor(base));
  });

  it('changes when any part changes', () => {
    const seen = new Set([
      cacheKeyFor(base),
      cacheKeyFor({ ...base, model: 'gemini-2.5-pro' }),
      cacheKeyFor({ ...base, promptVersion: 2 }),
      cacheKeyFor({ ...base, styleVersion: 2 }),
      cacheKeyFor({ ...base, inputContentHash: 'md5def' }),
      cacheKeyFor({ ...base, task: TaskType.METADATA }),
    ]);
    expect(seen.size).toBe(6);
  });

  it('hashText is a 64-char sha256 hex string', () => {
    expect(hashText('hello')).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── key-pool ───────────────────────────────────────────────────────────────

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;
const NOW = new Date('2026-07-16T12:00:00Z');

function key(over: Partial<KeyState> = {}): KeyState {
  return {
    id: 'k1',
    providerId: 'gemini',
    secret: 'sk_...',
    status: 'ACTIVE',
    cooldownUntil: null,
    limits: {},
    minuteWindowStartAt: null,
    requestsInMinute: 0,
    tokensInMinute: 0,
    dayWindowStartAt: null,
    requestsInDay: 0,
    lastUsedAt: null,
    ...over,
  };
}

class MemoryKeyStore implements KeyStore {
  constructor(public keys: KeyState[]) {}
  async listByProvider(providerId: string): Promise<KeyState[]> {
    return this.keys.filter((k) => k.providerId === providerId);
  }
  async recordSuccess(id: string, patch: Parameters<KeyStore['recordSuccess']>[1]): Promise<void> {
    const k = this.keys.find((x) => x.id === id)!;
    k.requestsInMinute = patch.requestsInMinute;
    k.tokensInMinute = patch.tokensInMinute;
    k.requestsInDay = patch.requestsInDay;
    k.minuteWindowStartAt = patch.minuteWindowStartAt;
    k.dayWindowStartAt = patch.dayWindowStartAt;
    k.lastUsedAt = patch.lastUsedAt;
  }
  async recordStatus(id: string, patch: Parameters<KeyStore['recordStatus']>[1]): Promise<void> {
    const k = this.keys.find((x) => x.id === id)!;
    k.status = patch.status;
    k.cooldownUntil = patch.cooldownUntil ?? null;
  }
}

describe('rollWindows', () => {
  it('resets counters when the minute window has elapsed', () => {
    const k = key({
      minuteWindowStartAt: new Date(NOW.getTime() - MINUTE_MS - 1),
      requestsInMinute: 5,
      tokensInMinute: 999,
    });
    const rolled = rollWindows(k, NOW);
    expect(rolled.requestsInMinute).toBe(0);
    expect(rolled.tokensInMinute).toBe(0);
    expect(rolled.minuteWindowStartAt).toBe(NOW);
  });

  it('carries counters through a fresh minute window', () => {
    const start = new Date(NOW.getTime() - 30_000);
    const k = key({ minuteWindowStartAt: start, requestsInMinute: 5, tokensInMinute: 999 });
    const rolled = rollWindows(k, NOW);
    expect(rolled.requestsInMinute).toBe(5);
    expect(rolled.minuteWindowStartAt).toBe(start);
  });

  it('resets requestsInDay when the day has rolled', () => {
    const k = key({ dayWindowStartAt: new Date(NOW.getTime() - DAY_MS - 1), requestsInDay: 500 });
    expect(rollWindows(k, NOW).requestsInDay).toBe(0);
  });
});

describe('hasHeadroom', () => {
  it('respects rpm/rpd/tpm ceilings', () => {
    expect(hasHeadroom(key({ limits: { rpm: 10 }, requestsInMinute: 9, minuteWindowStartAt: NOW }), NOW)).toBe(true);
    expect(hasHeadroom(key({ limits: { rpm: 10 }, requestsInMinute: 10, minuteWindowStartAt: NOW }), NOW)).toBe(false);
    expect(hasHeadroom(key({ limits: { rpd: 100 }, requestsInDay: 100, dayWindowStartAt: NOW }), NOW)).toBe(false);
    expect(hasHeadroom(key({ limits: { tpm: 1000 }, tokensInMinute: 1000, minuteWindowStartAt: NOW }), NOW)).toBe(false);
  });

  it('lets the check pass once the window has rolled over', () => {
    const stale = new Date(NOW.getTime() - MINUTE_MS - 1);
    expect(
      hasHeadroom(key({ limits: { rpm: 10 }, requestsInMinute: 10, minuteWindowStartAt: stale }), NOW),
    ).toBe(true);
  });
});

describe('KeyPool.checkout', () => {
  it('throws NoKeyAvailableError when no keys exist', async () => {
    const pool = new KeyPool(new MemoryKeyStore([]));
    await expect(pool.checkout('gemini')).rejects.toBeInstanceOf(NoKeyAvailableError);
  });

  it('picks the least-recently-used ACTIVE key', async () => {
    const store = new MemoryKeyStore([
      key({ id: 'k1', lastUsedAt: new Date(NOW.getTime() - 10_000) }),
      key({ id: 'k2', lastUsedAt: new Date(NOW.getTime() - 60_000) }),
      key({ id: 'k3', lastUsedAt: null }), // never used → wins
    ]);
    const picked = await new KeyPool(store).checkout('gemini', NOW);
    expect(picked.id).toBe('k3');
  });

  it('skips COOLDOWN keys whose window has not elapsed', async () => {
    const store = new MemoryKeyStore([
      key({ id: 'k1', status: 'COOLDOWN', cooldownUntil: new Date(NOW.getTime() + 30_000) }),
      key({ id: 'k2', status: 'ACTIVE' }),
    ]);
    expect((await new KeyPool(store).checkout('gemini', NOW)).id).toBe('k2');
  });

  it('skips EXHAUSTED keys until the day has rolled', async () => {
    const store = new MemoryKeyStore([
      key({ id: 'k1', status: 'EXHAUSTED', dayWindowStartAt: NOW }),
    ]);
    await expect(new KeyPool(store).checkout('gemini', NOW)).rejects.toBeInstanceOf(NoKeyAvailableError);
    const nextDay = new Date(NOW.getTime() + DAY_MS + 1);
    expect((await new KeyPool(store).checkout('gemini', nextDay)).id).toBe('k1');
  });

  it('skips DISABLED keys forever', async () => {
    const store = new MemoryKeyStore([key({ id: 'k1', status: 'DISABLED' })]);
    await expect(new KeyPool(store).checkout('gemini')).rejects.toBeInstanceOf(NoKeyAvailableError);
  });
});

describe('KeyPool.recordError', () => {
  it('RATE_LIMITED → COOLDOWN with retryAfter, defaults to 60s', async () => {
    const store = new MemoryKeyStore([key()]);
    const pool = new KeyPool(store);
    await pool.recordError('k1', 'RATE_LIMITED', 30);
    expect(store.keys[0]!.status).toBe('COOLDOWN');
    expect(store.keys[0]!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now() + 25_000);

    await pool.recordError('k1', 'RATE_LIMITED');
    expect(store.keys[0]!.cooldownUntil!.getTime()).toBeGreaterThan(Date.now() + 55_000);
  });

  it('QUOTA_EXHAUSTED → EXHAUSTED, INVALID_KEY → DISABLED', async () => {
    const store = new MemoryKeyStore([key({ id: 'a' }), key({ id: 'b' })]);
    const pool = new KeyPool(store);
    await pool.recordError('a', 'QUOTA_EXHAUSTED');
    await pool.recordError('b', 'INVALID_KEY');
    expect(store.keys.find((k) => k.id === 'a')!.status).toBe('EXHAUSTED');
    expect(store.keys.find((k) => k.id === 'b')!.status).toBe('DISABLED');
  });

  it('TRANSIENT / FATAL / CONTENT_BLOCKED leave status untouched', async () => {
    const store = new MemoryKeyStore([key()]);
    const pool = new KeyPool(store);
    await pool.recordError('k1', 'TRANSIENT');
    await pool.recordError('k1', 'FATAL');
    await pool.recordError('k1', 'CONTENT_BLOCKED');
    expect(store.keys[0]!.status).toBe('ACTIVE');
  });
});

// ── router ────────────────────────────────────────────────────────────────

class MemoryCache implements CacheStore {
  entries = new Map<string, AIResult>();
  hits: string[] = [];
  saved: Array<{ cacheKey: string; entry: Parameters<CacheStore['save']>[1] }> = [];
  async lookup(k: string) { return this.entries.get(k) ?? null; }
  async save(k: string, entry: Parameters<CacheStore['save']>[1]) {
    this.saved.push({ cacheKey: k, entry });
    this.entries.set(k, {
      output: entry.output,
      model: entry.model,
      usage: {
        ...(entry.tokensIn !== undefined ? { tokensIn: entry.tokensIn } : {}),
        ...(entry.tokensOut !== undefined ? { tokensOut: entry.tokensOut } : {}),
      },
    });
  }
  async recordHit(k: string) { this.hits.push(k); }
}

class MemoryLogger implements UsageLogger {
  entries: Array<Parameters<UsageLogger['log']>[0]> = [];
  async log(e: Parameters<UsageLogger['log']>[0]) { this.entries.push(e); }
}

class FakeProvider implements AIProvider {
  calls = 0;
  constructor(
    public readonly id: string,
    public readonly supports: TaskType[],
    private readonly impl: (req: AIRequest, key: PooledKey) => Promise<AIResult>,
    private readonly classify: (e: unknown) => ReturnType<AIProvider['classifyError']> = () => 'FATAL',
  ) {}
  async generate(req: AIRequest, key: PooledKey): Promise<AIResult> {
    this.calls++;
    return this.impl(req, key);
  }
  classifyError(e: unknown) { return this.classify(e); }
}

function registry(providers: AIProvider[], chainByTask: Partial<Record<TaskType, string[]>>): ProviderRegistry {
  const map = new Map(providers.map((p) => [p.id, p]));
  return {
    get: (id) => map.get(id),
    chainFor: (t) => chainByTask[t] ?? [],
  };
}

function poolWith(states: KeyState[]): { pool: KeyPool; store: MemoryKeyStore } {
  const store = new MemoryKeyStore(states);
  return { pool: new KeyPool(store), store };
}

const req = (over: Partial<AIRequest> = {}): AIRequest => ({
  task: TaskType.METADATA,
  model: 'gemini-2.5-flash',
  system: 'sys',
  input: { kind: 'text', text: 'hello' },
  ...over,
});

describe('AIRouter cache path', () => {
  it('returns the cached entry without calling any provider', async () => {
    const cache = new MemoryCache();
    const logger = new MemoryLogger();
    const provider = new FakeProvider('gemini', [TaskType.METADATA], async () => ({
      output: 'live',
      model: 'gemini-2.5-flash',
      usage: {},
    }));
    const { pool } = poolWith([key()]);
    await cache.save('ck-1', { task: TaskType.METADATA, providerId: 'gemini', model: 'gemini-2.5-flash', output: 'cached' });
    const router = new AIRouter({
      cache, logger, keyPool: pool, registry: registry([provider], { [TaskType.METADATA]: ['gemini'] }),
    });
    const res = await router.run({ ...req(), cacheKey: 'ck-1' });
    expect(res.output).toBe('cached');
    expect(res.cached).toBe(true);
    expect(provider.calls).toBe(0);
    expect(cache.hits).toEqual(['ck-1']);
    expect(logger.entries[0]?.cacheHit).toBe(true);
  });
});

describe('AIRouter provider chain', () => {
  it('falls through to the next provider when a key error rotates + then exhausts', async () => {
    const cache = new MemoryCache();
    const logger = new MemoryLogger();
    const a = new FakeProvider(
      'gemini',
      [TaskType.METADATA],
      async () => { throw Object.assign(new Error('rate'), { status: 429 }); },
      () => 'RATE_LIMITED',
    );
    const b = new FakeProvider('openai', [TaskType.METADATA], async () => ({
      output: 'ok',
      model: 'gpt-4o-mini',
      usage: { tokensIn: 10, tokensOut: 3 },
    }));
    const { pool } = poolWith([key({ id: 'k1', providerId: 'gemini' })]);
    // openai pool with one active key
    const store = (pool as unknown as { store: MemoryKeyStore }).store;
    // manually append an openai key (MemoryKeyStore lives inside `pool`)
    // simpler: build a second store & pool via a dispatching wrapper
    const bothStore = new MemoryKeyStore([
      key({ id: 'k1', providerId: 'gemini' }),
      key({ id: 'k2', providerId: 'openai' }),
    ]);
    const bothPool = new KeyPool(bothStore);

    const router = new AIRouter({
      cache, logger, keyPool: bothPool,
      registry: registry([a, b], { [TaskType.METADATA]: ['gemini', 'openai'] }),
    });
    const res = await router.run(req());
    expect(res.output).toBe('ok');
    // gemini's single key should have been COOLDOWN'd by the rate limit.
    expect(bothStore.keys.find((k) => k.id === 'k1')!.status).toBe('COOLDOWN');
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
    expect(store).toBeDefined(); // silence unused
  });

  it('AllProvidersExhaustedError when every chain entry fails', async () => {
    const cache = new MemoryCache();
    const logger = new MemoryLogger();
    const p = new FakeProvider(
      'gemini',
      [TaskType.METADATA],
      async () => { throw Object.assign(new Error('boom'), { status: 500 }); },
      () => 'FATAL',
    );
    const { pool } = poolWith([key({ providerId: 'gemini' })]);
    const router = new AIRouter({
      cache, logger, keyPool: pool,
      registry: registry([p], { [TaskType.METADATA]: ['gemini'] }),
      transientRetries: 0,
    });
    await expect(router.run(req())).rejects.toBeInstanceOf(AllProvidersExhaustedError);
  });

  it('bumps key counters + records cost + saves to cache on success', async () => {
    const cache = new MemoryCache();
    const logger = new MemoryLogger();
    const p = new FakeProvider('gemini', [TaskType.METADATA], async () => ({
      output: { title: 'x' },
      model: 'gemini-2.5-flash',
      usage: { tokensIn: 100, tokensOut: 25 },
    }));
    const { pool, store } = poolWith([key({ providerId: 'gemini' })]);
    const router = new AIRouter({
      cache, logger, keyPool: pool,
      registry: registry([p], { [TaskType.METADATA]: ['gemini'] }),
      estimateCost: (_id, _model, u) => ((u.tokensIn ?? 0) + (u.tokensOut ?? 0)) * 0.00001,
    });
    const res = await router.run({ ...req(), cacheKey: 'ck-metadata', contentItemId: 'ci-1' });
    expect(res.output).toEqual({ title: 'x' });
    expect(cache.saved[0]?.entry.contentItemId).toBe('ci-1');
    expect(logger.entries[0]?.estimatedCostUsd).toBeCloseTo(0.00125, 5);
    expect(store.keys[0]!.requestsInMinute).toBe(1);
    expect(store.keys[0]!.tokensInMinute).toBe(125);
    expect(store.keys[0]!.requestsInDay).toBe(1);
  });
});

// ── Gemini adapter (classifyError only — network is out of scope for units) ──

describe('GeminiProvider.classifyError', () => {
  const g = new GeminiProvider();
  it('429 → RATE_LIMITED', () => expect(g.classifyError({ status: 429 })).toBe('RATE_LIMITED'));
  it('quota-flavored 403 → QUOTA_EXHAUSTED', () =>
    expect(g.classifyError({ status: 403, message: 'RESOURCE_EXHAUSTED quota exceeded' })).toBe('QUOTA_EXHAUSTED'));
  it('generic 401/403 → INVALID_KEY', () => {
    expect(g.classifyError({ status: 401, message: 'unauthorized' })).toBe('INVALID_KEY');
    expect(g.classifyError({ status: 403, message: 'permission denied' })).toBe('INVALID_KEY');
  });
  it('API_KEY_INVALID → INVALID_KEY even at 400', () =>
    expect(g.classifyError({ status: 400, message: 'API_KEY_INVALID' })).toBe('INVALID_KEY'));
  it('5xx / network → TRANSIENT', () => {
    expect(g.classifyError({ status: 500 })).toBe('TRANSIENT');
    expect(g.classifyError({ message: 'ECONNRESET' })).toBe('TRANSIENT');
  });
  it('safety block → CONTENT_BLOCKED', () =>
    expect(g.classifyError({ code: 'CONTENT_BLOCKED' })).toBe('CONTENT_BLOCKED'));
  it('unknown 400 → FATAL', () => expect(g.classifyError({ status: 400, message: 'nope' })).toBe('FATAL'));
  it('404 model unavailable → FATAL (fallback handled in generate)', () =>
    expect(
      g.classifyError({
        status: 404,
        message: 'This model models/gemini-2.5-flash is no longer available to new users',
      }),
    ).toBe('FATAL'));
});

describe('resolveGeminiModelChain / isGeminiModelUnavailable', () => {
  it('puts requested model first then cheap flash/lite chain', async () => {
    const { resolveGeminiModelChain, DEFAULT_GEMINI_TEXT_MODEL, GEMINI_TEXT_MODEL_CHAIN } =
      await import('./gemini-models.js');
    const chain = resolveGeminiModelChain(DEFAULT_GEMINI_TEXT_MODEL);
    expect(chain[0]).toBe(DEFAULT_GEMINI_TEXT_MODEL);
    expect(chain).toEqual([...new Set([DEFAULT_GEMINI_TEXT_MODEL, ...GEMINI_TEXT_MODEL_CHAIN])]);
    expect(chain.some((m) => /pro|ultra|thinking/i.test(m))).toBe(false);
  });

  it('does not expand specialty TTS models into the text chain', async () => {
    const { resolveGeminiModelChain } = await import('./gemini-models.js');
    expect(resolveGeminiModelChain('gemini-2.5-flash-preview-tts')).toEqual([
      'gemini-2.5-flash-preview-tts',
    ]);
  });

  it('detects 404 / no-longer-available as model unavailable', async () => {
    const { isGeminiModelUnavailable } = await import('./gemini-models.js');
    expect(
      isGeminiModelUnavailable({
        status: 404,
        message: 'This model models/gemini-2.5-flash is no longer available to new users',
      }),
    ).toBe(true);
    expect(isGeminiModelUnavailable({ status: 429, message: 'rate' })).toBe(false);
  });
});

describe('GeminiProvider.generate (structured JSON via mocked fetch)', () => {
  const schema = z.object({ title: z.string(), tags: z.array(z.string()) });
  const okJson = { candidates: [{ content: { parts: [{ text: '{"title":"Hi","tags":["a","b"]}' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 4 } };
  const okBody = () => new Response(JSON.stringify(okJson), { status: 200, headers: { 'content-type': 'application/json' } });

  it('parses structured JSON on the first try', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchImpl = (async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), body: String(init.body ?? '') });
      return okBody();
    }) as unknown as typeof fetch;

    const g = new GeminiProvider({ fetchImpl });
    const res = await g.generate(
      { task: TaskType.METADATA, model: 'gemini-2.5-flash', system: 's', input: { kind: 'text', text: 'x' }, schema },
      { id: 'k1', providerId: 'gemini', secret: 'sk_test' },
    );
    expect(res.output).toEqual({ title: 'Hi', tags: ['a', 'b'] });
    expect(res.usage.tokensIn).toBe(5);
    expect(calls[0]?.url).toContain('/models/gemini-2.5-flash:generateContent');
    expect(calls[0]?.body).toContain('"responseMimeType":"application/json"');
    expect(calls).toHaveLength(1);
  });

  it('falls back to the next model when the primary returns 404 unavailable', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes('/models/gemini-2.5-flash:')) {
        return new Response(
          JSON.stringify({
            error: {
              message:
                'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use a newer model for the latest features and improvements.',
            },
          }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return okBody();
    }) as unknown as typeof fetch;

    const g = new GeminiProvider({ fetchImpl });
    const res = await g.generate(
      { task: TaskType.METADATA, model: 'gemini-2.5-flash', system: 's', input: { kind: 'text', text: 'x' }, schema },
      { id: 'k1', providerId: 'gemini', secret: 'sk_test' },
    );
    expect(res.output).toEqual({ title: 'Hi', tags: ['a', 'b'] });
    expect(res.model).not.toBe('gemini-2.5-flash');
    expect(calls[0]).toContain('/models/gemini-2.5-flash:');
    expect(calls.some((u) => u.includes(`/models/${res.model}:`))).toBe(true);
  });

  it('runs a repair-retry when the first response is not valid JSON', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) {
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Sure, here you go: {title:"nope"}' }] } }] }), { status: 200 });
      }
      return okBody();
    }) as unknown as typeof fetch;

    const g = new GeminiProvider({ fetchImpl });
    const res = await g.generate(
      { task: TaskType.METADATA, model: 'gemini-2.5-flash', system: 's', input: { kind: 'text', text: 'x' }, schema },
      { id: 'k1', providerId: 'gemini', secret: 'sk_test' },
    );
    expect(res.output).toEqual({ title: 'Hi', tags: ['a', 'b'] });
    expect(n).toBe(2);
  });

  it('propagates HTTP-status errors (429) that the classifier maps to RATE_LIMITED', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'too many requests' } }), { status: 429 })) as unknown as typeof fetch;
    const g = new GeminiProvider({ fetchImpl });
    await expect(
      g.generate(
        { task: TaskType.METADATA, model: 'gemini-2.5-flash', system: 's', input: { kind: 'text', text: 'x' } },
        { id: 'k1', providerId: 'gemini', secret: 'sk_test' },
      ),
    ).rejects.toMatchObject({ status: 429 });
  });
});
