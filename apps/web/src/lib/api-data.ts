'use client';

/**
 * Real API accessors for accounts (Phase 1a), satisfying the same `domain-types`
 * contract the mock layer does. DEMO MODE (docs mission §4): when `demo_mode` is
 * on AND there are zero real accounts, the mock data is served so the designed
 * UI stays populated; as soon as a real account is connected, the mock vanishes.
 */
import { api, ApiError } from './api';
import {
  getAccounts as mockAccounts,
  getAccount as mockAccount,
  getIncidents as mockIncidents,
  getPosts as mockPosts,
  getReviewItems as mockReviewItems,
} from './mock-data';
import type {
  Account,
  ConnectionMethod,
  ContentType,
  HealthStatus,
  ConnectionStatus,
  Incident,
  IncidentKind,
  Platform,
  Post,
  PostStatus,
  ReviewItem,
  ReviewStatus,
} from './domain-types';

/** Shape returned by GET /accounts (see apps/api account.view.ts). Never carries secrets. */
export interface ApiChannelProfile {
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  language: string;
  voiceSettings: unknown;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultTags: string[];
  aiLabelDefault: boolean;
  approvalPolicy: unknown;
  schedulingPrefs: unknown;
}

export interface ApiAccount {
  id: string;
  platform: Platform;
  kind: string;
  externalId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  connectionStatus: 'HEALTHY' | 'EXPIRING' | 'BROKEN';
  connectionMethod: ConnectionMethod;
  contentType: ContentType;
  dramasEnabled: boolean;
  monetized: boolean;
  paused: boolean;
  timezone: string;
  tokenExpiresAt: string | null;
  createdAt: string;
  profile: ApiChannelProfile | null;
}

const HEALTH: Record<ApiAccount['connectionStatus'], HealthStatus> = {
  HEALTHY: 'HEALTHY',
  EXPIRING: 'WARNING',
  BROKEN: 'CRITICAL',
};
const CONNECTION: Record<ApiAccount['connectionStatus'], ConnectionStatus> = {
  HEALTHY: 'CONNECTED',
  EXPIRING: 'EXPIRING',
  BROKEN: 'DISCONNECTED',
};

/** Map an API account to the UI `Account` view. Metrics are 0/placeholder until Phase 6. */
export function mapAccount(a: ApiAccount): Account {
  return {
    id: a.id,
    name: a.name,
    handle: a.handle ?? '',
    platform: a.platform,
    contentType: a.contentType,
    connectionMethod: a.connectionMethod,
    dramasEnabled: a.dramasEnabled,
    avatarUrl: a.avatarUrl,
    health: HEALTH[a.connectionStatus],
    connection: CONNECTION[a.connectionStatus],
    tokenExpiresAt: a.tokenExpiresAt,
    followers: 0,
    views30d: 0,
    scheduledCount: 0,
    openIncidents: 0,
    monetized: a.monetized,
    paused: a.paused,
    createdAt: a.createdAt,
  };
}

export async function getDemoMode(): Promise<boolean> {
  try {
    const { enabled } = await api.get<{ enabled: boolean }>('/system/demo-mode');
    return enabled;
  } catch {
    return true; // default ON (docs mission §4)
  }
}

async function fetchRealAccounts(): Promise<ApiAccount[]> {
  return api.get<ApiAccount[]>('/accounts');
}

export interface AccountsResult {
  accounts: Account[];
  /** True when the returned list is mock data (demo mode active). */
  demo: boolean;
}

export async function getAccountsView(): Promise<AccountsResult> {
  const real = await fetchRealAccounts();
  if (real.length > 0) return { accounts: real.map(mapAccount), demo: false };
  if (await getDemoMode()) return { accounts: mockAccounts(), demo: true };
  return { accounts: [], demo: false };
}

