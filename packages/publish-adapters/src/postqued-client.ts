import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import type { LocalFile, PlatformIssue } from './types.js';

/**
 * Framework-free PostQued API v2 client (docs/06 §2, docs/specs/postqued-openapi.json).
 *
 * Mirrors the auth-header approach of apps/api/.../postqued.client.ts: the owner's
 * API key (`pq_…`) is sent as either `Authorization: Bearer <key>` or `x-api-key: <key>`
 * depending on the probed `headerStyle`. The presigned PUT is an opaque storage URL
 * and is called WITHOUT the PostQued auth header.
 *
 * Used by the TikTok (postqued.ts) and YouTube (youtube.ts) adapters — one publishing
 * integration for both platforms (Owner decision 2026-07-14).
 */

export type PqHeaderStyle = 'bearer' | 'x-api-key';

export interface PostQuedV2ClientConfig {
  baseUrl: string;
  apiKey: string;
  headerStyle: PqHeaderStyle;
  /** Overridable for tests. Defaults to the platform global fetch (Node 24). */
  fetchImpl?: typeof fetch;
  /** Optional workspace scoping; forwarded on every scoped request when set. */
  workspaceId?: string;
}

/** Error thrown for non-2xx responses / transport failures. `.retryable` drives the worker's retry matrix (docs/06 §4). */
export class PostQuedError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(
    message: string,
    opts: { status: number; retryable: boolean; code?: string; body?: unknown },
  ) {
    super(message);
    this.name = 'PostQuedError';
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.code = opts.code;
    this.body = opts.body;
  }
}

export interface PublishArgs {
  contentId: string;
  platform: 'tiktok' | 'youtube';
  accountId: string;
  intent: 'draft' | 'publish';
  caption?: string;
  /** `null` = publish now (we own timing); ISO timestamp = schedule inside PostQued. */
  dispatchAt: string | null;
  options: Record<string, unknown>;
  idempotencyKey: string;
}

export interface NormalizedPublishStatus {
  state: string;
  platformPostId: string | undefined;
  issues: Array<{ code: string; message: string; severity: string }>;
}

/** 5xx / 429 / transport failures are retryable; other 4xx (policy/media/validation) are terminal. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

// ── Status normalization shared by the PostQued-backed adapters ───────────────

const LIVE_STATES = new Set([
  'published',
  'live',
  'complete',
  'completed',
  'success',
  'succeeded',
  'posted',
]);
const FAILED_STATES = new Set([
  'failed',
  'error',
  'errored',
  'rejected',
  'canceled',
  'cancelled',
]);

/** Codes/severities that always block go-live (copyright, rejection, processing failure). */
const BLOCK_CODE_RE = /copyright|claim|reject|violat|block|processing[-_ ]?fail|takedown/i;

function mapSeverity(code: string, rawSeverity: string | undefined): PlatformIssue['severity'] {
  if (BLOCK_CODE_RE.test(code)) return 'BLOCK';
  const s = (rawSeverity ?? '').toLowerCase();
  if (s === 'block' || s === 'error' || s === 'critical' || s === 'fatal') return 'BLOCK';
  if (s === 'warn' || s === 'warning') return 'WARNING';
  return 'INFO';
}

/**
 * Map a normalized PostQued publish status to the adapter `verify()` result.
 * `live` is true only when the state is a confirmed-live state AND no BLOCK issue exists.
 */
export function verifyFromStatus(status: NormalizedPublishStatus): {
  live: boolean;
  issues: PlatformIssue[];
} {
  const issues: PlatformIssue[] = (status.issues ?? []).map((i) => ({
    code: i.code,
    message: i.message,
    severity: mapSeverity(i.code, i.severity),
  }));

  const state = (status.state ?? '').toLowerCase();
  const hasBlock = () => issues.some((i) => i.severity === 'BLOCK');

  if (FAILED_STATES.has(state) && !hasBlock()) {
    issues.push({
      code: 'publish-failed',
      message: `PostQued reported publish state "${status.state}".`,
      severity: 'BLOCK',
    });
  }

  const live = LIVE_STATES.has(state) && !hasBlock();
  return { live, issues };
}

export class PostQuedV2Client {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly headerStyle: PqHeaderStyle;
  private readonly workspaceId: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PostQuedV2ClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.headerStyle = config.headerStyle;
    this.workspaceId = config.workspaceId;
    this.fetchImpl = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  private authHeaders(): Record<string, string> {
    return this.headerStyle === 'bearer'
      ? { Authorization: `Bearer ${this.apiKey}` }
      : { 'x-api-key': this.apiKey };
  }

  /** POST/GET JSON against the PostQued API, throwing a classified {@link PostQuedError} on failure. */
  private async requestJson<T>(
    path: string,
    init: { method: string; body?: unknown; extraHeaders?: Record<string, string> },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...this.authHeaders(),
      ...(init.extraHeaders ?? {}),
    };
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (err) {
      throw new PostQuedError(
        `PostQued request to ${init.method} ${path} failed (network): ${(err as Error).message}`,
        { status: 0, retryable: true },
      );
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let code: string | undefined;
      let parsed: unknown = raw;
      try {
        const j = raw ? (JSON.parse(raw) as { error?: string; code?: string }) : undefined;
        if (j) {
          parsed = j;
          code = j.code;
        }
      } catch {
        /* non-JSON error body */
      }
      throw new PostQuedError(
        `PostQued ${init.method} ${path} returned ${res.status}: ${raw.slice(0, 500)}`,
        { status: res.status, retryable: isRetryableStatus(res.status), code, body: parsed },
      );
    }

