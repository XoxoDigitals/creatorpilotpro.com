import type {
  MetricSnapshotAccount,
  MetricSnapshotPost,
  AiUsageDaily,
  WorkerProductivitySnapshot,
} from '@scp/db';

export interface OverviewView {
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

export interface AccountMetricsView {
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
  // Aggregated audience/traffic snapshot (latest day in range).
  latest?: AccountSnapshotView;
  snapshots: AccountSnapshotView[];
}

export interface AccountSnapshotView {
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
  trafficCountries: Array<{ country: string; views: number; pct: number }>;
  ageGroups: Array<{ range: string; pct: number }>;
  genderSplit: { male?: number; female?: number; other?: number };
  trafficSources: Array<{ source: string; views: number; pct: number }>;
  deviceSplit: Array<{ device: string; pct: number }>;
}

export interface PostMetricsView {
  publishTargetId: string;
  contentTitle: string;
  accountId: string;
  publishedAt: string | null;
  platformPostId: string | null;
  snapshots: PostSnapshotView[];
  retentionCurve: unknown[];
}

export interface PostSnapshotView {
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
  trafficCountries: Array<{ country: string; views: number; pct: number }>;
  ageGroups: Array<{ range: string; pct: number }>;
  genderSplit: { male?: number; female?: number; other?: number };
  trafficSources: Array<{ source: string; views: number; pct: number }>;
  deviceSplit: Array<{ device: string; pct: number }>;
}

export interface PostTableRowView {
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

export interface AiUsageView {
  from: string;
  to: string;
  totals: {
    totalCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    estimatedCostUsd: string;
  };
  rows: AiUsageDayView[];
}

export interface AiUsageDayView {
  date: string;
  providerId: string;
  task: string;
  totalCalls: number;
  cacheHits: number;
  tokensIn: number;
  tokensOut: number;
  ttsSeconds: number;
  estimatedCostUsd: string;
}

export interface WorkerProductivityView {
  snapshots: WorkerSnapshotView[];
  currentAssignments: { workerId: string; workerName: string; activeTasks: number }[];
}

export interface WorkerSnapshotView {
  userId: string;
  weekStart: string;
  tasksAssigned: number;
  tasksCompleted: number;
  medianHoursToComplete: number | null;
  revisionRate: number;
}

export interface SystemHealthView {
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

export function toAccountSnapshot(s: MetricSnapshotAccount): AccountSnapshotView {
  return {
    date: s.date.toISOString().slice(0, 10),
    followers: s.followers,
    views: s.views,
    uniqueViewers: s.uniqueViewers,
    watchTimeMin: s.watchTimeMin,
    impressions: s.impressions,
    ctr: s.ctr,
    revenue: s.revenue.toString(),
    rpm: s.rpm.toString(),
    engagements: s.engagements,
    retentionRate: s.retentionRate,
    trafficCountries: (s.trafficCountries as AccountSnapshotView['trafficCountries']) ?? [],
    ageGroups: (s.ageGroups as AccountSnapshotView['ageGroups']) ?? [],
    genderSplit: (s.genderSplit as AccountSnapshotView['genderSplit']) ?? {},
    trafficSources: (s.trafficSources as AccountSnapshotView['trafficSources']) ?? [],
    deviceSplit: (s.deviceSplit as AccountSnapshotView['deviceSplit']) ?? [],
  };
}

export function toPostSnapshot(s: MetricSnapshotPost): PostSnapshotView {
  return {
    date: s.date.toISOString().slice(0, 10),
    views: s.views,
    uniqueViewers: s.uniqueViewers,
    likes: s.likes,
    comments: s.comments,
    shares: s.shares,
    saves: s.saves,
    watchTimeMin: s.watchTimeMin,
    averageViewDurationSec: s.averageViewDurationSec,
    impressions: s.impressions,
    ctr: s.ctr,
    retentionRate: s.retentionRate,
    trafficCountries: (s.trafficCountries as PostSnapshotView['trafficCountries']) ?? [],
    ageGroups: (s.ageGroups as PostSnapshotView['ageGroups']) ?? [],
    genderSplit: (s.genderSplit as PostSnapshotView['genderSplit']) ?? {},
    trafficSources: (s.trafficSources as PostSnapshotView['trafficSources']) ?? [],
    deviceSplit: (s.deviceSplit as PostSnapshotView['deviceSplit']) ?? [],
  };
}

export function toAiUsageDay(r: AiUsageDaily): AiUsageDayView {
  return {
    date: r.date.toISOString().slice(0, 10),
    providerId: r.providerId,
    task: r.task,
    totalCalls: r.totalCalls,
    cacheHits: r.cacheHits,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    ttsSeconds: r.ttsSeconds,
    estimatedCostUsd: r.estimatedCostUsd.toString(),
  };
}

export function toWorkerSnapshot(s: WorkerProductivitySnapshot): WorkerSnapshotView {
  return {
    userId: s.userId,
    weekStart: s.weekStart.toISOString().slice(0, 10),
    tasksAssigned: s.tasksAssigned,
    tasksCompleted: s.tasksCompleted,
    medianHoursToComplete: s.medianHoursToComplete,
    revisionRate: s.revisionRate,
  };
}