/** Raw API account (for the settings tab which needs the profile), or null. */
export async function getApiAccount(id: string): Promise<ApiAccount | null> {
  try {
    return await api.get<ApiAccount>(`/accounts/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface AccountResult {
  account: Account | null;
  demo: boolean;
}

export async function getAccountView(id: string): Promise<AccountResult> {
  const real = await fetchRealAccounts();
  const found = real.find((a) => a.id === id);
  if (found) return { account: mapAccount(found), demo: false };
  if (real.length === 0 && (await getDemoMode())) {
    const m = mockAccount(id);
    return { account: m ?? null, demo: Boolean(m) };
  }
  return { account: null, demo: false };
}

// ---------------------------------------------------------------------------
// Phase 1b — publishing / incidents / scheduling / review accessors.
// Same demo-mode rule as accounts: when there are zero real accounts AND demo
// mode is on, the mock layer keeps the designed UI populated; otherwise the
// real API is the source of truth (even when it returns an empty list).
// ---------------------------------------------------------------------------

/** True when the app should serve mock data (no real accounts + demo on). */
export async function inDemoMode(): Promise<boolean> {
  const real = await fetchRealAccounts();
  if (real.length > 0) return false;
  return getDemoMode();
}

// --- Incidents -------------------------------------------------------------

interface ApiIncident {
  id: string;
  kind: 'COPYRIGHT' | 'AUTH' | 'RATE_LIMIT' | 'PLATFORM_REJECT' | 'WATCHER' | 'STORAGE' | 'SYSTEM';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  status: 'OPEN' | 'ACKED' | 'RESOLVED';
  accountId: string | null;
  accountName: string | null;
  contentItemId: string | null;
  publishTargetId: string | null;
  title: string;
  detail: unknown;
  createdAt: string;
  resolvedAt: string | null;
}

const INCIDENT_KIND: Record<ApiIncident['kind'], IncidentKind> = {
  COPYRIGHT: 'COPYRIGHT',
  AUTH: 'AUTH',
  RATE_LIMIT: 'RATE_LIMIT',
  PLATFORM_REJECT: 'POLICY',
  WATCHER: 'PUBLISH_ERROR',
  STORAGE: 'PUBLISH_ERROR',
  SYSTEM: 'PUBLISH_ERROR',
};

/** Render an incident's jsonb detail into a short human string for the drawer. */
function detailToText(detail: unknown): string {
  if (!detail) return '';
  if (typeof detail === 'string') return detail;
  const d = detail as { message?: unknown; hint?: unknown; issues?: Array<{ message?: unknown }> };
  if (typeof d.message === 'string') return d.message + (typeof d.hint === 'string' ? ` — ${d.hint}` : '');
  if (Array.isArray(d.issues)) {
    return d.issues.map((i) => (typeof i.message === 'string' ? i.message : '')).filter(Boolean).join('; ');
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return '';
  }
}

function mapIncident(i: ApiIncident): Incident {
  return {
    id: i.id,
    accountId: i.accountId ?? '',
    kind: INCIDENT_KIND[i.kind],
    severity: i.severity,
    status: i.status === 'RESOLVED' ? 'RESOLVED' : 'OPEN',
    title: i.title,
    detail: detailToText(i.detail),
    createdAt: i.createdAt,
    resolvedAt: i.resolvedAt,
  };
}

export interface IncidentsResult {
  incidents: Incident[];
  accountNames: Record<string, string>;
  demo: boolean;
}

export async function getIncidentsView(): Promise<IncidentsResult> {
  if (await inDemoMode()) {
    const accounts = mockAccounts();
    return {
      incidents: mockIncidents(),
      accountNames: Object.fromEntries(accounts.map((a) => [a.id, a.name])),
      demo: true,
    };
  }
  const raw = await api.get<ApiIncident[]>('/incidents');
  const accountNames: Record<string, string> = {};
  for (const i of raw) if (i.accountId && i.accountName) accountNames[i.accountId] = i.accountName;
  return { incidents: raw.map(mapIncident), accountNames, demo: false };
}

export async function retryIncident(id: string): Promise<void> {
  await api.post(`/incidents/${id}/retry`);
}

export async function resolveIncident(id: string): Promise<void> {
  await api.post(`/incidents/${id}/resolve`);
}

// --- Publish targets (calendar / schedule read side) -----------------------

interface ApiPublishTarget {
  id: string;
  contentItemId: string;
  accountId: string;
  platform: Platform;
  title: string;
  status: 'PENDING' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'DRAFT';
  scheduleMode: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  createdAt: string;
}

const TARGET_STATUS: Record<ApiPublishTarget['status'], PostStatus> = {
  PENDING: 'SCHEDULED',
  SCHEDULED: 'SCHEDULED',
  PUBLISHING: 'SCHEDULED',
  PUBLISHED: 'PUBLISHED',
  FAILED: 'FAILED',
  DRAFT: 'DRAFT',
};

const PLATFORM_ACCENT: Record<Platform, string> = {
  YOUTUBE: '#ef4444',
  FACEBOOK: '#3b82f6',
  TIKTOK: '#111827',
};

function mapTarget(t: ApiPublishTarget): Post {
  return {
    id: t.id,
    accountId: t.accountId,
    title: t.title,
    status: TARGET_STATUS[t.status],
    scheduledAt: t.scheduledAt,
    publishedAt: t.publishedAt,
    views: null,
    accent: PLATFORM_ACCENT[t.platform] ?? '#6366f1',
  };
}

export interface PostsResult {
  posts: Post[];
  demo: boolean;
}

export async function getPostsView(accountId?: string): Promise<PostsResult> {
  if (await inDemoMode()) return { posts: mockPosts(accountId), demo: true };
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  const raw = await api.get<ApiPublishTarget[]>(`/publish/targets${qs}`);
  return { posts: raw.map(mapTarget), demo: false };
}

// --- Review queue ----------------------------------------------------------

interface ApiReviewItem {
  id: string;
  accountId: string | null;
  kind: 'INGESTED_VIDEO' | 'PRODUCED_VIDEO';
  title: string;
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  durationSec: number | null;
}

function mapReviewItem(r: ApiReviewItem): ReviewItem {
  return {
    id: r.id,
    accountId: r.accountId ?? '',
    kind: r.kind,
    title: r.title,
    submittedAt: r.submittedAt,
    status: r.status,
    sourceUrl: null,
    rightsNote: null,
    durationSec: r.durationSec,
  };
}

export interface ReviewResult {
  items: ReviewItem[];
  demo: boolean;
}

export async function getReviewView(accountId?: string): Promise<ReviewResult> {
  if (await inDemoMode()) return { items: mockReviewItems(accountId), demo: true };
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  const raw = await api.get<ApiReviewItem[]>(`/content/review${qs}`);
  return { items: raw.map(mapReviewItem), demo: false };
}

export async function decideReview(id: string, status: ReviewStatus): Promise<void> {
  if (status === 'APPROVED') await api.post(`/content/${id}/approve`);
  else await api.post(`/content/${id}/reject`, {});
}

// --- Scheduling (upcoming queue + free slots) ------------------------------

export interface UpcomingResult {
  scheduled: Array<{ publishTargetId: string; contentItemId: string; title: string; scheduledAt: string }>;
  freeSlots: string[];
  demo: boolean;
}

export async function getUpcomingView(accountId: string): Promise<UpcomingResult> {
  if (await inDemoMode()) {
    const posts = mockPosts(accountId)
      .filter((p) => p.scheduledAt && p.status !== 'PUBLISHED')
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
    return {
      scheduled: posts.map((p) => ({
        publishTargetId: p.id,
        contentItemId: p.id,
        title: p.title,
        scheduledAt: p.scheduledAt!,
      })),
      freeSlots: [],
      demo: true,
    };
  }
  const data = await api.get<Omit<UpcomingResult, 'demo'>>(
    `/schedule/upcoming?accountId=${encodeURIComponent(accountId)}`,
  );
  return { ...data, demo: false };
}

// --- Manual upload → publish flow ------------------------------------------

interface ApiContentItem {
  id: string;
  title: string;
  status: string;
}

export interface ManualPublishInput {
  title: string;
  file: File;
  accountId: string;
  scheduleMode: 'NOW' | 'QUEUE_SLOT';
}

/**
 * The full manual-upload path: create a content item, stream the file into the
 * hot tier as its FINAL asset, then create a publish target for the account.
 * Returns the created publish target id.
 */
export async function manualPublish(input: ManualPublishInput): Promise<{ contentItemId: string }> {
  const content = await api.post<ApiContentItem>('/content', {
    title: input.title,
    type: 'MANUAL_UPLOAD',
  });
  await api.upload(`/storage/upload?contentItemId=${encodeURIComponent(content.id)}&kind=FINAL`, input.file);
  // Manual uploads skip review: approve so the target can publish.
  await api.post(`/content/${content.id}/approve`).catch(() => undefined);
  await api.post('/publish', {
    contentItemId: content.id,
    targets: [{ accountId: input.accountId, scheduleMode: input.scheduleMode }],
  });
  return { contentItemId: content.id };
}
