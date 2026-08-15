/**
 * Analytics sync processors (docs/07, Phase 5). Four functions that pull
 * metrics into snapshot tables. External API calls gracefully degrade when
 * credentials are absent — log + skip, never crash.
 */
import type PgBoss from 'pg-boss';
import type { PrismaClient } from '@scp/db';
import { decryptAccountAuth, getMasterKey, getPrisma, raiseIncident } from './publish-support.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

type DayBucket = {
  views: number;
  uniqueViewers: number;
  impressions: number;
  engagements: number;
};

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
  const metricSets = [
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
        rows.push({
          id: v.id,
          title: (v.title || v.description || `Facebook video ${v.id}`).slice(0, 200),
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
    listFacebookPageVideos(pageId, pageAccessToken, 40),
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
          fields: 'views,likes.summary(true),comments.summary(true)',
          access_token: token,
        }).toString();
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[analytics:post-sync] Meta video HTTP ${res.status} for ${target.platformPostId}`);
        return;
      }
      const data = (await res.json()) as {
        views?: number;
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
      };
      await upsertPostSnapshot(prisma, publishTargetId, target.accountId, today, {
        views: typeof data.views === 'number' ? data.views : 0,
        likes: data.likes?.summary?.total_count ?? 0,
        comments: data.comments?.summary?.total_count ?? 0,
      });
      console.log(`[analytics:post-sync] synced FB target ${publishTargetId}`);
      return;
    }

    // Non-Facebook: touch syncedAt without zeroing existing metrics.
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
