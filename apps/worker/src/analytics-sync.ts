/**
 * Analytics sync processors (docs/07, Phase 5). Four functions that pull
 * metrics into snapshot tables. External API calls gracefully degrade when
 * credentials are absent — log + skip, never crash.
 */
import type PgBoss from 'pg-boss';
import { Prisma, type PrismaClient } from '@scp/db';
import { decryptAccountAuth, getMasterKey, getPrisma, raiseIncident } from './publish-support.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const YT_DATA = 'https://www.googleapis.com/youtube/v3';
const YT_ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';

type DayBucket = {
  views: number;
  uniqueViewers: number;
  impressions: number;
  engagements: number;
};

/** Classify Meta GET errors that mean the video is gone (deleted / unavailable). */
function isFacebookVideoMissing(
  httpStatus: number,
  body: { error?: { message?: string; code?: number; error_user_msg?: string } },
): boolean {
  if (httpStatus === 404) return true;
  const code = body.error?.code;
  if (code === 100 || code === 803 || code === 33) return true;
  const msg = [body.error?.message, body.error?.error_user_msg].filter(Boolean).join(' ');
  return /does not exist|unsupported get request|nonexisting|has been deleted|was deleted|cannot be found/i.test(
    msg,
  );
}

function looksLikeFacebookCopyright(text: string): boolean {
  return /copyright|claim|takedown|rights.?manager|infring|dmca|muted|matched.?third.?party|content.?id/i.test(
    text,
  );
}

/** Mark a published target as removed/blocked after Meta reports it gone or claimed. */
async function markPublishTargetPlatformIssue(
  prisma: PrismaClient,
  target: {
    id: string;
    accountId: string;
    contentItemId: string;
    platformPostId: string | null;
  },
  opts: {
    reason: 'removed_from_platform' | 'copyright' | 'platform_reject';
    message: string;
    kind: 'COPYRIGHT' | 'PLATFORM_REJECT';
  },
): Promise<void> {
  await prisma.publishTarget.update({
    where: { id: target.id },
    data: {
      status: 'DRAFT',
      lastError: {
        message: opts.message,
        platformPostId: target.platformPostId,
        reason: opts.reason,
        detectedAt: new Date().toISOString(),
        source: 'analytics-sync',
      } as Prisma.InputJsonValue,
    },
  });
  await raiseIncident(prisma, {
    kind: opts.kind,
    severity: 'HIGH',
    accountId: target.accountId,
    contentItemId: target.contentItemId,
    publishTargetId: target.id,
    title:
      opts.reason === 'removed_from_platform'
        ? 'Video removed from Facebook'
        : opts.reason === 'copyright'
          ? 'Copyright issue detected on Facebook'
          : 'Facebook platform issue detected',
    detail: { platformPostId: target.platformPostId, message: opts.message },
  });
}

