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
  getSources as mockSources,
  getIdeas as mockIdeas,
  getDramas as mockDramas,
  getTasks as mockTasks,
} from './mock-data';
import type {
  Account,
  CompetitorChannel,
  ConnectionMethod,
  ContentType,
  DramaSeries,
  DramaStatus,
  HealthStatus,
  ConnectionStatus,
  Idea,
  IdeaStage,
  Incident,
  IncidentKind,
  Platform,
  Post,
  PostStatus,
  ProductionBrief,
  ReviewItem,
  ReviewStatus,
  Source,
  SourceStatus,
  SourceType,
  WorkerTask,
  TaskStatus,
} from './domain-types';

/** Shape returned by GET /accounts (see apps/api account.view.ts). Never carries secrets. */
export interface ApiChannelProfile {
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  /** Structured brand questionnaire answers (may be {} on older profiles). */
  styleProfile?: unknown;
  language: string;
  voiceSettings: unknown;
  titleTemplate: string;
  descriptionTemplate: string;
  thumbnailReferencePrompt?: string;
  animationReferencePrompt?: string;
  defaultTags: string[];
  aiLabelDefault: boolean;
  approvalPolicy: unknown;
  schedulingPrefs: unknown;
}

/** Publish defaults stored on channel_profiles.schedulingPrefs. */
export type ChannelScheduleMode = 'NOW' | 'QUEUE_SLOT';

export interface ChannelPublishDefaults {
  scheduleMode: ChannelScheduleMode;
  crosspostAccountIds: string[];
}

/** Read default schedule mode + crosspost destinations from a channel profile. */
export function publishDefaultsFromProfile(
  profile: ApiChannelProfile | null | undefined,
): ChannelPublishDefaults {
  const sched = (profile?.schedulingPrefs ?? {}) as {
    defaultScheduleMode?: string;
    defaultCrosspostAccountIds?: unknown;
  };
  const mode = sched.defaultScheduleMode === 'NOW' ? 'NOW' : 'QUEUE_SLOT';
  const raw = sched.defaultCrosspostAccountIds;
  const crosspostAccountIds = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  return { scheduleMode: mode, crosspostAccountIds };
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
  followers?: number;
  views30d?: number;
  scheduledCount?: number;
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
    followers: a.followers ?? 0,
    views30d: a.views30d ?? 0,
    scheduledCount: a.scheduledCount ?? 0,
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
    return false; // default OFF — live data only
  }
}

async function fetchRealAccounts(): Promise<ApiAccount[]> {
  try {
    return await api.get<ApiAccount[]>('/accounts');
  } catch (err) {
    // Grant-scoped roles used to hit 403 here; surface empty rather than crashing the shell.
    if (err instanceof ApiError && (err.status === 403 || err.status === 401)) return [];
    throw err;
  }
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
  retryable?: boolean;
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
  if (typeof d.message === 'string')
    return d.message + (typeof d.hint === 'string' ? ` — ${d.hint}` : '');
  if (Array.isArray(d.issues)) {
    return d.issues
      .map((i) => (typeof i.message === 'string' ? i.message : ''))
      .filter(Boolean)
      .join('; ');
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return '';
  }
}

function mapIncident(i: ApiIncident): Incident {
  const status: Incident['status'] =
    i.status === 'RESOLVED' ? 'RESOLVED' : i.status === 'ACKED' ? 'ACKED' : 'OPEN';
  return {
    id: i.id,
    accountId: i.accountId ?? '',
    kind: INCIDENT_KIND[i.kind],
    severity: i.severity,
    status,
    title: i.title,
    detail: detailToText(i.detail),
    retryable: i.retryable ?? Boolean(i.publishTargetId || i.contentItemId),
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

export interface PublishTargetDetail {
  id: string;
  contentItemId: string;
  accountId: string;
  accountName?: string | null;
  platform: Platform;
  title: string;
  description: string | null;
  tags: string[];
  status: 'PENDING' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'DRAFT';
  scheduleMode: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  lastError: unknown;
  views?: number | null;
  hasVideo: boolean;
  hasThumbnail: boolean;
  createdAt: string;
}

type ApiPublishTarget = PublishTargetDetail;

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
    contentItemId: t.contentItemId,
    title: t.title,
    status: TARGET_STATUS[t.status],
    scheduledAt: t.scheduledAt,
    publishedAt: t.publishedAt,
    views: typeof t.views === 'number' ? t.views : null,
    accent: PLATFORM_ACCENT[t.platform] ?? '#6366f1',
    platformPostId: t.platformPostId,
    platform: t.platform,
  };
}

/** Full publish-target detail for the calendar/schedule post popup. */
export async function getPublishTargetDetail(id: string): Promise<PublishTargetDetail> {
  if (await inDemoMode()) {
    const post = mockPosts().find((p) => p.id === id);
    if (!post) throw new ApiError(404, 'Publish target not found');
    return {
      id: post.id,
      contentItemId: post.contentItemId,
      accountId: post.accountId,
      accountName: 'Demo Page',
      platform: 'YOUTUBE',
      title: post.title,
      description: 'Demo description for this scheduled post.',
      tags: ['demo', 'shorts'],
      status:
        post.status === 'PUBLISHED'
          ? 'PUBLISHED'
          : post.status === 'FAILED'
            ? 'FAILED'
            : 'SCHEDULED',
      scheduleMode: 'QUEUE_SLOT',
      scheduledAt: post.scheduledAt,
      publishedAt: post.publishedAt,
      platformPostId: null,
      lastError: null,
      hasVideo: false,
      hasThumbnail: false,
      createdAt: post.publishedAt ?? post.scheduledAt ?? new Date().toISOString(),
    };
  }
  return api.get<PublishTargetDetail>(`/publish/target/${encodeURIComponent(id)}`);
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
  description?: string | null;
  tags?: string[];
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  durationSec: number | null;
  hasThumbnail?: boolean;
  videoEmbedUrl?: string | null;
  thumbnailEmbedUrl?: string | null;
  scheduledAt?: string | null;
  sourceVideoId: string | null;
  sourceUrl: string | null;
  rightsNote: string | null;
}

function mapReviewItem(r: ApiReviewItem): ReviewItem {
  return {
    id: r.id,
    accountId: r.accountId ?? '',
    kind: r.kind,
    title: r.title,
    description: r.description ?? null,
    tags: r.tags ?? [],
    submittedAt: r.submittedAt,
    status: r.status,
    sourceUrl: r.sourceUrl,
    rightsNote: r.rightsNote,
    durationSec: r.durationSec,
    sourceVideoId: r.sourceVideoId,
    hasThumbnail: r.hasThumbnail ?? false,
    videoEmbedUrl: r.videoEmbedUrl ?? null,
    thumbnailEmbedUrl: r.thumbnailEmbedUrl ?? null,
    scheduledAt: r.scheduledAt ?? null,
  };
}

export interface ReviewResult {
  items: ReviewItem[];
  demo: boolean;
}

