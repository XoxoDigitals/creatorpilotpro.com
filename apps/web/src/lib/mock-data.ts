/**
 * MOCK — replaced by the API client in Phase 1.
 *
 * Believable sample data shaped exactly like `domain-types.ts`. Every page reads
 * the app through the accessor functions at the bottom of this file; in Phase 1
 * those bodies become `apiFetch(...)` calls and nothing else has to change.
 */
import type {
  Account,
  DramaSeries,
  Idea,
  Incident,
  Post,
  ReviewItem,
  Source,
  WorkerTask,
} from './domain-types';

/** Hours/days-from-now helpers keep the mock feeling "live" without a fixed date. */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const from = (ms: number) => new Date(Date.now() + ms).toISOString();

export const accounts: Account[] = [
  {
    id: 'mindful-minutes',
    name: 'Mindful Minutes',
    handle: '@mindfulminutes',
    platform: 'YOUTUBE',
    contentType: 'AI',
    connectionMethod: 'OWN_APP',
    dramasEnabled: false,
    avatarUrl: null,
    health: 'HEALTHY',
    connection: 'CONNECTED',
    tokenExpiresAt: from(38 * DAY),
    followers: 184_300,
    views30d: 2_410_000,
    scheduledCount: 6,
    openIncidents: 0,
    monetized: true,
    paused: false,
    createdAt: from(-220 * DAY),
  },
  {
    id: 'viral-clips-daily',
    name: 'Viral Clips Daily',
    handle: '@viralclipsdaily',
    platform: 'YOUTUBE',
    contentType: 'REPURPOSED',
    connectionMethod: 'POSTQUED',
    dramasEnabled: false,
    avatarUrl: null,
    health: 'WARNING',
    connection: 'EXPIRING',
    tokenExpiresAt: from(2 * DAY),
    followers: 92_800,
    views30d: 1_150_000,
    scheduledCount: 11,
    openIncidents: 1,
    monetized: true,
    paused: false,
    createdAt: from(-140 * DAY),
  },
  {
    id: 'daily-recipes',
    name: 'Daily Recipes',
    handle: 'Daily Recipes',
    platform: 'FACEBOOK',
    contentType: 'REPURPOSED',
    connectionMethod: 'OWN_APP',
    dramasEnabled: false,
    avatarUrl: null,
    health: 'HEALTHY',
    connection: 'CONNECTED',
    tokenExpiresAt: from(51 * DAY),
    followers: 47_600,
    views30d: 640_000,
    scheduledCount: 4,
    openIncidents: 0,
    monetized: false,
    paused: false,
    createdAt: from(-90 * DAY),
  },
  {
    id: 'neon-drama-shorts',
    name: 'Neon Drama Shorts',
    handle: '@neondrama',
    platform: 'TIKTOK',
    contentType: 'AI',
    connectionMethod: 'POSTQUED',
    dramasEnabled: true,
    avatarUrl: null,
    health: 'HEALTHY',
    connection: 'CONNECTED',
    tokenExpiresAt: from(29 * DAY),
    followers: 311_500,
    views30d: 5_820_000,
    scheduledCount: 9,
    openIncidents: 0,
    monetized: false,
    paused: false,
    createdAt: from(-70 * DAY),
  },
  {
    id: 'trendy-bytes',
    name: 'Trendy Bytes',
    handle: '@trendybytes',
    platform: 'TIKTOK',
    contentType: 'MIXED',
    connectionMethod: 'POSTQUED',
    dramasEnabled: true,
    avatarUrl: null,
    health: 'CRITICAL',
    connection: 'DISCONNECTED',
    tokenExpiresAt: from(-3 * DAY),
    followers: 128_900,
    views30d: 980_000,
    scheduledCount: 2,
    openIncidents: 2,
    monetized: false,
    paused: true,
    createdAt: from(-55 * DAY),
  },
];

