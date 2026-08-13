import type { CompetitorChannel, CompetitorVideo } from '@scp/db';
import {
  parseChannelPerformanceMemory,
  summarizePerformanceForUi,
  type ChannelPerformanceMemory,
} from '@scp/shared';

/** Public view of a competitor channel (docs/03 Domain 5). */
export interface CompetitorChannelView {
  id: string;
  ownAccountId: string;
  youtubeChannelId: string;
  channelUrl: string | null;
  name: string;
  role: CompetitorChannel['role'];
  checkIntervalMin: number;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  status: CompetitorChannel['status'];
  errorNote: string | null;
  videoCount: number;
  performanceAnalyzedAt: string | null;
  /** Human-readable channel memory summary (null until first analysis). */
  performanceInsights: {
    summary: string;
    winningTopics: string[];
    winningHooks: string[];
    avoidPatterns: string[];
    topExamples: Array<{ title: string; views: number }>;
    sampleSize: number;
    analyzedAt: string;
    aiAvailable: boolean;
  } | null;
  createdAt: string;
}

export function toCompetitorChannelView(
  c: CompetitorChannel & { _count?: { videos: number } },
): CompetitorChannelView {
  const memory = parseChannelPerformanceMemory(c.performanceMemory);
  return {
    id: c.id,
    ownAccountId: c.ownAccountId,
    youtubeChannelId: c.youtubeChannelId,
    channelUrl: c.channelUrl ?? null,
    name: c.name,
    role: c.role,
    checkIntervalMin: c.checkIntervalMin,
    lastCheckedAt: c.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
    consecutiveFailures: c.consecutiveFailures,
    status: c.status,
    errorNote: c.errorNote,
    videoCount: c._count?.videos ?? 0,
    performanceAnalyzedAt: c.performanceAnalyzedAt
      ? c.performanceAnalyzedAt.toISOString()
      : null,
    performanceInsights: memory ? summarizePerformanceForUi(memory) : null,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Public view of a fetched competitor video (docs/03 Domain 5). */
export interface CompetitorVideoView {
  id: string;
  videoId: string;
  title: string;
  views: string;
  publishedAt: string | null;
  durationSec: number | null;
  transcriptSource: CompetitorVideo['transcriptSource'];
  hasTranscript: boolean;
  fetchedAt: string;
  createdAt: string;
}

export function toCompetitorVideoView(v: CompetitorVideo): CompetitorVideoView {
  return {
    id: v.id,
    videoId: v.videoId,
    title: v.title,
    views: v.views.toString(),
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    durationSec: v.durationSec,
    transcriptSource: v.transcriptSource,
    hasTranscript: v.transcript !== null && v.transcript.length > 0,
    fetchedAt: v.fetchedAt.toISOString(),
    createdAt: v.createdAt.toISOString(),
  };
}

/** Paginated competitor video list (newest first by default). */
export interface CompetitorVideoPage {
  items: CompetitorVideoView[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
  sort: 'newest' | 'views';
}

export type { ChannelPerformanceMemory };