/** Fetch Facebook Page fan_count; null when auth/API fails (caller must not overwrite). */
async function fetchFacebookFanCount(
  pageId: string,
  pageAccessToken: string,
): Promise<number | null> {
  try {
    const url =
      `${GRAPH}/${encodeURIComponent(pageId)}?` +
      new URLSearchParams({ fields: 'fan_count', access_token: pageAccessToken }).toString();
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[analytics:account-sync] Meta fan_count HTTP ${res.status} for page ${pageId}`);
      return null;
    }
    const data = (await res.json()) as { fan_count?: number };
    return typeof data.fan_count === 'number' ? data.fan_count : 0;
  } catch (err) {
    console.warn(`[analytics:account-sync] Meta fan_count error for page ${pageId}:`, err);
    return null;
  }
}

/** Pull daily Page Insights (views / impressions / engagements) for ~90 days. */
async function fetchFacebookPageInsights(
  pageId: string,
  pageAccessToken: string,
): Promise<Map<string, DayBucket>> {
  const out = new Map<string, DayBucket>();
  const since = Math.floor((Date.now() - 90 * 86_400_000) / 1000);
  const until = Math.floor(Date.now() / 1000);

  // Prefer a small set of widely available metrics; fall back if the batch fails.
  // page_impressions_unique = Reach (unique people who saw any content).
  const metricSets = [
    ['page_impressions', 'page_impressions_unique', 'page_video_views', 'page_post_engagements'],
    ['page_impressions', 'page_video_views', 'page_post_engagements'],
    ['page_impressions', 'page_video_views'],
    ['page_impressions'],
  ];

  const ensure = (day: string): DayBucket => {
    let b = out.get(day);
    if (!b) {
      b = { views: 0, uniqueViewers: 0, impressions: 0, engagements: 0 };
      out.set(day, b);
    }
    return b;
  };

  for (const metrics of metricSets) {
    const url =
      `${GRAPH}/${encodeURIComponent(pageId)}/insights?` +
      new URLSearchParams({
        metric: metrics.join(','),
        period: 'day',
        since: String(since),
        until: String(until),
        access_token: pageAccessToken,
      }).toString();

    try {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(
          `[analytics:account-sync] Meta insights HTTP ${res.status} (${metrics.join('+')}): ${body.slice(0, 180)}`,
        );
        continue;
      }
      const data = (await res.json()) as {
        data?: Array<{
          name: string;
          values?: Array<{ value: number | Record<string, number>; end_time: string }>;
        }>;
      };

      for (const series of data.data ?? []) {
        for (const point of series.values ?? []) {
          const day = point.end_time.slice(0, 10);
          const raw = point.value;
          const n = typeof raw === 'number' ? raw : 0;
          const bucket = ensure(day);
          if (series.name === 'page_impressions') bucket.impressions = n;
          else if (series.name === 'page_impressions_unique') bucket.uniqueViewers = n;
          else if (series.name === 'page_video_views') bucket.views = n;
          else if (series.name === 'page_post_engagements') bucket.engagements = n;
        }
      }
      if (out.size > 0) break;
    } catch (err) {
      console.warn(`[analytics:account-sync] Meta insights error for page ${pageId}:`, err);
    }
  }
  return out;
}

interface FbVideoRow {
  id: string;
  title: string;
  createdTime: string | null;
  views: number;
  likes: number;
  comments: number;
}

/** List recent Page videos (includes older uploads not published via CreatorPilot). */
async function listFacebookPageVideos(
  pageId: string,
  pageAccessToken: string,
  limit = 40,
): Promise<FbVideoRow[]> {
  const rows: FbVideoRow[] = [];
  let url: string | null =
    `${GRAPH}/${encodeURIComponent(pageId)}/videos?` +
    new URLSearchParams({
      fields: 'id,title,description,created_time,views,likes.summary(true),comments.summary(true)',
      limit: '25',
      access_token: pageAccessToken,
    }).toString();

  try {
    while (url && rows.length < limit) {
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(
          `[analytics:account-sync] Meta /videos HTTP ${res.status} for page ${pageId}: ${body.slice(0, 200)}`,
        );
        break;
      }
      const data = (await res.json()) as {
        data?: Array<{
          id: string;
          title?: string;
          description?: string;
          created_time?: string;
          views?: number;
          likes?: { summary?: { total_count?: number } };
          comments?: { summary?: { total_count?: number } };
        }>;
        paging?: { next?: string };
      };
      for (const v of data.data ?? []) {
        const rawTitle = (v.title ?? '').trim();
        const rawDesc = (v.description ?? '').trim();
        const fromDesc = rawDesc
          ? rawDesc.split(/\n+/)[0]!.replace(/#\S+/g, '').trim().slice(0, 120)
          : '';
        rows.push({
          id: v.id,
          title: (rawTitle || fromDesc || `Facebook video ${v.id}`).slice(0, 200),
          createdTime: v.created_time ?? null,
          views: typeof v.views === 'number' ? v.views : 0,
          likes: v.likes?.summary?.total_count ?? 0,
          comments: v.comments?.summary?.total_count ?? 0,
        });
        if (rows.length >= limit) break;
      }
      url = data.paging?.next ?? null;
    }
  } catch (err) {
    console.warn(`[analytics:account-sync] Meta /videos error for page ${pageId}:`, err);
  }
  return rows;
}

/** Ensure a PublishTarget exists for an external Facebook video (for analytics UI). */
async function ensureImportedFacebookVideo(
  prisma: PrismaClient,
  accountId: string,
  video: FbVideoRow,
): Promise<string> {
  const existing = await prisma.publishTarget.findFirst({
    where: { accountId, platformPostId: video.id },
    select: { id: true },
  });
  if (existing) return existing.id;

  const content = await prisma.contentItem.create({
    data: {
      type: 'MANUAL_UPLOAD',
      title: video.title,
      status: 'PUBLISHED',
      statusReason: 'Imported from Facebook for analytics (not created in CreatorPilot)',
      currentStep: { importedFrom: 'facebook', externalVideoId: video.id },
      publishTargets: {
        create: {
          accountId,
          status: 'PUBLISHED',
          platformPostId: video.id,
          publishedAt: video.createdTime ? new Date(video.createdTime) : new Date(),
          scheduleMode: 'NOW',
          metadataOverride: { source: 'facebook_import' },
        },
      },
    },
    include: { publishTargets: { select: { id: true } } },
  });
  return content.publishTargets[0]!.id;
}

async function upsertPostSnapshot(
  prisma: PrismaClient,
  publishTargetId: string,
  accountId: string,
  date: Date,
  metrics: { views: number; likes: number; comments: number },
): Promise<void> {
  await prisma.metricSnapshotPost.upsert({
    where: { publishTargetId_date: { publishTargetId, date } },
    create: {
      publishTargetId,
      accountId,
      date,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: 0,
      watchTimeMin: 0,
      impressions: 0,
      ctr: 0,
      retentionCurve: [],
      syncedAt: new Date(),
    },
    update: {
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      syncedAt: new Date(),
    },
  });
}

async function reconcileFacebookPublishedTargets(
  prisma: PrismaClient,
  accountId: string,
  pageAccessToken: string,
): Promise<void> {
  const published = await prisma.publishTarget.findMany({
    where: {
      accountId,
      status: 'PUBLISHED',
      platformPostId: { not: null },
      contentItem: { deletedAt: null },
    },
    select: { id: true, accountId: true, contentItemId: true, platformPostId: true },
    take: 80,
    orderBy: { publishedAt: 'desc' },
  });

  for (const target of published) {
    const postId = target.platformPostId;
    if (!postId) continue;
    try {
      const url =
        `${GRAPH}/${encodeURIComponent(postId)}?` +
        new URLSearchParams({
          fields: 'id,status',
          access_token: pageAccessToken,
        }).toString();
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as {
        status?: { video_status?: string } | string;
        error?: { message?: string; code?: number; error_user_msg?: string };
      };
      if (isFacebookVideoMissing(res.status, data)) {
        await markPublishTargetPlatformIssue(prisma, target, {
          reason: 'removed_from_platform',
          message: `Video ${postId} is no longer on Facebook.`,
          kind: 'PLATFORM_REJECT',
        });
        continue;
      }
      if (!res.ok || data.error) {
        const msg = [data.error?.message, data.error?.error_user_msg].filter(Boolean).join(' ');
        if (looksLikeFacebookCopyright(msg)) {
          await markPublishTargetPlatformIssue(prisma, target, {
            reason: 'copyright',
            message: msg || 'Facebook copyright / rights issue.',
            kind: 'COPYRIGHT',
          });
        }
        continue;
      }
      const videoStatus = (
        typeof data.status === 'string' ? data.status : (data.status?.video_status ?? '')
      ).toLowerCase();
      if (looksLikeFacebookCopyright(videoStatus)) {
        await markPublishTargetPlatformIssue(prisma, target, {
          reason: 'copyright',
          message: `Facebook copyright/rights status: ${videoStatus}`,
          kind: 'COPYRIGHT',
        });
      } else if (videoStatus === 'error' || videoStatus === 'expired' || videoStatus === 'failed') {
        await markPublishTargetPlatformIssue(prisma, target, {
          reason: 'platform_reject',
          message: `Facebook video_status "${videoStatus}".`,
          kind: 'PLATFORM_REJECT',
        });
      }
    } catch (err) {
      console.warn(`[analytics:account-sync] reconcile ${postId} failed:`, err);
    }
  }
}

async function syncFacebookAccount(
  prisma: PrismaClient,
  accountId: string,
  pageId: string,
  pageAccessToken: string,
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [followers, insightDays, videos] = await Promise.all([
    fetchFacebookFanCount(pageId, pageAccessToken),
    fetchFacebookPageInsights(pageId, pageAccessToken),
    listFacebookPageVideos(pageId, pageAccessToken, 200),
  ]);

  const todayStr = today.toISOString().slice(0, 10);
  const days = new Set<string>([todayStr, ...insightDays.keys()]);
  for (const dayStr of days) {
    const date = new Date(`${dayStr}T00:00:00.000Z`);
    const bucket = insightDays.get(dayStr) ?? {
      views: 0,
      uniqueViewers: 0,
      impressions: 0,
      engagements: 0,
    };
    const isToday = dayStr === todayStr;
    await prisma.metricSnapshotAccount.upsert({
      where: { accountId_date: { accountId, date } },
      create: {
        accountId,
        date,
        followers: isToday ? (followers ?? 0) : 0,
        views: bucket.views,
        uniqueViewers: bucket.uniqueViewers,
        impressions: bucket.impressions,
        engagements: bucket.engagements,
        watchTimeMin: 0,
        ctr: 0,
        revenue: 0,
        rpm: 0,
        syncedAt: new Date(),
      },
      update: {
        views: bucket.views,
        uniqueViewers: bucket.uniqueViewers,
        impressions: bucket.impressions,
        engagements: bucket.engagements,
        ...(isToday && followers !== null ? { followers } : {}),
        syncedAt: new Date(),
      },
    });
  }

  for (const video of videos) {
    try {
      const publishTargetId = await ensureImportedFacebookVideo(prisma, accountId, video);
      await upsertPostSnapshot(prisma, publishTargetId, accountId, today, {
        views: video.views,
        likes: video.likes,
        comments: video.comments,
      });
    } catch (err) {
      console.warn(`[analytics:account-sync] import video ${video.id} failed:`, err);
    }
  }

  // Probe our published FB posts — detect deletes / copyright takedowns Meta no longer lists.
  await reconcileFacebookPublishedTargets(prisma, accountId, pageAccessToken);

  // If Insights returned nothing useful, seed account daily buckets from video
  // publish dates so KPI cards + the views chart match the per-video table.
  const insightViews = [...insightDays.values()].reduce((s, b) => s + b.views + b.impressions, 0);
  if (insightViews === 0 && videos.length > 0) {
    const byDay = new Map<string, DayBucket>();
    for (const video of videos) {
      const day = (video.createdTime ?? today.toISOString()).slice(0, 10);
      const b = byDay.get(day) ?? {
        views: 0,
        uniqueViewers: 0,
        impressions: 0,
        engagements: 0,
      };
      b.views += video.views;
      b.engagements += video.likes + video.comments;
      byDay.set(day, b);
    }
    for (const [dayStr, bucket] of byDay) {
      const date = new Date(`${dayStr}T00:00:00.000Z`);
      const isToday = dayStr === todayStr;
      await prisma.metricSnapshotAccount.upsert({
        where: { accountId_date: { accountId, date } },
        create: {
          accountId,
          date,
          followers: isToday ? (followers ?? 0) : 0,
          views: bucket.views,
          uniqueViewers: 0,
          impressions: 0,
          engagements: bucket.engagements,
          watchTimeMin: 0,
          ctr: 0,
          revenue: 0,
          rpm: 0,
          syncedAt: new Date(),
        },
        update: {
          views: bucket.views,
          engagements: bucket.engagements,
          ...(isToday && followers !== null ? { followers } : {}),
          syncedAt: new Date(),
        },
      });
    }
  }

  console.log(
    `[analytics:account-sync] Facebook ${accountId}: followers=${followers ?? 'n/a'} ` +
      `insightDays=${insightDays.size} videos=${videos.length} insightViews=${insightViews}`,
  );
}

// ── YouTube analytics ──────────────────────────────────────────────────────

interface YtChannelStats {
  channelId: string;
  subscribers: number | null;
  /** Lifetime channel viewCount from Data API (not daily). */
  lifetimeViews: number | null;
  uploadsPlaylistId: string | null;
}

interface YtVideoRow {
  id: string;
  title: string;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
}

async function fetchYouTubeChannelStats(accessToken: string): Promise<YtChannelStats | null> {
  try {
    const url =
      `${YT_DATA}/channels?` +
      new URLSearchParams({
        part: 'statistics,contentDetails',
        mine: 'true',
      }).toString();
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[analytics:account-sync] YouTube channels HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as {
      items?: Array<{
        id?: string;
        statistics?: {
          subscriberCount?: string;
          viewCount?: string;
        };
        contentDetails?: { relatedPlaylists?: { uploads?: string } };
      }>;
    };
    const item = data.items?.[0];
    if (!item?.id) return null;
    const subRaw = item.statistics?.subscriberCount;
    const viewRaw = item.statistics?.viewCount;
    const sub = subRaw != null ? Number(subRaw) : NaN;
    const views = viewRaw != null ? Number(viewRaw) : NaN;
    return {
      channelId: item.id,
      subscribers: Number.isFinite(sub) ? sub : null,
      lifetimeViews: Number.isFinite(views) ? views : null,
      uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    };
  } catch (err) {
    console.warn(`[analytics:account-sync] YouTube channels error:`, err);
    return null;
  }
}

/** List recent channel uploads (includes videos not published via CreatorPilot). */
async function listYouTubeChannelVideos(
  accessToken: string,
  uploadsPlaylistId: string,
  limit = 40,
): Promise<YtVideoRow[]> {
  const rows: YtVideoRow[] = [];
  const videoIds: string[] = [];
  const meta = new Map<string, { title: string; publishedAt: string | null }>();
  let pageToken: string | undefined;

  try {
    while (videoIds.length < limit) {
      const params = new URLSearchParams({
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: String(Math.min(50, limit - videoIds.length)),
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetch(`${YT_DATA}/playlistItems?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(
          `[analytics:account-sync] YouTube playlistItems HTTP ${res.status}: ${body.slice(0, 200)}`,
        );
        break;
      }
      const data = (await res.json()) as {
        items?: Array<{
          snippet?: {
            title?: string;
            publishedAt?: string;
            resourceId?: { videoId?: string };
          };
        }>;
        nextPageToken?: string;
      };
      for (const item of data.items ?? []) {
        const id = item.snippet?.resourceId?.videoId;
        if (!id) continue;
        videoIds.push(id);
        meta.set(id, {
          title: (item.snippet?.title || `YouTube video ${id}`).slice(0, 200),
          publishedAt: item.snippet?.publishedAt ?? null,
        });
        if (videoIds.length >= limit) break;
      }
      if (!data.nextPageToken || videoIds.length >= limit) break;
      pageToken = data.nextPageToken;
    }

    for (let i = 0; i < videoIds.length; i += 50) {
      const batch = videoIds.slice(i, i + 50);
      const res = await fetch(
        `${YT_DATA}/videos?` +
          new URLSearchParams({
            part: 'statistics',
            id: batch.join(','),
          }).toString(),
        { headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' } },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(
          `[analytics:account-sync] YouTube videos HTTP ${res.status}: ${body.slice(0, 200)}`,
        );
        continue;
      }
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
          };
        }>;
      };
      for (const v of data.items ?? []) {
        const m = meta.get(v.id);
        rows.push({
          id: v.id,
          title: m?.title ?? `YouTube video ${v.id}`,
          publishedAt: m?.publishedAt ?? null,
          views: Number(v.statistics?.viewCount ?? 0) || 0,
          likes: Number(v.statistics?.likeCount ?? 0) || 0,
          comments: Number(v.statistics?.commentCount ?? 0) || 0,
        });
      }
    }
  } catch (err) {
    console.warn(`[analytics:account-sync] YouTube uploads list error:`, err);
  }
  return rows;
}