export async function getReviewView(
  accountId?: string,
  opts?: { excludeScheduled?: boolean },
): Promise<ReviewResult> {
  if (await inDemoMode()) {
    return {
      items: mockReviewItems(accountId, { excludeScheduled: opts?.excludeScheduled }),
      demo: true,
    };
  }
  const params = new URLSearchParams();
  if (accountId) params.set('accountId', accountId);
  // Account Review uses excludeScheduled so held publish packages only appear on
  // the global Review Queue (see listReview on the API).
  if (opts?.excludeScheduled) params.set('excludeScheduled', 'true');
  const qs = params.toString() ? `?${params.toString()}` : '';
  const raw = await api.get<ApiReviewItem[]>(`/content/review${qs}`);
  return { items: raw.map(mapReviewItem), demo: false };
}

/** Row shape returned by GET /content/ai-pipeline (see AiPipelineItemView on the API). */
export interface AiPipelineItem {
  id: string;
  accountId: string | null;
  /** SocialAccount platform when known (YOUTUBE / TIKTOK / FACEBOOK). */
  platform: string | null;
  title: string;
  status: string;
  statusReason: string | null;
  updatedAt: string;
  analysis: string | null;
  script: string | null;
  scriptVariants?: {
    id: string;
    label: string;
    style: string;
    hook: string;
    script: string;
    englishSummary?: string;
    estimatedSpokenSec: number | null;
  }[];
  selectedScriptId?: string | null;
  /** Short on-screen hook options (2–3 words) shown at script approval. */
  hookTextVariants?: { id: string; text: string }[];
  selectedHookTextId?: string | null;
  selectedHookText?: string | null;
  /** Caption template id chosen at script approval (ffmpeg burn-in). */
  selectedCaptionTemplateId?: string | null;
  /** Caption vertical placement (top / upper / center / lower / bottom). */
  selectedCaptionPosition?: string | null;
  /** Caption text color: dark (light text) or light (dark text). */
  selectedCaptionColorMode?: string | null;
  /** Hook vertical placement (enum or 0–100 Y%). */
  selectedHookPosition?: string | null;
  /** Per-video color filter override. */
  selectedColorFilter?: string | null;
  /** English summary for the active narration (non-English channels only). */
  englishSummary?: string;
  metadata: string | null;
  /** Parsed AI publish title (null until metadata is ready). */
  publishTitle: string | null;
  publishDescription: string | null;
  publishTags: string[];
  hasFinalVideo: boolean;
  /** Source/hot-tier ORIGINAL asset (pre-render preview). */
  hasOriginalVideo?: boolean;
  hasThumbnail: boolean;
  videoEmbedUrl?: string | null;
  originalVideoEmbedUrl?: string | null;
  thumbnailEmbedUrl?: string | null;
  /** Per-video bed override (1–100); null = channel default. */
  backgroundBedPercent?: number | null;
}

export async function getAiPipeline(accountId?: string): Promise<AiPipelineItem[]> {
  if (await inDemoMode()) return [];
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
  return api.get<AiPipelineItem[]>(`/content/ai-pipeline${qs}`);
}

export async function approveScript(id: string): Promise<void> {
  await api.post(`/content/${id}/approve-script`);
}

/** Reset an APPROVED-or-FAILED item back to the Review queue so it can be re-approved. */
export async function resetToReview(id: string): Promise<void> {
  await api.post(`/content/${id}/reset-to-review`);
}

/**
 * Retry a FAILED item at the AI step that failed, keeping cached AI outputs so
 * successful prior steps re-hit the cache instead of re-billing.
 */
export async function retryAi(id: string): Promise<void> {
  await api.post(`/content/${id}/retry-ai`);
}

/** Re-run platform-aware metadata generation after render (clears prior AI metadata). */
export async function regenerateMetadata(id: string): Promise<void> {
  await api.post(`/content/${id}/regenerate-metadata`);
}

export async function regenerateScript(id: string): Promise<void> {
  await api.post(`/content/${id}/regenerate-script`);
}

export async function regenerateVoiceover(id: string): Promise<void> {
  await api.post(`/content/${id}/regenerate-voiceover`);
}

/** Re-mix FINAL from existing voiceover (no TTS). Optional per-video bed %. */
export async function regenerateRender(
  id: string,
  opts?: { backgroundBedPercent?: number },
): Promise<void> {
  await api.post(`/content/${id}/rerender`, opts ?? {});
}

export async function deleteContent(id: string): Promise<void> {
  await api.del(`/content/${encodeURIComponent(id)}`);
}

export async function deleteAccount(id: string): Promise<void> {
  await api.del(`/accounts/${encodeURIComponent(id)}`);
}

export async function deleteIdea(id: string): Promise<void> {
  await api.del(`/ideas/${encodeURIComponent(id)}`);
}

export async function deleteSourceVideo(id: string): Promise<void> {
  await api.del(`/sources/video/${encodeURIComponent(id)}`);
}