export const posts: Post[] = [
  // Mindful Minutes (AI, YouTube)
  { id: 'p1', accountId: 'mindful-minutes', title: '5-Minute Morning Reset', status: 'PUBLISHED', scheduledAt: null, publishedAt: from(-2 * DAY), views: 84_200, accent: 'violet' },
  { id: 'p2', accountId: 'mindful-minutes', title: 'Box Breathing for Focus', status: 'SCHEDULED', scheduledAt: from(1 * DAY), publishedAt: null, views: null, accent: 'violet' },
  { id: 'p3', accountId: 'mindful-minutes', title: 'Sleep Story: Quiet Coast', status: 'SCHEDULED', scheduledAt: from(3 * DAY), publishedAt: null, views: null, accent: 'indigo' },
  { id: 'p4', accountId: 'mindful-minutes', title: 'Anxiety Off-Ramp', status: 'IN_REVIEW', scheduledAt: null, publishedAt: null, views: null, accent: 'amber' },
  // Viral Clips Daily (REPURPOSED, YouTube)
  { id: 'p5', accountId: 'viral-clips-daily', title: 'Top 10 Fails of the Week', status: 'PUBLISHED', scheduledAt: null, publishedAt: from(-1 * DAY), views: 41_500, accent: 'sky' },
  { id: 'p6', accountId: 'viral-clips-daily', title: 'Street Magician Compilation', status: 'FAILED', scheduledAt: from(-4 * HOUR), publishedAt: null, views: null, accent: 'red' },
  { id: 'p7', accountId: 'viral-clips-daily', title: 'Satisfying Restores #42', status: 'SCHEDULED', scheduledAt: from(6 * HOUR), publishedAt: null, views: null, accent: 'sky' },
  // Daily Recipes (REPURPOSED, Facebook)
  { id: 'p8', accountId: 'daily-recipes', title: '15-Minute Garlic Butter Shrimp', status: 'PUBLISHED', scheduledAt: null, publishedAt: from(-6 * HOUR), views: 22_800, accent: 'sky' },
  { id: 'p9', accountId: 'daily-recipes', title: 'No-Bake Cheesecake Cups', status: 'SCHEDULED', scheduledAt: from(2 * DAY), publishedAt: null, views: null, accent: 'sky' },
  // Neon Drama Shorts (AI, TikTok)
  { id: 'p10', accountId: 'neon-drama-shorts', title: 'Midnight Heist — Ep. 3', status: 'PUBLISHED', scheduledAt: null, publishedAt: from(-12 * HOUR), views: 512_000, accent: 'violet' },
  { id: 'p11', accountId: 'neon-drama-shorts', title: 'Midnight Heist — Ep. 4', status: 'SCHEDULED', scheduledAt: from(18 * HOUR), publishedAt: null, views: null, accent: 'violet' },
  { id: 'p12', accountId: 'neon-drama-shorts', title: 'Neon City B-roll Drop', status: 'DRAFT', scheduledAt: null, publishedAt: null, views: null, accent: 'zinc' },
  // Trendy Bytes (MIXED, TikTok)
  { id: 'p13', accountId: 'trendy-bytes', title: 'Trend Recap: Week 28', status: 'FAILED', scheduledAt: from(-1 * DAY), publishedAt: null, views: null, accent: 'red' },
  { id: 'p14', accountId: 'trendy-bytes', title: 'AI Voiceover Test Cut', status: 'DRAFT', scheduledAt: null, publishedAt: null, views: null, accent: 'zinc' },
];

export const reviewItems: ReviewItem[] = [
  { id: 'r1', accountId: 'viral-clips-daily', kind: 'INGESTED_VIDEO', title: 'Kuaishou clip — parkour rooftop', submittedAt: from(-3 * HOUR), status: 'PENDING', sourceUrl: 'https://kuaishou.example/v/8812', rightsNote: null, durationSec: 47 },
  { id: 'r2', accountId: 'viral-clips-daily', kind: 'INGESTED_VIDEO', title: 'Kuaishou clip — kitten vs cucumber', submittedAt: from(-5 * HOUR), status: 'PENDING', sourceUrl: 'https://kuaishou.example/v/8813', rightsNote: 'Licensed via SourcePack A', durationSec: 32 },
  { id: 'r3', accountId: 'daily-recipes', kind: 'INGESTED_VIDEO', title: 'One-pan pasta short', submittedAt: from(-8 * HOUR), status: 'PENDING', sourceUrl: 'https://kuaishou.example/v/8820', rightsNote: null, durationSec: 58 },
  { id: 'r4', accountId: 'mindful-minutes', kind: 'PRODUCED_VIDEO', title: 'Anxiety Off-Ramp (final render)', submittedAt: from(-2 * HOUR), status: 'PENDING', sourceUrl: null, rightsNote: null, durationSec: 312 },
  { id: 'r5', accountId: 'neon-drama-shorts', kind: 'IDEA', title: 'Idea: rival crew betrayal arc', submittedAt: from(-26 * HOUR), status: 'PENDING', sourceUrl: null, rightsNote: null, durationSec: null },
  { id: 'r6', accountId: 'trendy-bytes', kind: 'METADATA', title: 'Metadata: Trend Recap Week 28', submittedAt: from(-30 * HOUR), status: 'PENDING', sourceUrl: null, rightsNote: null, durationSec: null },
];