/** Ensure a PublishTarget exists for an external YouTube video (for analytics UI). */
async function ensureImportedYouTubeVideo(
  prisma: PrismaClient,
  accountId: string,
  video: YtVideoRow,
): Promise<string> {
  const existing = await prisma.publishTarget.findFirst({
    where: { accountId, platformPostId: video.id },
    select: { id: true },
  });
  if (existing) return existing.id;

  const content = await prisma.contentItem.create({
    data: {
      type: 'MANUAL_UPLOAD',
      title: video.title,
      status: 'PUBLISHED',
      statusReason: 'Imported from YouTube for analytics (not created in CreatorPilot)',
      currentStep: { importedFrom: 'youtube', externalVideoId: video.id },
      publishTargets: {
        create: {
          accountId,
          status: 'PUBLISHED',
          platformPostId: video.id,
          publishedAt: video.publishedAt ? new Date(video.publishedAt) : new Date(),
          scheduleMode: 'NOW',
          metadataOverride: { source: 'youtube_import' },
        },
      },
    },
    include: { publishTargets: { select: { id: true } } },
  });
  return content.publishTargets[0]!.id;
}

type YtDayBucket = DayBucket & {
  watchTimeMin: number;
  revenue: number;
  /** averageViewPercentage from Analytics API (0–100). */
  retentionRate: number;
};