    return (await res.json()) as T;
  }

  /**
   * 3-step upload: POST /v2/content/upload → presigned PUT → POST /v2/content/upload/complete.
   * Streams the file from disk (node:fs) so 4 GB videos never buffer in memory.
   */
  async uploadContent(file: LocalFile): Promise<{ contentId: string }> {
    const filename = basename(file.path);

    // Step 1 — create the upload session.
    const start = await this.requestJson<{
      contentId: string;
      upload: {
        url: string;
        key: string;
        method?: string;
        headers?: { 'Content-Type'?: string } & Record<string, string>;
      };
    }>('/v2/content/upload', {
      method: 'POST',
      body: {
        filename,
        contentType: file.mimeType,
        fileSize: file.bytes,
        ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
      },
    });

    // Step 2 — PUT the bytes to the presigned URL (no PostQued auth header here).
    const putMethod = start.upload.method ?? 'PUT';
    const putContentType = start.upload.headers?.['Content-Type'] ?? file.mimeType;
    const body = Readable.toWeb(createReadStream(file.path)) as unknown as ReadableStream<Uint8Array>;
    let putRes: Response;
    try {
      const putInit = {
        method: putMethod,
        headers: {
          'Content-Type': putContentType,
          'Content-Length': String(file.bytes),
          ...(start.upload.headers ?? {}),
        },
        body,
        duplex: 'half',
      } as unknown as RequestInit;
      putRes = await this.fetchImpl(start.upload.url, putInit);
    } catch (err) {
      throw new PostQuedError(`Presigned PUT failed (network): ${(err as Error).message}`, {
        status: 0,
        retryable: true,
      });
    }
    if (!putRes.ok) {
      const raw = await putRes.text().catch(() => '');
      throw new PostQuedError(`Presigned PUT returned ${putRes.status}: ${raw.slice(0, 300)}`, {
        status: putRes.status,
        retryable: isRetryableStatus(putRes.status),
      });
    }

    // Step 3 — finalize; server marks the asset ready.
    const durationMs =
      file.durationSec !== undefined ? Math.round(file.durationSec * 1000) : undefined;
    const complete = await this.requestJson<{ content?: { id?: string } }>(
      '/v2/content/upload/complete',
      {
        method: 'POST',
        body: {
          contentId: start.contentId,
          key: start.upload.key,
          filename,
          contentType: file.mimeType,
          size: file.bytes,
          ...(file.width !== undefined ? { width: file.width } : {}),
          ...(file.height !== undefined ? { height: file.height } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
        },
      },
    );

    return { contentId: complete.content?.id ?? start.contentId };
  }

  /**
   * POST /v2/publish with the required `Idempotency-Key` header. `dispatchAt: null`
   * publishes immediately (we own timing). Returns the PostQued publishId + first targetId.
   */
  async publish(args: PublishArgs): Promise<{ publishId: string; targetId?: string }> {
    const data = await this.requestJson<{
      id?: string;
      publishId?: string;
      publish?: { id?: string };
      targets?: Array<{ id?: string }>;
    }>('/v2/publish', {
      method: 'POST',
      extraHeaders: { 'Idempotency-Key': args.idempotencyKey },
      body: {
        contentIds: [args.contentId],
        targets: [
          {
            platform: args.platform,
            accountId: args.accountId,
            intent: args.intent,
            caption: args.caption ?? '',
            dispatchAt: args.dispatchAt,
            options: args.options,
          },
        ],
        ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
      },
    });

    const publishId = data.id ?? data.publishId ?? data.publish?.id;
    if (!publishId) {
      throw new PostQuedError('PostQued /v2/publish response missing a publish id.', {
        status: 200,
        retryable: false,
        body: data,
      });
    }
    return { publishId, targetId: data.targets?.[0]?.id };
  }

  /** GET /v2/publish/{publishId}, normalized to { state, platformPostId?, issues? }. */
  async getPublishStatus(publishId: string): Promise<NormalizedPublishStatus> {
    const qs = this.workspaceId ? `?workspaceId=${encodeURIComponent(this.workspaceId)}` : '';
    const data = await this.requestJson<Record<string, unknown>>(
      `/v2/publish/${encodeURIComponent(publishId)}${qs}`,
      { method: 'GET' },
    );
    return normalizePublishStatus(data);
  }
}

/** Defensively normalize the (spec-undocumented) publish-status body into a stable shape. */
export function normalizePublishStatus(data: Record<string, unknown>): NormalizedPublishStatus {
  const targets = (data.targets as Array<Record<string, unknown>> | undefined) ?? [];
  const target = targets[0] ?? data;

  const pick = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  };

  const state =
    pick(target, ['status', 'state']) ?? pick(data, ['status', 'state']) ?? 'unknown';
  const platformPostId = pick(target, [
    'platformPostId',
    'postId',
    'externalId',
    'externalPostId',
  ]);

  const rawIssues =
    (target.issues as Array<Record<string, unknown>> | undefined) ??
    (target.errors as Array<Record<string, unknown>> | undefined) ??
    (data.issues as Array<Record<string, unknown>> | undefined) ??
    [];
  const issues = rawIssues.map((i) => ({
    code: (pick(i, ['code', 'type']) ?? 'unknown') as string,
    message: (pick(i, ['message', 'detail', 'description']) ?? '') as string,
    severity: (pick(i, ['severity', 'level']) ?? 'info') as string,
  }));

  return { state, platformPostId, issues };
}