export const ideas: Idea[] = [
  { id: 'i1', accountId: 'mindful-minutes', title: 'The 90-second reset for meetings', angle: 'Workplace micro-recovery', hook: '"Do this before your next call."', stage: 'SUGGESTED', predictedScore: 82, createdAt: from(-1 * DAY) },
  { id: 'i2', accountId: 'mindful-minutes', title: 'Why your sleep story never lands', angle: 'Common mistake explainer', hook: '"You are breathing wrong at night."', stage: 'SUGGESTED', predictedScore: 74, createdAt: from(-2 * DAY) },
  { id: 'i3', accountId: 'mindful-minutes', title: 'Cold-start focus ritual', angle: 'Routine walkthrough', hook: '"3 steps, zero apps."', stage: 'APPROVED', predictedScore: 88, createdAt: from(-3 * DAY) },
  { id: 'i4', accountId: 'mindful-minutes', title: 'Breathing pattern for panic', angle: 'Emergency tool', hook: '"Save this for a bad day."', stage: 'IN_PRODUCTION', predictedScore: 91, createdAt: from(-5 * DAY) },
  { id: 'i5', accountId: 'mindful-minutes', title: 'Evening wind-down in 4 moves', angle: 'Nightly routine', hook: '"Your phone is keeping you up."', stage: 'UPLOADED', predictedScore: 79, createdAt: from(-7 * DAY) },
  { id: 'i6', accountId: 'neon-drama-shorts', title: 'The double-cross nobody saw', angle: 'Cliffhanger series', hook: '"He was the informant all along."', stage: 'IN_PRODUCTION', predictedScore: 86, createdAt: from(-4 * DAY) },
  { id: 'i7', accountId: 'neon-drama-shorts', title: 'Origin flashback episode', angle: 'Character depth', hook: '"Before the heist, there was a promise."', stage: 'APPROVED', predictedScore: 77, createdAt: from(-6 * DAY) },
];

export const sources: Source[] = [
  { id: 's1', accountId: 'viral-clips-daily', type: 'WATCHED_PROFILE', url: 'https://kuaishou.example/u/failfactory', label: 'FailFactory', checkIntervalHours: 6, lastCheckedAt: from(-2 * HOUR), newItems: 3, status: 'ACTIVE' },
  { id: 's2', accountId: 'viral-clips-daily', type: 'WATCHED_PROFILE', url: 'https://kuaishou.example/u/streetmagic', label: 'StreetMagic', checkIntervalHours: 12, lastCheckedAt: from(-9 * HOUR), newItems: 0, status: 'ACTIVE' },
  { id: 's3', accountId: 'viral-clips-daily', type: 'BULK_IMPORT', url: '—', label: 'Batch import 2026-07-10', checkIntervalHours: 0, lastCheckedAt: from(-4 * DAY), newItems: 0, status: 'PAUSED' },
  { id: 's4', accountId: 'daily-recipes', type: 'WATCHED_PROFILE', url: 'https://kuaishou.example/u/quickbites', label: 'QuickBites', checkIntervalHours: 6, lastCheckedAt: from(-1 * HOUR), newItems: 2, status: 'ACTIVE' },
  { id: 's5', accountId: 'daily-recipes', type: 'WATCHED_PROFILE', url: 'https://kuaishou.example/u/sweettooth', label: 'SweetTooth', checkIntervalHours: 24, lastCheckedAt: from(-20 * HOUR), newItems: 0, status: 'ERROR' },
  { id: 's6', accountId: 'trendy-bytes', type: 'WATCHED_PROFILE', url: 'https://kuaishou.example/u/trendwatch', label: 'TrendWatch', checkIntervalHours: 6, lastCheckedAt: from(-3 * DAY), newItems: 0, status: 'ERROR' },
];

export const dramas: DramaSeries[] = [
  { id: 'd1', accountId: 'neon-drama-shorts', title: 'Midnight Heist', genre: 'Crime thriller', episodes: 12, producedEpisodes: 4, status: 'IN_PRODUCTION', createdAt: from(-30 * DAY) },
  { id: 'd2', accountId: 'neon-drama-shorts', title: 'Afterglow', genre: 'Sci-fi romance', episodes: 8, producedEpisodes: 8, status: 'PUBLISHING', createdAt: from(-60 * DAY) },
  { id: 'd3', accountId: 'neon-drama-shorts', title: 'The Quiet Floor', genre: 'Psychological', episodes: 10, producedEpisodes: 0, status: 'PLANNING', createdAt: from(-3 * DAY) },
  { id: 'd4', accountId: 'trendy-bytes', title: 'Loop City', genre: 'Time-loop mystery', episodes: 6, producedEpisodes: 2, status: 'IN_PRODUCTION', createdAt: from(-14 * DAY) },
];