/** Daily channel reports via YouTube Analytics API (requires yt-analytics scopes). */
async function fetchYouTubeAnalyticsDays(
  accessToken: string,
): Promise<{ days: Map<string, YtDayBucket>; lastError: string | null }> {
  const out = new Map<string, YtDayBucket>();
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 90);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  let lastError: string | null = null;

  // Thumbnail impressions/CTR require the Reporting API — not reliable on Analytics.
  // averageViewPercentage = avg % of video watched (maps to retentionRate).
  const metricSets = [
    'views,estimatedMinutesWatched,likes,comments,shares,averageViewPercentage,estimatedRevenue',
    'views,estimatedMinutesWatched,likes,comments,shares,averageViewPercentage',
    'views,estimatedMinutesWatched,likes,comments,estimatedRevenue',
    'views,estimatedMinutesWatched,likes,comments',
    'views,estimatedMinutesWatched',
    'views',
  ];

  for (const metrics of metricSets) {
    const url =
      `${YT_ANALYTICS}?` +
      new URLSearchParams({
        ids: 'channel==MINE',
        startDate: fmt(start),
        endDate: fmt(end),
        metrics,
        dimensions: 'day',
        sort: 'day',
      }).toString();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastError = `HTTP ${res.status}: ${body.slice(0, 240)}`;
        console.warn(
          `[analytics:account-sync] YouTube Analytics HTTP ${res.status} (${metrics}): ${body.slice(0, 180)}`,
        );
        // 401/403 usually mean missing scopes / Analytics API disabled — no point retrying
        // narrower metric sets with the same token.
        if (res.status === 401 || res.status === 403) break;
        continue;
      }
      const data = (await res.json()) as {
        columnHeaders?: Array<{ name?: string }>;
        rows?: unknown[][];
      };
      const cols = (data.columnHeaders ?? []).map((c) => c.name ?? '');
      const dayIdx = cols.indexOf('day');
      const viewsIdx = cols.indexOf('views');
      const watchIdx = cols.indexOf('estimatedMinutesWatched');
      const likesIdx = cols.indexOf('likes');
      const commentsIdx = cols.indexOf('comments');
      const sharesIdx = cols.indexOf('shares');
      const retentionIdx = cols.indexOf('averageViewPercentage');
      const revenueIdx = cols.indexOf('estimatedRevenue');
      if (dayIdx < 0 || viewsIdx < 0) continue;

      for (const row of data.rows ?? []) {
        const day = String(row[dayIdx] ?? '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const views = Number(row[viewsIdx] ?? 0) || 0;
        const watchTimeMin = watchIdx >= 0 ? Math.round(Number(row[watchIdx] ?? 0) || 0) : 0;
        const likes = likesIdx >= 0 ? Number(row[likesIdx] ?? 0) || 0 : 0;
        const comments = commentsIdx >= 0 ? Number(row[commentsIdx] ?? 0) || 0 : 0;
        const shares = sharesIdx >= 0 ? Number(row[sharesIdx] ?? 0) || 0 : 0;
        const retentionRate =
          retentionIdx >= 0 ? Number(row[retentionIdx] ?? 0) || 0 : 0;
        const revenue = revenueIdx >= 0 ? Number(row[revenueIdx] ?? 0) || 0 : 0;
        out.set(day, {
          views,
          uniqueViewers: 0,
          impressions: 0,
          engagements: likes + comments + shares,
          watchTimeMin,
          revenue,
          retentionRate,
        });
      }
      if (out.size > 0) {
        lastError = null;
        break;
      }
      // Empty rows with 200 = valid but no activity in range (not an auth failure).
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[analytics:account-sync] YouTube Analytics error:`, err);
    }
  }
  return { days: out, lastError };
}

async function maybeRaiseYouTubeAnalyticsIncident(
  prisma: PrismaClient,
  accountId: string,
  lastError: string,
): Promise<void> {
  const since = new Date(Date.now() - 24 * 86_400_000);
  const existing = await prisma.incident.findFirst({
    where: {
      accountId,
      status: 'OPEN',
      kind: 'AUTH',
      createdAt: { gte: since },
      title: { contains: 'YouTube Analytics' },
    },
    select: { id: true },
  });
  if (existing) return;

  await raiseIncident(prisma, {
    kind: 'AUTH',
    severity: 'MEDIUM',
    accountId,
    title: 'YouTube Analytics sync failed — reconnect channel',
    detail: {
      error: lastError,
      hint:
        'Enable YouTube Analytics API in Google Cloud, ensure OAuth consent includes yt-analytics.readonly (+ monetary), then reconnect this YouTube account. Subscriber count can still work via Data API alone.',
    },
  });
}

async function syncYouTubeAccount(
  prisma: PrismaClient,
  accountId: string,
  accessToken: string,
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);

  const channel = await fetchYouTubeChannelStats(accessToken);
  const followers = channel?.subscribers ?? null;
  const { days, lastError } = await fetchYouTubeAnalyticsDays(accessToken);

  if (lastError) {
    await maybeRaiseYouTubeAnalyticsIncident(prisma, accountId, lastError);
  }

  // Import recent uploads so the per-video table is not empty for channels that
  // never published through CreatorPilot (mirrors Facebook analytics import).
  let videos: YtVideoRow[] = [];
  if (channel?.uploadsPlaylistId) {
    videos = await listYouTubeChannelVideos(accessToken, channel.uploadsPlaylistId, 200);
    for (const video of videos) {
      try {
        const publishTargetId = await ensureImportedYouTubeVideo(prisma, accountId, video);
        await upsertPostSnapshot(prisma, publishTargetId, accountId, today, {
          views: video.views,
          likes: video.likes,
          comments: video.comments,
        });
      } catch (err) {
        console.warn(`[analytics:account-sync] import YT video ${video.id} failed:`, err);
      }
    }
  }

  if (days.size === 0) {
    // Keep followers on today's account snapshot. Do NOT write lifetime channel
    // viewCount here — that would inflate Last 7D/30D ranges. KPI views come from
    // the API's per-video fallback once uploads are imported below.
    await prisma.metricSnapshotAccount.upsert({
      where: { accountId_date: { accountId, date: today } },
      create: {
        accountId,
        date: today,
        followers: followers ?? 0,
        views: 0,
        uniqueViewers: 0,
        impressions: 0,
        engagements: 0,
        watchTimeMin: 0,
        ctr: 0,
        revenue: 0,
        rpm: 0,
        syncedAt: new Date(),
      },
      update: {
        ...(followers !== null ? { followers } : {}),
        syncedAt: new Date(),
      },
    });

    // Seed day buckets from video publish dates (same pattern as Facebook Insights
    // fallback) so charts have shape when Analytics API is unavailable.
    if (videos.length > 0) {
      const byDay = new Map<string, DayBucket>();
      for (const video of videos) {
        const day = (video.publishedAt ?? today.toISOString()).slice(0, 10);
        const b = byDay.get(day) ?? {
          views: 0,
          uniqueViewers: 0,
          impressions: 0,
          engagements: 0,
        };
        b.views += video.views;
        b.engagements += video.likes + video.comments;
        byDay.set(day, b);
      }
      for (const [dayStr, bucket] of byDay) {
        const date = new Date(`${dayStr}T00:00:00.000Z`);
        const isToday = dayStr === todayStr;
        await prisma.metricSnapshotAccount.upsert({
          where: { accountId_date: { accountId, date } },
          create: {
            accountId,
            date,
            followers: isToday ? (followers ?? 0) : 0,
            views: bucket.views,
            uniqueViewers: 0,
            impressions: 0,
            engagements: bucket.engagements,
            watchTimeMin: 0,
            ctr: 0,
            revenue: 0,
            rpm: 0,
            syncedAt: new Date(),
          },
          update: {
            views: bucket.views,
            engagements: bucket.engagements,
            ...(isToday && followers !== null ? { followers } : {}),
            syncedAt: new Date(),
          },
        });
      }
    }

    const videoViews = videos.reduce((s, v) => s + v.views, 0);
    console.log(
      `[analytics:account-sync] YouTube ${accountId}: followers=${followers ?? 'n/a'} ` +
        `videos=${videos.length} videoViews=${videoViews}` +
        (channel?.lifetimeViews != null ? ` lifetimeViews=${channel.lifetimeViews}` : '') +
        (lastError ? ` analyticsError=${lastError.slice(0, 120)}` : ' (no daily Analytics rows)'),
    );
    return;
  }

  for (const [dayStr, bucket] of days) {
    const date = new Date(`${dayStr}T00:00:00.000Z`);
    const isToday = dayStr === todayStr;
    await prisma.metricSnapshotAccount.upsert({
      where: { accountId_date: { accountId, date } },
      create: {
        accountId,
        date,
        followers: isToday ? (followers ?? 0) : 0,
        views: bucket.views,
        uniqueViewers: bucket.uniqueViewers,
        impressions: bucket.impressions,
        engagements: bucket.engagements,
        watchTimeMin: bucket.watchTimeMin,
        ctr: 0,
        retentionRate: bucket.retentionRate,
        revenue: bucket.revenue,
        rpm: bucket.views > 0 ? (bucket.revenue / bucket.views) * 1000 : 0,
        syncedAt: new Date(),
      },
      update: {
        views: bucket.views,
        engagements: bucket.engagements,
        watchTimeMin: bucket.watchTimeMin,
        retentionRate: bucket.retentionRate,
        revenue: bucket.revenue,
        rpm: bucket.views > 0 ? (bucket.revenue / bucket.views) * 1000 : 0,
        ...(isToday && followers !== null ? { followers } : {}),
        syncedAt: new Date(),
      },
    });
  }

  console.log(
    `[analytics:account-sync] YouTube ${accountId}: followers=${followers ?? 'n/a'} ` +
      `days=${days.size} videos=${videos.length}`,
  );
}

async function syncYouTubePost(
  prisma: PrismaClient,
  publishTargetId: string,
  accountId: string,
  videoId: string,
  accessToken: string,
  today: Date,
): Promise<void> {
  const url =
    `${YT_DATA}/videos?` +
    new URLSearchParams({
      part: 'statistics',
      id: videoId,
    }).toString();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(
      `[analytics:post-sync] YouTube videos HTTP ${res.status} for ${videoId}: ${body.slice(0, 180)}`,
    );
    return;
  }
  const data = (await res.json()) as {
    items?: Array<{
      statistics?: {
        viewCount?: string;
        likeCount?: string;
        commentCount?: string;
      };
    }>;
  };
  const stats = data.items?.[0]?.statistics;
  if (!stats) {
    console.warn(`[analytics:post-sync] YouTube video ${videoId} not found`);
    return;
  }
  await upsertPostSnapshot(prisma, publishTargetId, accountId, today, {
    views: Number(stats.viewCount ?? 0) || 0,
    likes: Number(stats.likeCount ?? 0) || 0,
    comments: Number(stats.commentCount ?? 0) || 0,
  });
  console.log(`[analytics:post-sync] synced YT target ${publishTargetId}`);
}

// ── 1. Account metrics sync ────────────────────────────────────────────────

export async function runAccountSync(accountId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, deletedAt: null },
  });
  if (!account || account.paused) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (!account.authPayload) {
    console.log(`[analytics:account-sync] account ${accountId} has no auth — skipping`);
    return;
  }

  try {
    if (account.platform === 'FACEBOOK') {
      const masterKey = getMasterKey();
      if (!masterKey) {
        console.log(`[analytics:account-sync] MASTER_KEY missing — cannot decrypt Facebook auth`);
        return;
      }
      const auth = decryptAccountAuth(account.authPayload, masterKey);
      const pageId =
        typeof auth.pageId === 'string' ? auth.pageId : account.externalId;
      const token =
        typeof auth.pageAccessToken === 'string' ? auth.pageAccessToken : null;
      if (!pageId || !token) {
        console.log(`[analytics:account-sync] Facebook account ${accountId} missing page token`);
        return;
      }
      await syncFacebookAccount(prisma, accountId, pageId, token);
      return;
    }

    if (account.platform === 'YOUTUBE') {
      const masterKey = getMasterKey();
      if (!masterKey) {
        console.log(`[analytics:account-sync] MASTER_KEY missing — cannot decrypt YouTube auth`);
        return;
      }
      const auth = decryptAccountAuth(account.authPayload, masterKey);
      const token = typeof auth.accessToken === 'string' ? auth.accessToken : null;
      if (!token) {
        console.log(`[analytics:account-sync] YouTube account ${accountId} missing access token`);
        return;
      }
      await syncYouTubeAccount(prisma, accountId, token);
      return;
    }

    // Other platforms: keep pipeline alive without wiping known followers.
    await prisma.metricSnapshotAccount.upsert({
      where: { accountId_date: { accountId, date: today } },
      create: {
        accountId,
        date: today,
        followers: 0,
        views: 0,
        watchTimeMin: 0,
        impressions: 0,
        ctr: 0,
        revenue: 0,
        rpm: 0,
        engagements: 0,
        syncedAt: new Date(),
      },
      update: {
        syncedAt: new Date(),
      },
    });
    console.log(
      `[analytics:account-sync] synced account ${accountId} for ${today.toISOString().slice(0, 10)} (stub)`,
    );
  } catch (err) {
    console.error(`[analytics:account-sync] failed for account ${accountId}:`, err);
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      severity: 'LOW',
      accountId,
      title: `Analytics sync failed for account`,
      detail: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

// ── 2. Post metrics sync ───────────────────────────────────────────────────

export async function runPostSync(publishTargetId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const target = await prisma.publishTarget.findUnique({
    where: { id: publishTargetId },
    include: {
      account: {
        select: {
          id: true,
          authPayload: true,
          platform: true,
          paused: true,
          deletedAt: true,
          externalId: true,
        },
      },
    },
  });
  if (!target || target.status !== 'PUBLISHED') return;
  if (!target.account || target.account.deletedAt || target.account.paused) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (!target.account.authPayload) {
    console.log(`[analytics:post-sync] account ${target.accountId} has no auth — skipping`);
    return;
  }

  try {
    if (target.account.platform === 'FACEBOOK' && target.platformPostId) {
      const masterKey = getMasterKey();
      if (!masterKey) return;
      const auth = decryptAccountAuth(target.account.authPayload, masterKey);
      const token =
        typeof auth.pageAccessToken === 'string' ? auth.pageAccessToken : null;
      if (!token) return;

      const url =
        `${GRAPH}/${encodeURIComponent(target.platformPostId)}?` +
        new URLSearchParams({
          fields: 'views,likes.summary(true),comments.summary(true),status',
          access_token: token,
        }).toString();
      const res = await fetch(url);
      const data = (await res.json().catch(() => ({}))) as {
        views?: number;
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
        status?: { video_status?: string } | string;
        error?: { message?: string; code?: number; error_user_msg?: string };
      };
      if (isFacebookVideoMissing(res.status, data)) {
        await markPublishTargetPlatformIssue(
          prisma,
          {
            id: target.id,
            accountId: target.accountId,
            contentItemId: target.contentItemId,
            platformPostId: target.platformPostId,
          },
          {
            reason: 'removed_from_platform',
            message: `Video ${target.platformPostId} is no longer on Facebook.`,
            kind: 'PLATFORM_REJECT',
          },
        );
        console.warn(`[analytics:post-sync] marked removed FB target ${publishTargetId}`);
        return;
      }
      if (!res.ok || data.error) {
        const msg = [data.error?.message, data.error?.error_user_msg].filter(Boolean).join(' ');
        console.warn(`[analytics:post-sync] Meta video HTTP ${res.status} for ${target.platformPostId}: ${msg}`);
        if (looksLikeFacebookCopyright(msg)) {
          await markPublishTargetPlatformIssue(
            prisma,
            {
              id: target.id,
              accountId: target.accountId,
              contentItemId: target.contentItemId,
              platformPostId: target.platformPostId,
            },
            {
              reason: 'copyright',
              message: msg || 'Facebook copyright / rights issue.',
              kind: 'COPYRIGHT',
            },
          );
        }
        return;
      }
      const videoStatus = (
        typeof data.status === 'string' ? data.status : (data.status?.video_status ?? '')
      ).toLowerCase();
      if (looksLikeFacebookCopyright(videoStatus)) {
        await markPublishTargetPlatformIssue(
          prisma,
          {
            id: target.id,
            accountId: target.accountId,
            contentItemId: target.contentItemId,
            platformPostId: target.platformPostId,
          },
          {
            reason: 'copyright',
            message: `Facebook copyright/rights status: ${videoStatus}`,
            kind: 'COPYRIGHT',
          },
        );
        return;
      }
      await upsertPostSnapshot(prisma, publishTargetId, target.accountId, today, {
        views: typeof data.views === 'number' ? data.views : 0,
        likes: data.likes?.summary?.total_count ?? 0,
        comments: data.comments?.summary?.total_count ?? 0,
      });
      console.log(`[analytics:post-sync] synced FB target ${publishTargetId}`);
      return;
    }

    if (target.account.platform === 'YOUTUBE' && target.platformPostId) {
      const masterKey = getMasterKey();
      if (!masterKey) return;
      const auth = decryptAccountAuth(target.account.authPayload, masterKey);
      const token = typeof auth.accessToken === 'string' ? auth.accessToken : null;
      if (!token) return;
      await syncYouTubePost(
        prisma,
        publishTargetId,
        target.accountId,
        target.platformPostId,
        token,
        today,
      );
      return;
    }

    // Non-Facebook/YouTube: touch syncedAt without zeroing existing metrics.
    await prisma.metricSnapshotPost.upsert({
      where: { publishTargetId_date: { publishTargetId, date: today } },
      create: {
        publishTargetId,
        accountId: target.accountId,
        date: today,
        views: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        watchTimeMin: 0,
        impressions: 0,
        ctr: 0,
        retentionCurve: [],
        syncedAt: new Date(),
      },
      update: { syncedAt: new Date() },
    });
    console.log(`[analytics:post-sync] synced target ${publishTargetId} (stub)`);
  } catch (err) {
    console.error(`[analytics:post-sync] failed for target ${publishTargetId}:`, err);
  }
}


// ── 3. Internal AI usage rollup ────────────────────────────────────────────

export async function runInternalRollup(_boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);

  const dayEnd = new Date(yesterday);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  try {
    const rows = await prisma.aiUsageLog.groupBy({
      by: ['providerId', 'task'],
      where: {
        createdAt: { gte: yesterday, lt: dayEnd },
        providerId: { not: null },
      },
      _count: { id: true },
      _sum: {
        tokensIn: true,
        tokensOut: true,
        ttsSeconds: true,
        estimatedCostUsd: true,
      },
    });

    const cacheRows = await prisma.aiUsageLog.groupBy({
      by: ['providerId', 'task'],
      where: {
        createdAt: { gte: yesterday, lt: dayEnd },
        providerId: { not: null },
        cacheHit: true,
      },
      _count: { id: true },
    });

    const cacheMap = new Map<string, number>();
    for (const r of cacheRows) {
      cacheMap.set(`${r.providerId ?? ''}|${r.task}`, r._count.id);
    }

    for (const r of rows) {
      const providerId = r.providerId ?? 'unknown';
      const key = `${providerId}|${r.task}`;
      await prisma.aiUsageDaily.upsert({
        where: { date_providerId_task: { date: yesterday, providerId, task: r.task } },
        create: {
          date: yesterday,
          providerId,
          task: r.task,
          totalCalls: r._count.id,
          cacheHits: cacheMap.get(key) ?? 0,
          tokensIn: r._sum.tokensIn ?? 0,
          tokensOut: r._sum.tokensOut ?? 0,
          ttsSeconds: r._sum.ttsSeconds ?? 0,
          estimatedCostUsd: r._sum.estimatedCostUsd ?? 0,
        },
        update: {
          totalCalls: r._count.id,
          cacheHits: cacheMap.get(key) ?? 0,
          tokensIn: r._sum.tokensIn ?? 0,
          tokensOut: r._sum.tokensOut ?? 0,
          ttsSeconds: r._sum.ttsSeconds ?? 0,
          estimatedCostUsd: r._sum.estimatedCostUsd ?? 0,
        },
      });
    }

    console.log(`[analytics:rollup] AI usage rollup for ${yesterday.toISOString().slice(0, 10)} — ${rows.length} group(s)`);
  } catch (err) {
    console.error('[analytics:rollup] AI usage rollup failed:', err);
  }
}

// ── Best-time-to-post learner (Phase 7 #11) ─────────────────────────────────

/**
 * Mine published-post engagement to compute per-account best posting hour
 * (day-of-week × hour). Score = average views per post published in that bucket,
 * so buckets with only a handful of posts are still surfaced but weighted by
 * `sampleSize`. Scheduler UI can suggest picking a top-N slot.
 */
export async function runBestTimeLearner(_boss: PgBoss): Promise<void> {
  const prisma = getPrisma();

  const accounts = await prisma.socialAccount.findMany({
    where: { deletedAt: null, paused: false },
    select: { id: true },
  });

  for (const acct of accounts) {
    // Pull the account's published posts + latest snapshot per post.
    const targets = await prisma.publishTarget.findMany({
      where: {
        accountId: acct.id,
        status: 'PUBLISHED',
        publishedAt: { not: null },
      },
      select: {
        publishedAt: true,
        metricSnapshots: {
          orderBy: { date: 'desc' },
          take: 1,
          select: { views: true, likes: true, comments: true },
        },
      },
      take: 500,
    });

    if (targets.length === 0) continue;

    // Bucket by (dow, hour). Monday=0 (ISO). Score = views + 10*likes + 20*comments.
    type Bucket = { total: number; count: number };
    const buckets = new Map<string, Bucket>();
    for (const t of targets) {
      if (!t.publishedAt) continue;
      const d = t.publishedAt;
      const dow = (d.getUTCDay() + 6) % 7;
      const hour = d.getUTCHours();
      const snap = t.metricSnapshots[0];
      const score = snap ? snap.views + 10 * snap.likes + 20 * snap.comments : 0;
      const key = `${dow}:${hour}`;
      const b = buckets.get(key) ?? { total: 0, count: 0 };
      b.total += score;
      b.count += 1;
      buckets.set(key, b);
    }

    // Delete stale rows for this account and reinsert the fresh batch.
    await prisma.bestPostingHour.deleteMany({ where: { accountId: acct.id } });

    if (buckets.size === 0) continue;

    const rows = [...buckets.entries()].map(([key, b]) => {
      const [dow, hour] = key.split(':').map(Number);
      return {
        accountId: acct.id,
        dayOfWeek: dow!,
        hour: hour!,
        score: b.count > 0 ? b.total / b.count : 0,
        sampleSize: b.count,
      };
    });
    await prisma.bestPostingHour.createMany({ data: rows });

    console.log(`[analytics:learner] account ${acct.id} — ${buckets.size} bucket(s) from ${targets.length} post(s)`);
  }
}

// ── 4. Worker productivity rollup ──────────────────────────────────────────

export async function runWorkerRollup(_boss: PgBoss): Promise<void> {
  const prisma = getPrisma();

  // Find the Monday of the current week
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const weekStart = new Date(now);
  weekStart.setUTCDate(now.getUTCDate() - ((dayOfWeek + 6) % 7));
  weekStart.setUTCHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

  try {
    const workers = await prisma.user.findMany({
      where: { role: 'REVIEWER', status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    for (const worker of workers) {
      const tasks = await prisma.workerTask.findMany({
        where: {
          workerId: worker.id,
          createdAt: { gte: weekStart, lt: weekEnd },
        },
        select: { status: true, assignedAt: true, uploadedAt: true, revisionNotes: true },
      });

      const assigned = tasks.length;
      const completed = tasks.filter((t) => t.status === 'DONE').length;

      const hoursToComplete: number[] = [];
      for (const t of tasks) {
        if (t.uploadedAt && t.assignedAt) {
          hoursToComplete.push((t.uploadedAt.getTime() - t.assignedAt.getTime()) / 3_600_000);
        }
      }
      hoursToComplete.sort((a, b) => a - b);
      const median =
        hoursToComplete.length > 0
          ? hoursToComplete[Math.floor(hoursToComplete.length / 2)]
          : null;

      const withRevisions = tasks.filter((t) => t.revisionNotes.length > 0).length;
      const revisionRate = assigned > 0 ? withRevisions / assigned : 0;

      await prisma.workerProductivitySnapshot.upsert({
        where: { userId_weekStart: { userId: worker.id, weekStart } },
        create: {
          userId: worker.id,
          weekStart,
          tasksAssigned: assigned,
          tasksCompleted: completed,
          medianHoursToComplete: median,
          revisionRate,
        },
        update: {
          tasksAssigned: assigned,
          tasksCompleted: completed,
          medianHoursToComplete: median,
          revisionRate,
        },
      });
    }

    console.log(`[analytics:rollup] worker productivity for week ${weekStart.toISOString().slice(0, 10)} — ${workers.length} worker(s)`);
  } catch (err) {
    console.error('[analytics:rollup] worker productivity rollup failed:', err);
  }
}