/** Save owner edits to publish title / description / tags on the content item. */
export async function updatePublishMetadata(
  id: string,
  input: { title: string; description: string; tags: string[] },
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/publish-metadata`, input);
}

/** Save an inline edit of the narration script (AI pipeline panel). */
export async function updateNarrationScript(
  id: string,
  script: string,
  selectedScriptId?: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, {
    script,
    ...(selectedScriptId ? { selectedScriptId } : {}),
  });
}

/** Switch which of the three narration options is active (does not rewrite copy). */
export async function selectNarrationScript(
  id: string,
  selectedScriptId: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedScriptId });
}

export async function selectHookText(
  id: string,
  selectedHookTextId: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedHookTextId });
}

export async function selectCaptionTemplate(
  id: string,
  selectedCaptionTemplateId: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedCaptionTemplateId });
}

export async function selectCaptionPosition(
  id: string,
  selectedCaptionPosition: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedCaptionPosition });
}

export async function selectCaptionColorMode(
  id: string,
  selectedCaptionColorMode: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedCaptionColorMode });
}

export async function selectHookPosition(
  id: string,
  selectedHookPosition: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedHookPosition });
}

export async function selectColorFilter(
  id: string,
  selectedColorFilter: string,
): Promise<AiPipelineItem> {
  return api.patch<AiPipelineItem>(`/content/${id}/script`, { selectedColorFilter });
}

/** Ask AI to rewrite the narration from an instruction; caller PATCHes to save. */
export async function rewriteNarrationScript(
  id: string,
  input: { instruction: string; script?: string },
): Promise<{ script: string }> {
  return api.post<{ script: string }>(`/content/${id}/rewrite-script`, input);
}

/**
 * Schedule an existing content item to one or more accounts (crosspost).
 * Creates one PublishTarget per accountId; metadata is resolved per destination
 * platform on the API (shared copy + per-platform guards).
 */
export async function schedulePublish(
  contentItemId: string,
  accountIdOrIds: string | string[],
  mode: 'NOW' | 'QUEUE_SLOT' | 'FIXED',
  scheduledAt?: string,
): Promise<void> {
  const accountIds = Array.isArray(accountIdOrIds) ? accountIdOrIds : [accountIdOrIds];
  if (accountIds.length === 0) throw new Error('Select at least one destination account.');
  await api.post('/publish', {
    contentItemId,
    targets: accountIds.map((accountId) => ({
      accountId,
      scheduleMode: mode,
      ...(mode === 'FIXED' && scheduledAt ? { scheduledAt } : {}),
    })),
  });
}

/** Force a pending/scheduled/draft/failed target to publish as soon as possible. */
export async function publishTargetNow(publishTargetId: string): Promise<void> {
  await api.patch(`/publish/target/${encodeURIComponent(publishTargetId)}`, { publishNow: true });
}

/** Re-queue a draft/failed publish target. */
export async function retryPublishTarget(publishTargetId: string): Promise<void> {
  await api.patch(`/publish/target/${encodeURIComponent(publishTargetId)}`, { retry: true });
}

/** Change the scheduled publish time for a target (ISO datetime). */
export async function updatePublishTargetSchedule(
  publishTargetId: string,
  scheduledAt: string,
): Promise<void> {
  await api.patch(`/publish/target/${encodeURIComponent(publishTargetId)}`, { scheduledAt });
}

/** Delete from CreatorPilot and optionally from Facebook. */
export async function removePublishTarget(
  publishTargetId: string,
  opts: { deleteFromSystem?: boolean; deleteFromPlatform?: boolean } = {},
): Promise<{ id: string; deletedFromPlatform: boolean; deletedFromSystem: boolean }> {
  return api.post(`/publish/target/${encodeURIComponent(publishTargetId)}/remove`, {
    deleteFromSystem: opts.deleteFromSystem ?? true,
    deleteFromPlatform: opts.deleteFromPlatform ?? false,
  });
}

/** Ask the API to translate an item's title to English (best-effort). */
export async function translateTitle(
  id: string,
): Promise<{ id: string; title: string; originalTitle: string }> {
  return api.post<{ id: string; title: string; originalTitle: string }>(
    `/content/${id}/translate-title`,
  );
}

/** Same-origin URL to stream a content item's video (Next rewrites to the API). */
export function contentMediaUrl(id: string): string {
  return `/api/v1/content/${encodeURIComponent(id)}/media`;
}

/** Same-origin URL to stream the source/hot-tier ORIGINAL (not the rendered FINAL). */
export function contentOriginalMediaUrl(id: string): string {
  return `/api/v1/content/${encodeURIComponent(id)}/media?kind=original`;
}

/** Same-origin URL for a content item's stored thumbnail image. */
export function contentThumbnailUrl(id: string): string {
  return `/api/v1/content/${encodeURIComponent(id)}/media?kind=thumbnail`;
}

/** Resolve whether UI should iframe Drive or stream from the API. */
export async function getContentMediaInfo(
  id: string,
  kind?: 'thumbnail',
): Promise<{ mode: 'embed' | 'stream'; embedUrl: string | null; streamUrl: string }> {
  const qs = kind === 'thumbnail' ? '?kind=thumbnail' : '';
  return api.get(`/content/${encodeURIComponent(id)}/media-info${qs}`);
}

export async function decideReview(id: string, status: ReviewStatus): Promise<void> {
  if (status === 'APPROVED') await api.post(`/content/${id}/approve`);
  else await api.post(`/content/${id}/reject`, {});
}

/** Re-queue a source video for download (clears failed state, resets progress). */
export async function retryDownload(sourceVideoId: string): Promise<void> {
  await api.post(`/sources/video/${encodeURIComponent(sourceVideoId)}/retry-download`);
}

/** Set the rights note on a source video (lifts the review approval gate, docs/04 §3). */
export async function setSourceRights(sourceVideoId: string, rightsNote: string): Promise<void> {
  await api.patch(`/sources/video/${encodeURIComponent(sourceVideoId)}/rights`, { rightsNote });
}

// --- Watched sources (ingestion) -------------------------------------------

interface ApiWatchedSource {
  id: string;
  type: 'KUAISHOU_PROFILE' | 'GENERIC_URL';
  url: string;
  label: string | null;
  checkIntervalMin: number;
  trimStartMs: number;
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  errorNote: string | null;
  targetAccountId: string | null;
  videoCount: number;
  createdAt: string;
}

const SOURCE_TYPE: Record<ApiWatchedSource['type'], SourceType> = {
  KUAISHOU_PROFILE: 'WATCHED_PROFILE',
  GENERIC_URL: 'BULK_IMPORT',
};

/** Map an API watched source to the UI `Source` view (interval min→hours). */
function mapSource(s: ApiWatchedSource): Source {
  return {
    id: s.id,
    accountId: s.targetAccountId ?? '',
    type: SOURCE_TYPE[s.type],
    url: s.url,
    label: s.label ?? s.url,
    // A bulk-import batch never polls, so its interval reads as 0 ("—") in the UI.
    checkIntervalHours: s.type === 'GENERIC_URL' ? 0 : Math.round(s.checkIntervalMin / 60),
    lastCheckedAt: s.lastCheckedAt,
    newItems: s.videoCount,
    status: s.status as SourceStatus,
  };
}

export interface SourcesResult {
  sources: Source[];
  demo: boolean;
}

export async function getSourcesView(accountId: string): Promise<SourcesResult> {
  if (await inDemoMode()) return { sources: mockSources(accountId), demo: true };
  const raw = await api.get<ApiWatchedSource[]>(
    `/sources?accountId=${encodeURIComponent(accountId)}`,
  );
  return { sources: raw.map(mapSource), demo: false };
}

export interface AddWatchedProfileInput {
  url: string;
  label?: string;
  checkIntervalHours: number;
  targetAccountId: string;
}

export async function addWatchedProfile(input: AddWatchedProfileInput): Promise<void> {
  await api.post('/sources', {
    type: 'KUAISHOU_PROFILE',
    url: input.url,
    ...(input.label ? { label: input.label } : {}),
    checkIntervalMin: Math.max(15, Math.round(input.checkIntervalHours * 60)),
    targetAccountId: input.targetAccountId,
  });
}

export async function bulkImportSources(input: {
  urls: string[];
  label?: string;
  targetAccountId: string;
}): Promise<void> {
  await api.post('/sources/import', {
    urls: input.urls,
    ...(input.label ? { label: input.label } : {}),
    targetAccountId: input.targetAccountId,
  });
}

export async function checkSourceNow(id: string): Promise<void> {
  await api.post(`/sources/${encodeURIComponent(id)}/check`);
}

export async function setSourcePaused(id: string, paused: boolean): Promise<void> {
  await api.patch(`/sources/${encodeURIComponent(id)}`, { status: paused ? 'PAUSED' : 'ACTIVE' });
}

export async function deleteSource(id: string): Promise<void> {
  await api.del(`/sources/${encodeURIComponent(id)}`);
}

export type SourceVideoDownloadStatus =
  'PENDING' | 'DOWNLOADING' | 'DONE' | 'FAILED' | 'SKIPPED_DUPLICATE';

export interface SourceVideoView {
  id: string;
  sourceUrl: string;
  sourcePlatformId: string;
  uploaderName: string | null;
  title: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  downloadStatus: SourceVideoDownloadStatus;
  downloadPercent: number;
  downloadEtaSec: number | null;
  downloadSpeedBps: number | null;
  rightsNote: string | null;
  nearDuplicateOfId: string | null;
  createdAt: string;
  downloadQueuePosition?: number | null;
  nextDownloadAt?: string | null;
  nextDownloadLabel?: string | null;
  downloadDripSummary?: string | null;
}

/** List every SourceVideo for one watched source (bulk batch or profile). */
export async function getSourceVideos(sourceId: string): Promise<SourceVideoView[]> {
  return api.get<SourceVideoView[]>(`/sources/videos?sourceId=${encodeURIComponent(sourceId)}`);
}

// --- Scheduling (upcoming queue + free slots) ------------------------------

export interface UpcomingResult {
  scheduled: Array<{
    publishTargetId: string;
    contentItemId: string;
    title: string;
    scheduledAt: string;
    status?: PublishTargetDetail['status'];
  }>;
  failed: Array<{
    publishTargetId: string;
    contentItemId: string;
    title: string;
    scheduledAt: string | null;
    status: PublishTargetDetail['status'];
    lastError: unknown;
    updatedAt: string;
  }>;
  published: Array<{
    publishTargetId: string;
    contentItemId: string;
    title: string;
    publishedAt: string | null;
    scheduledAt: string | null;
    status: 'PUBLISHED';
  }>;
  freeSlots: string[];
  demo: boolean;
}

export async function getUpcomingView(accountId: string): Promise<UpcomingResult> {
  if (await inDemoMode()) {
    const posts = mockPosts(accountId)
      .filter((p) => p.scheduledAt && p.status !== 'PUBLISHED')
      .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));
    const published = mockPosts(accountId)
      .filter((p) => p.status === 'PUBLISHED')
      .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''))
      .slice(0, 10);
    return {
      scheduled: posts.map((p) => ({
        publishTargetId: p.id,
        contentItemId: p.contentItemId,
        title: p.title,
        scheduledAt: p.scheduledAt!,
        status: 'SCHEDULED' as const,
      })),
      failed: [],
      published: published.map((p) => ({
        publishTargetId: p.id,
        contentItemId: p.contentItemId,
        title: p.title,
        publishedAt: p.publishedAt ?? null,
        scheduledAt: p.scheduledAt ?? null,
        status: 'PUBLISHED' as const,
      })),
      freeSlots: [],
      demo: true,
    };
  }
  const data = await api.get<Omit<UpcomingResult, 'demo'>>(
    `/schedule/upcoming?accountId=${encodeURIComponent(accountId)}`,
  );
  return {
    scheduled: data.scheduled ?? [],
    failed: data.failed ?? [],
    published: data.published ?? [],
    freeSlots: data.freeSlots ?? [],
    demo: false,
  };
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
  /** Optional custom thumbnail (YouTube thumbnails.set). */
  thumbnail?: File | null;
  /** Primary account, or multiple destinations for crosspost. */
  accountId: string;
  /** Extra sibling accounts to also create PublishTargets for. */
  additionalAccountIds?: string[];
  scheduleMode: 'NOW' | 'QUEUE_SLOT';
  /** Optional per-target metadata (visibility, tags, YouTube fields, etc.). */
  metadataOverride?: Record<string, unknown>;
}

/**
 * The full manual-upload path: create a content item, stream the file into the
 * hot tier as its FINAL asset, then create publish target(s). Content stays in
 * REVIEW_PENDING so the Review queue can approve before publish runs.
 */
export async function manualPublish(input: ManualPublishInput): Promise<{ contentItemId: string }> {
  const content = await api.post<ApiContentItem>('/content', {
    title: input.title,
    type: 'MANUAL_UPLOAD',
  });
  await api.upload(
    `/storage/upload?contentItemId=${encodeURIComponent(content.id)}&kind=FINAL&accountId=${encodeURIComponent(input.accountId)}`,
    input.file,
  );
  if (input.thumbnail) {
    await api.upload(
      `/storage/upload?contentItemId=${encodeURIComponent(content.id)}&kind=THUMBNAIL&accountId=${encodeURIComponent(input.accountId)}`,
      input.thumbnail,
    );
  }
  const accountIds = [
    input.accountId,
    ...(input.additionalAccountIds ?? []).filter((id) => id !== input.accountId),
  ];
  await api.post('/publish', {
    contentItemId: content.id,
    targets: accountIds.map((accountId) => ({
      accountId,
      scheduleMode: input.scheduleMode,
      ...(input.metadataOverride ? { metadataOverride: input.metadataOverride } : {}),
    })),
  });
  return { contentItemId: content.id };
}

// ── Phase 4: Ideas ──────────────────────────────────────────────────────────

interface ApiIdea {
  id: string;
  accountId: string;
  title: string;
  angle: string;
  hook: string;
  rationale: string;
  category: string | null;
  viralScore?: number | null;
  status: string;
  packageStatus: string;
  packageStage?: string | null;
  packageStageError?: string | null;
  packageStageLabel?: string | null;
  requestedVideoDurationSec: number | null;
  requestedClipDurationSec: number | null;
  rejectionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
  hasBrief: boolean;
  hasFinalVideo?: boolean;
  hasThumbnail?: boolean;
  contentItemId?: string | null;
  contentStatus?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  voiceoverStatus?: string | null;
  voiceoverReady?: boolean;
  brief?: ApiProductionBrief | null;
}

interface ApiProductionBrief {
  id: string;
  ideaId: string;
  researchSummary: string;
  storySummary?: string;
  script: string;
  narrationScript?: string;
  englishSummary?: string;
  presentationMode?: string;
  sceneBreakdown: unknown[];
  characterPrompts: unknown[];
  editingInstructions: string;
  targetDurationSec: number | null;
  videoTitle: string;
  videoDescription: string;
  thumbnailPrompt: string;
  thumbnailNegativePrompt?: string;
  universalVideoPrompt?: string;
  thumbnailPromptVariants?: string;
  voiceoverStatus?: string;
  voiceoverReady?: boolean;
  packageStage?: string;
  packageStageError?: string | null;
  packageStageLabel?: string;
  timedTranscript?: Array<{ startMs: number; endMs: number; text: string }>;
  transcriptReady?: boolean;
  voiceIdUsed?: string | null;
  version: number;
}

/** Defensive title parse if the API returns legacy fenced/stringified JSON. */
function displayIdeaTitle(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return 'Untitled Idea';
  if (!/^(```|[[{])/.test(trimmed)) return trimmed;

  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\r?\n([\s\S]*?)(?:\r?\n?```)?\s*$/);
  const body = (fenced?.[1] ?? trimmed).trim();

  try {
    const parsed = JSON.parse(body) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const title = (first as { title?: unknown } | null)?.title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  } catch {
    /* truncated JSON — fall back to a field scan */
  }

  const match = body.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match?.[1]) {
    const recovered = match[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim();
    if (recovered) return recovered;
  }
  return 'Untitled Idea';
}

function mapBrief(b: ApiProductionBrief): ProductionBrief {
  const {
    editingInstructions,
    thumbnailNegativePrompt,
    universalVideoPrompt,
    thumbnailPromptVariants,
  } = splitEditingExtras(b.editingInstructions ?? '', {
    thumbnailNegativePrompt: b.thumbnailNegativePrompt ?? '',
    universalVideoPrompt: b.universalVideoPrompt ?? '',
    thumbnailPromptVariants: b.thumbnailPromptVariants ?? '',
  });
  const scenes = (Array.isArray(b.sceneBreakdown) ? b.sceneBreakdown : []).map((entry, index) => {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const rawDialogue = row.dialogue;
    const dialogue = Array.isArray(rawDialogue)
      ? rawDialogue
          .map((line) => {
            const item = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>;
            return {
              speaker: String(item.speaker ?? item.character ?? '').trim(),
              line: String(item.line ?? item.text ?? '').trim(),
            };
          })
          .filter((line) => line.line)
      : typeof rawDialogue === 'string'
        ? rawDialogue
            .split(/\r?\n/)
            .map((line) => {
              const match = line.match(/^\s*([^:]{1,60}):\s*(.+)$/);
              return match
                ? { speaker: (match[1] ?? '').trim(), line: (match[2] ?? '').trim() }
                : { speaker: '', line: line.trim() };
            })
            .filter((line) => line.line)
        : [];
    return {
      sceneIndex: typeof row.sceneIndex === 'number' ? row.sceneIndex : index + 1,
      durationSec: typeof row.durationSec === 'number' ? row.durationSec : null,
      startMs: typeof row.startMs === 'number' ? row.startMs : null,
      endMs: typeof row.endMs === 'number' ? row.endMs : null,
      narrationSegment: String(row.narrationSegment ?? '').trim(),
      imagePrompt: String(row.imagePrompt ?? row.image ?? '').trim(),
      animationPrompt: String(row.animationPrompt ?? row.videoPrompt ?? '').trim(),
      negativePrompt: String(row.negativePrompt ?? row.negative ?? '').trim(),
      animationNegativePrompt: String(
        row.animationNegativePrompt ?? row.videoNegativePrompt ?? row.animationNegative ?? '',
      ).trim(),
      dialogue,
    };
  });
  const characters = (Array.isArray(b.characterPrompts) ? b.characterPrompts : []).map(
    (entry, index) => {
      if (typeof entry === 'string') {
        return {
          name: `Character ${index + 1}`,
          appearance: entry.trim(),
          wardrobe: '',
          age: '',
          personality: '',
          consistencyDetails: entry.trim(),
        };
      }
      const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      return {
        name: String(row.name ?? row.characterName ?? `Character ${index + 1}`).trim(),
        appearance: String(row.appearance ?? row.visualDescription ?? row.description ?? '').trim(),
        wardrobe: String(row.wardrobe ?? row.clothing ?? '').trim(),
        age: String(row.age ?? row.ageRange ?? '').trim(),
        personality: String(row.personality ?? '').trim(),
        consistencyDetails: String(
          row.consistencyDetails ?? row.consistency ?? row.generationPrompt ?? row.prompt ?? '',
        ).trim(),
      };
    },
  );
  const voiceoverStatus = (b.voiceoverStatus as ProductionBrief['voiceoverStatus']) ?? 'NONE';
  return {
    id: b.id,
    ideaId: b.ideaId,
    researchSummary: b.researchSummary,
    storySummary: b.storySummary ?? b.researchSummary,
    script: b.script,
    narrationScript: b.narrationScript ?? (voiceoverStatus === 'NONE' ? '' : b.script),
    englishSummary: b.englishSummary?.trim() || '',
    presentationMode: b.presentationMode ?? '',
    sceneBreakdown: scenes,
    characterPrompts: characters,
    editingInstructions,
    targetDurationSec: b.targetDurationSec,
    videoTitle: b.videoTitle ?? '',
    videoDescription: b.videoDescription ?? '',
    thumbnailPrompt: b.thumbnailPrompt ?? '',
    thumbnailNegativePrompt,
    universalVideoPrompt,
    thumbnailPromptVariants,
    voiceoverStatus,
    voiceoverReady: !!b.voiceoverReady,
    packageStage: (b.packageStage as ProductionBrief['packageStage']) ?? 'NONE',
    packageStageError: b.packageStageError ?? null,
    packageStageLabel: b.packageStageLabel ?? b.packageStage ?? 'NONE',
    timedTranscript: Array.isArray(b.timedTranscript) ? b.timedTranscript : [],
    transcriptReady: !!b.transcriptReady,
    voiceIdUsed: b.voiceIdUsed ?? null,
    version: b.version,
  };
}

/** Pull optional editingExtras suffixes out of editingInstructions. */
function splitEditingExtras(
  editingInstructions: string,
  explicit: {
    thumbnailNegativePrompt?: string;
    universalVideoPrompt?: string;
    thumbnailPromptVariants?: string;
  } = {},
): {
  editingInstructions: string;
  thumbnailNegativePrompt: string;
  universalVideoPrompt: string;
  thumbnailPromptVariants: string;
} {
  let rest = editingInstructions ?? '';
  let thumbnailNegativePrompt = (explicit.thumbnailNegativePrompt ?? '').trim();
  let thumbnailPromptVariants = (explicit.thumbnailPromptVariants ?? '').trim();
  let universalVideoPrompt = (explicit.universalVideoPrompt ?? '').trim();

  const takeMarker = (markerTitle: string, already: string): string => {
    if (already) return already;
    const withBreak = `\n\n${markerTitle}\n`;
    const atStart = `${markerTitle}\n`;
    const idx = rest.lastIndexOf(withBreak);
    if (idx >= 0) {
      const value = rest.slice(idx + withBreak.length).trim();
      rest = rest.slice(0, idx).trimEnd();
      return value;
    }
    if (rest.startsWith(atStart)) {
      const value = rest.slice(atStart.length).trim();
      rest = '';
      return value;
    }
    return '';
  };

  thumbnailNegativePrompt = takeMarker('Thumbnail negative prompt:', thumbnailNegativePrompt);
  thumbnailPromptVariants = takeMarker('Thumbnail prompt variants:', thumbnailPromptVariants);
  universalVideoPrompt = takeMarker('Universal video prompt:', universalVideoPrompt);

  return {
    editingInstructions: rest,
    thumbnailNegativePrompt,
    universalVideoPrompt,
    thumbnailPromptVariants,
  };
}

function mapIdea(i: ApiIdea): Idea {
  const viral = i.viralScore ?? null;
  return {
    id: i.id,
    accountId: i.accountId,
    title: displayIdeaTitle(i.title),
    angle: i.angle,
    hook: i.hook,
    rationale: i.rationale,
    category: (i.category as Idea['category']) ?? null,
    stage: i.status as IdeaStage,
    packageStatus: (i.packageStatus as Idea['packageStatus']) ?? 'NONE',
    packageStage: (i.packageStage as Idea['packageStage']) ?? null,
    packageStageError: i.packageStageError ?? null,
    packageStageLabel: i.packageStageLabel ?? null,
    requestedVideoDurationSec: i.requestedVideoDurationSec ?? null,
    requestedClipDurationSec: i.requestedClipDurationSec ?? null,
    rejectionReason: i.rejectionReason,
    decidedAt: i.decidedAt,
    viralScore: viral,
    predictedScore: viral ?? 0,
    createdAt: i.createdAt,
    hasBrief: i.hasBrief ?? !!i.brief,
    hasFinalVideo: !!i.hasFinalVideo,
    hasThumbnail: !!i.hasThumbnail,
    contentItemId: i.contentItemId ?? null,
    contentStatus: (i.contentStatus as Idea['contentStatus']) ?? null,
    scheduledAt: i.scheduledAt ?? null,
    publishedAt: i.publishedAt ?? null,
    voiceoverStatus: (i.voiceoverStatus as Idea['voiceoverStatus']) ?? null,
    voiceoverReady: !!i.voiceoverReady,
    brief: i.brief ? mapBrief(i.brief) : null,
  };
}

export interface IdeasResult {
  ideas: Idea[];
  demo: boolean;
}

export interface IdeaGenerationStatus {
  runId: string | null;
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

export async function getIdeasView(accountId: string): Promise<IdeasResult> {
  if (await inDemoMode()) return { ideas: mockIdeas(accountId), demo: true };
  const raw = await api.get<ApiIdea[]>(`/accounts/${encodeURIComponent(accountId)}/ideas`);
  return { ideas: raw.map(mapIdea), demo: false };
}

export async function getIdeasGenerationStatus(accountId: string): Promise<IdeaGenerationStatus> {
  return api.get<IdeaGenerationStatus>(
    `/accounts/${encodeURIComponent(accountId)}/ideas/generation-status`,
  );
}

export async function generateIdeas(
  accountId: string,
  count = 50,
  options?: { topicSeed?: string },
): Promise<{ runId: string }> {
  const topicSeed = options?.topicSeed?.trim();
  return api.post<{ runId: string }>(`/accounts/${encodeURIComponent(accountId)}/ideas/generate`, {
    count,
    ...(topicSeed ? { topicSeed } : {}),
  });
}

export async function approveIdea(ideaId: string): Promise<void> {
  await api.post(`/ideas/${encodeURIComponent(ideaId)}/approve`);
}

export async function rejectIdea(ideaId: string, reason?: string): Promise<void> {
  await api.post(`/ideas/${encodeURIComponent(ideaId)}/reject`, { rejectionReason: reason ?? '' });
}

export async function generateIdeaPackage(
  ideaId: string,
  input: { videoDurationSec: number; clipDurationSec: 8 | 10 | 15 | 30 },
): Promise<void> {
  await api.post(`/ideas/${encodeURIComponent(ideaId)}/package`, input);
}

/** Resume a FAILED package from the failed stage (keeps prior successful artifacts). */
export async function retryIdeaPackage(ideaId: string): Promise<void> {
  await api.post(`/ideas/${encodeURIComponent(ideaId)}/package/retry`);
}

export async function regenerateIdeaPackage(
  ideaId: string,
  stage: 'script' | 'voiceover' | 'visuals',
): Promise<void> {
  await api.post(`/ideas/${encodeURIComponent(ideaId)}/package/regenerate`, { stage });
}

export async function getIdeaPackage(ideaId: string): Promise<ProductionBrief> {
  const raw = await api.get<ApiProductionBrief>(`/ideas/${encodeURIComponent(ideaId)}/package`);
  return mapBrief(raw);
}

export async function markIdeaPackageDone(ideaId: string): Promise<void> {
  await api.post(`/ideas/${encodeURIComponent(ideaId)}/package/done`);
}

export function ideaVoiceoverUrl(ideaId: string): string {
  return `/api/v1/ideas/${encodeURIComponent(ideaId)}/voiceover`;
}

export function ideaTranscriptUrl(ideaId: string, format: 'srt' | 'vtt' = 'srt'): string {
  return `/api/v1/ideas/${encodeURIComponent(ideaId)}/transcript?format=${format}`;
}

export interface IdeaUploadResult {
  contentItemId: string;
  /** False when the assets stored but the publish target could not be created. */
  scheduled: boolean;
  scheduleError: string | null;
}

/**
 * Owner upload path for an idea: create linked content item, upload FINAL + THUMBNAIL,
 * mark idea UPLOADED (requires both assets, releases the next-package gate),
 * then create a publish target held as PENDING until Review Approve.
 * Scheduling runs last so a publish-config problem cannot strand a finished
 * video outside the gate. Content stays REVIEW_PENDING for human approval.
 */
export async function uploadIdeaFinishedVideo(input: {
  ideaId: string;
  title?: string;
  file: File;
  thumbnail: File;
  accountId: string;
  /** Extra sibling accounts for crosspost (one PublishTarget each). */
  additionalAccountIds?: string[];
  scheduleMode: 'NOW' | 'QUEUE_SLOT';
  onVideoProgress?: (percent: number) => void;
  onThumbnailProgress?: (percent: number) => void;
}): Promise<IdeaUploadResult> {
  const content = await api.post<{ id: string }>(
    `/ideas/${encodeURIComponent(input.ideaId)}/upload`,
    {
      title: input.title,
      scheduleMode: input.scheduleMode,
    },
  );
  await api.uploadWithProgress(
    `/storage/upload?contentItemId=${encodeURIComponent(content.id)}&kind=FINAL`,
    input.file,
    input.onVideoProgress ?? (() => undefined),
  );
  await api.uploadWithProgress(
    `/storage/upload?contentItemId=${encodeURIComponent(content.id)}&kind=THUMBNAIL`,
    input.thumbnail,
    input.onThumbnailProgress ?? (() => undefined),
  );
  await api.post(`/ideas/${encodeURIComponent(input.ideaId)}/mark-uploaded`);

  const accountIds = [
    input.accountId,
    ...(input.additionalAccountIds ?? []).filter((id) => id !== input.accountId),
  ];
  try {
    await api.post('/publish', {
      contentItemId: content.id,
      targets: accountIds.map((accountId) => ({
        accountId,
        scheduleMode: input.scheduleMode,
      })),
    });
    return { contentItemId: content.id, scheduled: true, scheduleError: null };
  } catch (error) {
    return {
      contentItemId: content.id,
      scheduled: false,
      scheduleError:
        error instanceof Error ? error.message : 'Could not create a publish target.',
    };
  }
}

// ── Phase 4: Dramas ─────────────────────────────────────────────────────────

interface ApiDramaSeries {
  id: string;
  accountId: string;
  title: string;
  genre: string;
  theme: string;
  audience: string;
  episodeCount: number;
  episodeDurationSec: number;
  seriesBible: unknown | null;
  characterSheets: unknown[];
  status: string;
  createdAt: string;
  episodeStats?: {
    total: number;
    generated: number;
    inProduction: number;
    uploaded: number;
    published: number;
  };
}

function mapDramaSeries(d: ApiDramaSeries): DramaSeries {
  const stats = d.episodeStats;
  const produced = stats
    ? stats.generated + stats.inProduction + stats.uploaded + stats.published
    : 0;
  return {
    id: d.id,
    accountId: d.accountId,
    title: d.title,
    genre: d.genre,
    theme: d.theme,
    audience: d.audience,
    episodes: d.episodeCount,
    producedEpisodes: produced,
    episodeDurationSec: d.episodeDurationSec,
    seriesBible: d.seriesBible,
    characterSheets: d.characterSheets,
    status: d.status as DramaStatus,
    createdAt: d.createdAt,
  };
}

export interface DramasResult {
  dramas: DramaSeries[];
  demo: boolean;
}

export async function getDramasView(accountId: string): Promise<DramasResult> {
  if (await inDemoMode()) return { dramas: mockDramas(accountId), demo: true };
  const raw = await api.get<ApiDramaSeries[]>(`/accounts/${encodeURIComponent(accountId)}/dramas`);
  return { dramas: raw.map(mapDramaSeries), demo: false };
}

export interface CreateSeriesInput {
  title: string;
  genre: string;
  theme: string;
  audience: string;
  episodeCount: number;
  episodeDurationSec: number;
  styleReferences?: string;
}

export async function createDramaSeries(
  accountId: string,
  input: CreateSeriesInput,
): Promise<void> {
  await api.post(`/accounts/${encodeURIComponent(accountId)}/dramas`, input);
}

export async function generateEpisode(seriesId: string, episodeNumber: number): Promise<void> {
  await api.post(`/dramas/${encodeURIComponent(seriesId)}/episodes/${episodeNumber}/generate`);
}

export async function regenerateBible(seriesId: string): Promise<void> {
  await api.post(`/dramas/${encodeURIComponent(seriesId)}/regenerate-bible`);
}

// ── Phase 4: Worker Tasks ───────────────────────────────────────────────────

interface ApiWorkerTask {
  id: string;
  accountId: string;
  title: string;
  status: string;
  assignedAt: string;
  uploadedAt: string | null;
  worker: { id: string; displayName: string };
  briefId: string | null;
  episodeId: string | null;
  revisionNotes: string[];
}

function mapWorkerTask(t: ApiWorkerTask): WorkerTask {
  return {
    id: t.id,
    accountId: t.accountId,
    title: t.title,
    assignee: t.worker.displayName,
    assigneeId: t.worker.id,
    status: t.status as TaskStatus,
    assignedAt: t.assignedAt,
    uploadedAt: t.uploadedAt,
    dueAt: null,
    briefId: t.briefId,
    episodeId: t.episodeId,
    revisionNotes: t.revisionNotes,
  };
}

export interface TasksResult {
  tasks: WorkerTask[];
  demo: boolean;
}

export async function getTasksView(): Promise<TasksResult> {
  if (await inDemoMode()) return { tasks: mockTasks(), demo: true };
  const raw = await api.get<ApiWorkerTask[]>('/tasks');
  return { tasks: raw.map(mapWorkerTask), demo: false };
}

export async function getMyTasksView(): Promise<TasksResult> {
  if (await inDemoMode()) return { tasks: mockTasks(), demo: true };
  const raw = await api.get<ApiWorkerTask[]>('/tasks/mine');
  return { tasks: raw.map(mapWorkerTask), demo: false };
}

export async function startTask(taskId: string): Promise<void> {
  await api.post(`/tasks/${encodeURIComponent(taskId)}/start`);
}

export async function requestRevision(taskId: string, note: string): Promise<void> {
  await api.post(`/tasks/${encodeURIComponent(taskId)}/request-revision`, { note });
}

export async function acceptTask(taskId: string): Promise<void> {
  await api.post(`/tasks/${encodeURIComponent(taskId)}/accept`);
}

// ── Phase 4: Competitor Channels ────────────────────────────────────────────

interface ApiCompetitorChannel {
  id: string;
  ownAccountId: string;
  youtubeChannelId: string;
  channelUrl: string | null;
  name: string;
  role: 'COMPETITOR' | 'SOURCE';
  checkIntervalMin: number;
  status: 'ACTIVE' | 'PAUSED' | 'ERROR';
  lastCheckedAt: string | null;
  videoCount: number;
  errorNote: string | null;
  performanceAnalyzedAt?: string | null;
  performanceInsights?: CompetitorChannel['performanceInsights'];
}

function mapCompetitor(c: ApiCompetitorChannel): CompetitorChannel {
  return {
    id: c.id,
    ownAccountId: c.ownAccountId,
    youtubeChannelId: c.youtubeChannelId,
    channelUrl: c.channelUrl ?? null,
    name: c.name,
    role: c.role ?? 'COMPETITOR',
    checkIntervalMin: c.checkIntervalMin,
    status: c.status,
    lastCheckedAt: c.lastCheckedAt,
    videoCount: c.videoCount,
    errorNote: c.errorNote,
    performanceAnalyzedAt: c.performanceAnalyzedAt ?? null,
    performanceInsights: c.performanceInsights ?? null,
  };
}

export interface CompetitorsResult {
  competitors: CompetitorChannel[];
  demo: boolean;
}

export async function getCompetitorsView(accountId: string): Promise<CompetitorsResult> {
  if (await inDemoMode()) return { competitors: [], demo: true };
  const raw = await api.get<ApiCompetitorChannel[]>(
    `/accounts/${encodeURIComponent(accountId)}/competitors`,
  );
  return { competitors: raw.map(mapCompetitor), demo: false };
}

export async function addCompetitor(
  accountId: string,
  input: {
    urlOrHandle?: string;
    youtubeChannelId?: string;
    name?: string;
    checkIntervalMin?: number;
    role?: 'COMPETITOR' | 'SOURCE';
  },
): Promise<void> {
  await api.post(`/accounts/${encodeURIComponent(accountId)}/competitors`, {
    checkIntervalMin: 1440,
    ...input,
  });
}

export async function patchCompetitor(
  id: string,
  input: {
    name?: string;
    checkIntervalMin?: number;
    status?: 'ACTIVE' | 'PAUSED';
    role?: 'COMPETITOR' | 'SOURCE';
  },
): Promise<void> {
  await api.patch(`/competitors/${encodeURIComponent(id)}`, input);
}

export async function deleteCompetitor(id: string): Promise<void> {
  await api.del(`/competitors/${encodeURIComponent(id)}`);
}

export async function checkCompetitorNow(id: string): Promise<void> {
  await api.post(`/competitors/${encodeURIComponent(id)}/check`);
}

export async function analyzeCompetitorNow(id: string): Promise<void> {
  await api.post(`/competitors/${encodeURIComponent(id)}/analyze`);
}

export interface CompetitorVideoRow {
  id: string;
  videoId: string;
  title: string;
  views: string;
  publishedAt: string | null;
  durationSec: number | null;
}

export interface CompetitorVideoPage {
  items: CompetitorVideoRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
  sort: 'newest' | 'views';
}

export async function getCompetitorVideos(
  competitorId: string,
  opts?: { limit?: number; offset?: number; cursor?: string; sort?: 'newest' | 'views' },
): Promise<CompetitorVideoPage> {
  const params = new URLSearchParams();
  params.set('limit', String(opts?.limit ?? 20));
  if (opts?.cursor) params.set('cursor', opts.cursor);
  else if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.sort) params.set('sort', opts.sort);
  return api.get<CompetitorVideoPage>(
    `/competitors/${encodeURIComponent(competitorId)}/videos?${params.toString()}`,
  );
}

// ── Phase 5: Analytics ──────────────────────────────────────────────────────

export interface AnalyticsOverview {
  totalFollowers: number;
  totalViews: number;
  totalRevenue: string;
  publishedToday: number;
  failedToday: number;
  scheduledCount: number;
  pendingReviews: number;
  openIncidents: number;
  aiSpendToday: string;
}

export interface CountryRow {
  country: string;
  views: number;
  pct: number;
}
export interface AgeRow {
  range: string;
  pct: number;
}
export interface SourceRow {
  source: string;
  views: number;
  pct: number;
}
export interface DeviceRow {
  device: string;
  pct: number;
}

export interface AccountSnapshot {
  date: string;
  followers: number;
  views: number;
  uniqueViewers: number;
  watchTimeMin: number;
  impressions: number;
  ctr: number;
  revenue: string;
  rpm: string;
  engagements: number;
  retentionRate: number;
  trafficCountries: CountryRow[];
  ageGroups: AgeRow[];
  genderSplit: { male?: number; female?: number; other?: number };
  trafficSources: SourceRow[];
  deviceSplit: DeviceRow[];
}

export interface AccountMetrics {
  accountId: string;
  from: string;
  to: string;
  totals: {
    views: number;
    uniqueViewers: number;
    watchTimeMin: number;
    revenue: string;
    followersDelta: number;
    engagements: number;
    impressions: number;
    avgCtr: number;
    avgRetentionRate: number;
  };
  latest?: AccountSnapshot;
  snapshots: AccountSnapshot[];
}

export interface PostTableRow {
  publishTargetId: string;
  contentTitle: string;
  publishedAt: string | null;
  platformPostId: string | null;
  views: number;
  uniqueViewers: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  impressions: number;
  ctr: number;
  watchTimeMin: number;
  averageViewDurationSec: number;
  retentionRate: number;
}

export interface PostSnapshot {
  date: string;
  views: number;
  uniqueViewers: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  watchTimeMin: number;
  averageViewDurationSec: number;
  impressions: number;
  ctr: number;
  retentionRate: number;
  trafficCountries: CountryRow[];
  ageGroups: AgeRow[];
  genderSplit: { male?: number; female?: number; other?: number };
  trafficSources: SourceRow[];
  deviceSplit: DeviceRow[];
}

export interface PostMetrics {
  publishTargetId: string;
  contentTitle: string;
  accountId: string;
  publishedAt: string | null;
  platformPostId: string | null;
  snapshots: PostSnapshot[];
  retentionCurve: unknown[];
}

export interface AiUsageMetrics {
  from: string;
  to: string;
  totals: {
    totalCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: string;
  };
  rows: Array<{
    date: string;
    providerId: string;
    task: string;
    totalCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    ttsSeconds: number;
    estimatedCostUsd: string;
  }>;
}

export interface WorkerProductivity {
  snapshots: Array<{
    userId: string;
    weekStart: string;
    tasksAssigned: number;
    tasksCompleted: number;
    medianHoursToComplete: number | null;
    revisionRate: number;
  }>;
  currentAssignments: Array<{
    workerId: string;
    workerName: string;
    activeTasks: number;
  }>;
}

export interface SystemHealth {
  queueDepths: Record<string, number>;
  totalAssets: number;
  totalAssetBytes: string;
  activeWatchers: number;
  errorWatchers: number;
  activeCompetitors: number;
  errorCompetitors: number;
  lastAccountSyncAt: string | null;
  lastPostSyncAt: string | null;
}

export async function getOverviewView(): Promise<{ overview: AnalyticsOverview; demo: boolean }> {
  if (await inDemoMode()) {
    const { getRollups } = await import('./mock-data');
    const r = getRollups();
    return {
      overview: {
        totalFollowers: r.totalFollowers,
        totalViews: r.views30d,
        totalRevenue: '0',
        publishedToday: r.publishedToday,
        failedToday: r.failed,
        scheduledCount: r.scheduled,
        pendingReviews: r.pendingReviews,
        openIncidents: r.openIncidents,
        aiSpendToday: '0',
      },
      demo: true,
    };
  }
  const overview = await api.get<AnalyticsOverview>('/analytics/overview');
  return { overview, demo: false };
}

export async function getAccountMetrics(
  accountId: string,
  from?: string,
  to?: string,
): Promise<AccountMetrics> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api.get<AccountMetrics>(
    `/analytics/accounts/${encodeURIComponent(accountId)}${qs ? `?${qs}` : ''}`,
  );
}

export async function getAccountPostMetrics(
  accountId: string,
  from?: string,
  to?: string,
): Promise<PostTableRow[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api.get<PostTableRow[]>(
    `/analytics/accounts/${encodeURIComponent(accountId)}/posts${qs ? `?${qs}` : ''}`,
  );
}

export async function getPostMetricsView(publishTargetId: string): Promise<PostMetrics> {
  if (await inDemoMode()) {
    return {
      publishTargetId,
      contentTitle: mockPosts().find((p) => p.id === publishTargetId)?.title ?? 'Demo post',
      accountId: mockPosts().find((p) => p.id === publishTargetId)?.accountId ?? '',
      publishedAt: mockPosts().find((p) => p.id === publishTargetId)?.publishedAt ?? null,
      platformPostId: null,
      snapshots: [],
      retentionCurve: [],
    };
  }
  return api.get<PostMetrics>(`/analytics/posts/${encodeURIComponent(publishTargetId)}`);
}

export async function getAiUsageMetrics(from?: string, to?: string): Promise<AiUsageMetrics> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api.get<AiUsageMetrics>(`/analytics/ai-usage${qs ? `?${qs}` : ''}`);
}

export async function getWorkerProductivity(
  from?: string,
  to?: string,
): Promise<WorkerProductivity> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  return api.get<WorkerProductivity>(`/analytics/workers${qs ? `?${qs}` : ''}`);
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return api.get<SystemHealth>('/analytics/system');
}

export async function triggerAccountSync(accountId: string): Promise<void> {
  await api.post(`/analytics/accounts/${encodeURIComponent(accountId)}/sync`);
}

export async function triggerPostSync(publishTargetId: string): Promise<void> {
  await api.post(`/analytics/posts/${encodeURIComponent(publishTargetId)}/sync`);
}

// ── Phase 10: Manual mode ───────────────────────────────────────────────────

export interface ConnectManualInput {
  platform: Platform;
  name: string;
  handle?: string;
  externalId?: string;
  contentType: ContentType;
  dramasEnabled: boolean;
  schedulingPrefs?: unknown;
}

export async function connectManual(input: ConnectManualInput): Promise<{ id: string }> {
  return api.post<{ id: string }>('/accounts/connect/manual', input);
}

/** Trigger a browser download of the target's rendered final file. */
export function downloadTargetUrl(publishTargetId: string): string {
  return `/api/v1/publish/target/${encodeURIComponent(publishTargetId)}/download`;
}

export async function markTargetPublished(
  publishTargetId: string,
  platformPostId?: string,
): Promise<void> {
  await api.post(`/publish/target/${encodeURIComponent(publishTargetId)}/mark-published`, {
    ...(platformPostId ? { platformPostId } : {}),
  });
}