export const incidents: Incident[] = [
  { id: 'inc1', accountId: 'viral-clips-daily', kind: 'PUBLISH_ERROR', severity: 'MEDIUM', status: 'OPEN', title: 'Upload rejected: duplicate audio track', detail: 'YouTube returned 400 on the publish attempt for "Street Magician Compilation". Item reverted to Draft.', createdAt: from(-4 * HOUR), resolvedAt: null },
  { id: 'inc2', accountId: 'trendy-bytes', kind: 'AUTH', severity: 'HIGH', status: 'OPEN', title: 'PostQued token expired', detail: 'Connection dropped; all scheduled posts for this account are halted until re-auth.', createdAt: from(-3 * DAY), resolvedAt: null },
  { id: 'inc3', accountId: 'trendy-bytes', kind: 'COPYRIGHT', severity: 'HIGH', status: 'OPEN', title: 'Copyright claim on "Trend Recap: Week 28"', detail: 'Rights holder flagged background music. Item held pending review.', createdAt: from(-1 * DAY), resolvedAt: null },
  { id: 'inc4', accountId: 'mindful-minutes', kind: 'RATE_LIMIT', severity: 'LOW', status: 'RESOLVED', title: 'AI key cooldown during metadata batch', detail: 'Provider returned 429; failed over to next key. No content impact.', createdAt: from(-6 * DAY), resolvedAt: from(-6 * DAY + 20 * 60_000) },
];

export const tasks: WorkerTask[] = [
  { id: 't1', accountId: 'mindful-minutes', title: 'Edit: Anxiety Off-Ramp final cut', assignee: 'Rafael', status: 'IN_PROGRESS', assignedAt: from(-1 * DAY), dueAt: from(1 * DAY) },
  { id: 't2', accountId: 'neon-drama-shorts', title: 'Render: Midnight Heist Ep. 4', assignee: 'Mei', status: 'SUBMITTED', assignedAt: from(-2 * DAY), dueAt: from(-2 * HOUR) },
  { id: 't3', accountId: 'neon-drama-shorts', title: 'Storyboard: Ep. 5 scene breakdown', assignee: 'Mei', status: 'ASSIGNED', assignedAt: from(-4 * HOUR), dueAt: from(2 * DAY) },
  { id: 't4', accountId: 'viral-clips-daily', title: 'Trim + caption: Fails of the Week', assignee: 'Diego', status: 'DONE', assignedAt: from(-3 * DAY), dueAt: from(-1 * DAY) },
  { id: 't5', accountId: 'daily-recipes', title: 'Voiceover: Garlic Butter Shrimp', assignee: 'Rafael', status: 'ASSIGNED', assignedAt: from(-5 * HOUR), dueAt: from(1 * DAY) },
];

// --- Accessors (Phase 1: swap bodies for API calls) ---------------------------

export function getAccounts(): Account[] {
  return accounts;
}

export function getAccount(id: string): Account | undefined {
  return accounts.find((a) => a.id === id);
}

export function getPosts(accountId?: string): Post[] {
  return accountId ? posts.filter((p) => p.accountId === accountId) : posts;
}

export function getReviewItems(accountId?: string): ReviewItem[] {
  return accountId ? reviewItems.filter((r) => r.accountId === accountId) : reviewItems;
}

export function getIdeas(accountId?: string): Idea[] {
  return accountId ? ideas.filter((i) => i.accountId === accountId) : ideas;
}

export function getSources(accountId?: string): Source[] {
  return accountId ? sources.filter((s) => s.accountId === accountId) : sources;
}

export function getDramas(accountId?: string): DramaSeries[] {
  return accountId ? dramas.filter((d) => d.accountId === accountId) : dramas;
}

export function getIncidents(accountId?: string): Incident[] {
  return accountId ? incidents.filter((i) => i.accountId === accountId) : incidents;
}

export function getTasks(accountId?: string): WorkerTask[] {
  return accountId ? tasks.filter((t) => t.accountId === accountId) : tasks;
}

/** Cross-account rollups for the global dashboard/analytics pages. */
export function getRollups() {
  const totalFollowers = accounts.reduce((n, a) => n + a.followers, 0);
  const views30d = accounts.reduce((n, a) => n + a.views30d, 0);
  const scheduled = accounts.reduce((n, a) => n + a.scheduledCount, 0);
  const openIncidents = incidents.filter((i) => i.status === 'OPEN').length;
  const pendingReviews = reviewItems.filter((r) => r.status === 'PENDING').length;
  const publishedToday = posts.filter(
    (p) => p.status === 'PUBLISHED' && p.publishedAt && Date.now() - Date.parse(p.publishedAt) < DAY,
  ).length;
  const failed = posts.filter((p) => p.status === 'FAILED').length;
  return {
    totalFollowers,
    views30d,
    scheduled,
    openIncidents,
    pendingReviews,
    publishedToday,
    failed,
    accountCount: accounts.length,
  };
}
