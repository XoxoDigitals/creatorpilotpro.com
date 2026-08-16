import type { Platform } from '@/lib/domain-types';

/**
 * Per-platform analytics surface: only metrics each platform API provides
 * and that CreatorPilot syncs into snapshot tables (docs/07 §4 — hide missing).
 */

export type AccountKpiId =
  | 'views'
  | 'uniqueViewers'
  | 'impressions'
  | 'watchTime'
  | 'followers'
  | 'engagements'
  | 'avgCtr'
  | 'retention'
  | 'revenue';

export type PostColumnId =
  | 'views'
  | 'uniqueViewers'
  | 'impressions'
  | 'ctr'
  | 'watchTime'
  | 'retention'
  | 'likes'
  | 'comments'
  | 'shares';

export type PostDrawerKpiId =
  | 'views'
  | 'uniqueViewers'
  | 'impressions'
  | 'ctr'
  | 'watchTime'
  | 'avgViewDuration'
  | 'retention'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'engagement';

export interface PlatformAnalyticsConfig {
  /** Account-level KPI cards (order = display order). */
  accountKpis: AccountKpiId[];
  /** Per-video table numeric columns (Video + Published always shown). */
  postColumns: PostColumnId[];
  /** Drill-down drawer KPI cards. */
  postDrawerKpis: PostDrawerKpiId[];
  /** Audience breakdown sections (countries / age / sources / devices). */
  showDemography: boolean;
  /** Audience retention curve chart (YouTube-style). */
  showRetentionCurve: boolean;
  /** Label for uniqueViewers / reach-style KPI when shown. */
  uniqueViewersLabel: string;
}

const FACEBOOK: PlatformAnalyticsConfig = {
  // Graph Insights + page videos: views, reach, impressions, fans, engagements;
  // post snapshots: views / likes / comments only.
  accountKpis: ['views', 'uniqueViewers', 'impressions', 'followers', 'engagements'],
  postColumns: ['views', 'likes', 'comments'],
  postDrawerKpis: ['views', 'likes', 'comments'],
  showDemography: false,
  showRetentionCurve: false,
  uniqueViewersLabel: 'Reach',
};

const YOUTUBE: PlatformAnalyticsConfig = {
  // Analytics API: views, watch time, engagements, avg view %, revenue;
  // Data API posts: views / likes / comments. Thumbnail impressions/CTR need Reporting API.
  accountKpis: ['views', 'watchTime', 'followers', 'engagements', 'retention', 'revenue'],
  postColumns: ['views', 'likes', 'comments'],
  postDrawerKpis: ['views', 'likes', 'comments'],
  showDemography: false,
  showRetentionCurve: false,
  uniqueViewersLabel: 'Unique viewers',
};

const TIKTOK: PlatformAnalyticsConfig = {
  // Bridge/API surface we target: views, followers, engagements; posts + shares.
  accountKpis: ['views', 'followers', 'engagements'],
  postColumns: ['views', 'likes', 'comments', 'shares'],
  postDrawerKpis: ['views', 'likes', 'comments', 'shares'],
  showDemography: false,
  showRetentionCurve: false,
  uniqueViewersLabel: 'Unique viewers',
};

const BY_PLATFORM: Record<Platform, PlatformAnalyticsConfig> = {
  FACEBOOK,
  YOUTUBE,
  TIKTOK,
};

export function analyticsConfigFor(platform: Platform | string | null | undefined): PlatformAnalyticsConfig {
  if (platform === 'FACEBOOK' || platform === 'YOUTUBE' || platform === 'TIKTOK') {
    return BY_PLATFORM[platform];
  }
  // Unknown → conservative common set (no fake advanced metrics).
  return {
    accountKpis: ['views', 'followers', 'engagements'],
    postColumns: ['views', 'likes', 'comments'],
    postDrawerKpis: ['views', 'likes', 'comments'],
    showDemography: false,
    showRetentionCurve: false,
    uniqueViewersLabel: 'Unique viewers',
  };
}

export const POST_COLUMN_LABEL: Record<PostColumnId, string> = {
  views: 'Views',
  uniqueViewers: 'Unique',
  impressions: 'Impressions',
  ctr: 'CTR',
  watchTime: 'Watch',
  retention: 'Retention',
  likes: 'Likes',
  comments: 'Comments',
  shares: 'Shares',
};
