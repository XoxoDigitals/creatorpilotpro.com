import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { parseDateRange } from './dto/analytics.dto';
import {
  toAccountSnapshot,
  toPostSnapshot,
  toAiUsageDay,
  toWorkerSnapshot,
  type OverviewView,
  type AccountMetricsView,
  type PostMetricsView,
  type PostTableRowView,
  type AiUsageView,
  type WorkerProductivityView,
  type SystemHealthView,
} from './analytics.view';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
  ) {}

  async getOverview(): Promise<OverviewView> {
    const db = this.prisma.client;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const [
      latestSnapshots,
      publishedToday,
      failedToday,
      scheduledCount,
      pendingReviews,
      openIncidents,
      aiSpendRows,
    ] = await Promise.all([
      db.metricSnapshotAccount.findMany({
        where: { date: today },
        select: { followers: true, views: true, revenue: true },
      }),
      db.publishTarget.count({
        where: { status: 'PUBLISHED', publishedAt: { gte: today } },
      }),
      db.publishTarget.count({
        where: { status: 'FAILED', updatedAt: { gte: today } },
      }),
      db.publishTarget.count({
        where: { status: 'SCHEDULED' },
      }),
      db.contentItem.count({
        where: { status: 'REVIEW_PENDING', deletedAt: null },
      }),
      db.incident.count({
        where: { status: 'OPEN' },
      }),
      db.aiUsageDaily.findMany({
        where: { date: today },
        select: { estimatedCostUsd: true },
      }),
    ]);

    let totalFollowers = 0;
    let totalViews = 0;
    let totalRevenue = 0;
    for (const s of latestSnapshots) {
      totalFollowers += s.followers;
      totalViews += s.views;
      totalRevenue += Number(s.revenue);
    }

    let aiSpendToday = 0;
    for (const r of aiSpendRows) {
      aiSpendToday += Number(r.estimatedCostUsd);
    }

    return {
      totalFollowers,
      totalViews,
      totalRevenue: totalRevenue.toFixed(4),
      publishedToday,
      failedToday,
      scheduledCount,
      pendingReviews,
      openIncidents,
      aiSpendToday: aiSpendToday.toFixed(6),
    };
  }

  async getAccountMetrics(
    accountId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<AccountMetricsView> {
    const { from, to } = parseDateRange(fromStr, toStr);
    const snapshots = await this.prisma.client.metricSnapshotAccount.findMany({
      where: { accountId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    let views = 0;
    let uniqueViewers = 0;
    let watchTimeMin = 0;
    let revenue = 0;
    let engagements = 0;
    let impressions = 0;
    let ctrSum = 0;
    let retentionSum = 0;
    const firstFollowers = snapshots.length > 0 ? snapshots[0]!.followers : 0;
    const lastFollowers = snapshots.length > 0 ? snapshots[snapshots.length - 1]!.followers : 0;

    for (const s of snapshots) {
      views += s.views;
      uniqueViewers += s.uniqueViewers;
      watchTimeMin += s.watchTimeMin;
      revenue += Number(s.revenue);
      engagements += s.engagements;
      impressions += s.impressions;
      ctrSum += s.ctr;
      retentionSum += s.retentionRate;
    }

    // When Page Insights didn't populate account snapshots (common for Meta),
    // fall back to summing latest per-video metrics for posts in the range.
    if (views === 0 && engagements === 0) {
      const targets = await this.prisma.client.publishTarget.findMany({
        where: {
          accountId,
          status: 'PUBLISHED',
          publishedAt: { gte: from, lte: to },
        },
        include: {
          metricSnapshots: { orderBy: { date: 'desc' }, take: 1 },
        },
      });
      let postViews = 0;
      let postEng = 0;
      let postImpressions = 0;
      let postUnique = 0;
      let postWatch = 0;
      let postRetention = 0;
      let postCtr = 0;
      let withSnap = 0;
      for (const t of targets) {
        const s = t.metricSnapshots[0];
        if (!s) continue;
        withSnap += 1;
        postViews += s.views;
        postEng += s.likes + s.comments + s.shares;
        postImpressions += s.impressions;
        postUnique += s.uniqueViewers;
        postWatch += s.watchTimeMin;
        postRetention += s.retentionRate;
        postCtr += s.ctr;
      }
      if (postViews > 0 || postEng > 0) {
        views = postViews;
        engagements = postEng;
        if (impressions === 0) impressions = postImpressions;
        if (uniqueViewers === 0) uniqueViewers = postUnique;
        if (watchTimeMin === 0) watchTimeMin = postWatch;
        if (withSnap > 0) {
          retentionSum = postRetention;
          ctrSum = postCtr;
        }
      }
    }

    const n = snapshots.length || 1;
    const mapped = snapshots.map(toAccountSnapshot);
    const latest = mapped.length > 0 ? mapped[mapped.length - 1] : undefined;

    return {
      accountId,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totals: {
        views,
        uniqueViewers,
        watchTimeMin,
        revenue: revenue.toFixed(4),
        followersDelta: lastFollowers - firstFollowers,
        engagements,
        impressions,
        avgCtr: ctrSum / Math.max(n, 1),
        avgRetentionRate: retentionSum / Math.max(n, 1),
      },
      ...(latest ? { latest } : {}),
      snapshots: mapped,
    };
  }

  async getAccountPosts(
    accountId: string,
    fromStr?: string,
    toStr?: string,
  ): Promise<PostTableRowView[]> {
    // No from/to → all-time published videos (Per-video table is not range-scoped).
    const dateFilter =
      fromStr || toStr
        ? (() => {
            const { from, to } = parseDateRange(fromStr, toStr);
            return { publishedAt: { gte: from, lte: to } };
          })()
        : { publishedAt: { not: null } };

    const targets = await this.prisma.client.publishTarget.findMany({
      where: {
        accountId,
        status: 'PUBLISHED',
        ...dateFilter,
      },
      include: {
        contentItem: { select: { title: true } },
        metricSnapshots: {
          orderBy: { date: 'desc' },
          take: 1,
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 500,
    });

    return targets.map((t) => {
      const latest = t.metricSnapshots[0];
      return {
        publishTargetId: t.id,
        contentTitle: t.contentItem.title,
        publishedAt: t.publishedAt?.toISOString() ?? null,
        platformPostId: t.platformPostId,
        views: latest?.views ?? 0,
        uniqueViewers: latest?.uniqueViewers ?? 0,
        likes: latest?.likes ?? 0,
        comments: latest?.comments ?? 0,
        shares: latest?.shares ?? 0,
        saves: latest?.saves ?? 0,
        impressions: latest?.impressions ?? 0,
        ctr: latest?.ctr ?? 0,
        watchTimeMin: latest?.watchTimeMin ?? 0,
        averageViewDurationSec: latest?.averageViewDurationSec ?? 0,
        retentionRate: latest?.retentionRate ?? 0,
      };
    });
  }

  async getPostMetrics(publishTargetId: string): Promise<PostMetricsView> {
    const target = await this.prisma.client.publishTarget.findUniqueOrThrow({
      where: { id: publishTargetId },
      include: {
        contentItem: { select: { title: true } },
        metricSnapshots: { orderBy: { date: 'asc' } },
      },
    });

    const latestSnapshot = target.metricSnapshots.length > 0
      ? target.metricSnapshots[target.metricSnapshots.length - 1]
      : null;

    return {
      publishTargetId: target.id,
      contentTitle: target.contentItem.title,
      accountId: target.accountId,
      publishedAt: target.publishedAt?.toISOString() ?? null,
      platformPostId: target.platformPostId,
      snapshots: target.metricSnapshots.map(toPostSnapshot),
      retentionCurve: (latestSnapshot?.retentionCurve as unknown[]) ?? [],
    };
  }

  async getAiUsage(fromStr?: string, toStr?: string): Promise<AiUsageView> {
    const { from, to } = parseDateRange(fromStr, toStr);

    const rows = await this.prisma.client.aiUsageDaily.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    let totalCalls = 0;
    let cacheHits = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let estimatedCostUsd = 0;
    for (const r of rows) {
      totalCalls += r.totalCalls;
      cacheHits += r.cacheHits;
      tokensIn += r.tokensIn;
      tokensOut += r.tokensOut;
      estimatedCostUsd += Number(r.estimatedCostUsd);
    }

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      totals: {
        totalCalls,
        cacheHits,
        tokensIn,
        tokensOut,
        estimatedCostUsd: estimatedCostUsd.toFixed(6),
      },
      rows: rows.map(toAiUsageDay),
    };
  }

  async getWorkerProductivity(fromStr?: string, toStr?: string): Promise<WorkerProductivityView> {
    const { from, to } = parseDateRange(fromStr, toStr);

    const snapshots = await this.prisma.client.workerProductivitySnapshot.findMany({
      where: { weekStart: { gte: from, lte: to } },
      orderBy: { weekStart: 'desc' },
    });

    const assignments = await this.prisma.client.workerTask.groupBy({
      by: ['workerId'],
      where: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
      _count: { id: true },
    });

    const workerIds = [...new Set(assignments.map((a) => a.workerId))];
    const workers = workerIds.length > 0
      ? await this.prisma.client.user.findMany({
          where: { id: { in: workerIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const workerMap = new Map(workers.map((w) => [w.id, w.name ?? w.email]));

    return {
      snapshots: snapshots.map(toWorkerSnapshot),
      currentAssignments: assignments.map((a) => ({
        workerId: a.workerId,
        workerName: workerMap.get(a.workerId) ?? a.workerId,
        activeTasks: a._count.id,
      })),
    };
  }

  async getSystemHealth(): Promise<SystemHealthView> {
    const db = this.prisma.client;

    const [
      assetStats,
      activeWatchers,
      errorWatchers,
      activeCompetitors,
      errorCompetitors,
      lastAccountSync,
      lastPostSync,
    ] = await Promise.all([
      db.asset.aggregate({ _count: { id: true }, _sum: { bytes: true } }),
      db.watchedSource.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      db.watchedSource.count({ where: { status: 'ERROR', deletedAt: null } }),
      db.competitorChannel.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      db.competitorChannel.count({ where: { status: 'ERROR', deletedAt: null } }),
      db.metricSnapshotAccount.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
      db.metricSnapshotPost.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } }),
    ]);

    // Queue depths from job_runs table (approximation — pg-boss tables not directly accessible)
    const pendingJobs = await db.jobRun.groupBy({
      by: ['queue'],
      where: { status: { in: ['WAITING', 'ACTIVE'] } },
      _count: { id: true },
    });
    const queueDepths: Record<string, number> = {};
    for (const j of pendingJobs) {
      queueDepths[j.queue] = j._count.id;
    }

    return {
      queueDepths,
      totalAssets: assetStats._count.id,
      totalAssetBytes: (assetStats._sum.bytes ?? BigInt(0)).toString(),
      activeWatchers,
      errorWatchers,
      activeCompetitors,
      errorCompetitors,
      lastAccountSyncAt: lastAccountSync?.syncedAt?.toISOString() ?? null,
      lastPostSyncAt: lastPostSync?.syncedAt?.toISOString() ?? null,
    };
  }

  async getContentItemCost(contentItemId: string): Promise<{
    contentItemId: string;
    totalCalls: number;
    cacheHits: number;
    tokensIn: number;
    tokensOut: number;
    ttsSeconds: number;
    estimatedCostUsd: string;
    byTask: Array<{ task: string; calls: number; estimatedCostUsd: string }>;
  }> {
    const rows = await this.prisma.client.aiUsageLog.findMany({
      where: { contentItemId },
      select: { task: true, cacheHit: true, tokensIn: true, tokensOut: true, ttsSeconds: true, estimatedCostUsd: true },
    });

    let totalCalls = 0;
    let cacheHits = 0;
    let tokensIn = 0;
    let tokensOut = 0;
    let ttsSeconds = 0;
    let cost = 0;
    const byTaskMap = new Map<string, { calls: number; cost: number }>();

    for (const r of rows) {
      totalCalls += 1;
      if (r.cacheHit) cacheHits += 1;
      tokensIn += r.tokensIn ?? 0;
      tokensOut += r.tokensOut ?? 0;
      ttsSeconds += r.ttsSeconds ?? 0;
      cost += Number(r.estimatedCostUsd ?? 0);
      const t = byTaskMap.get(r.task) ?? { calls: 0, cost: 0 };
      t.calls += 1;
      t.cost += Number(r.estimatedCostUsd ?? 0);
      byTaskMap.set(r.task, t);
    }

    return {
      contentItemId,
      totalCalls,
      cacheHits,
      tokensIn,
      tokensOut,
      ttsSeconds,
      estimatedCostUsd: cost.toFixed(6),
      byTask: [...byTaskMap.entries()].map(([task, v]) => ({
        task,
        calls: v.calls,
        estimatedCostUsd: v.cost.toFixed(6),
      })),
    };
  }

  async getBestPostingHours(accountId: string, limit = 20): Promise<Array<{
    dayOfWeek: number;
    hour: number;
    score: number;
    sampleSize: number;
  }>> {
    const rows = await this.prisma.client.bestPostingHour.findMany({
      where: { accountId },
      orderBy: { score: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      dayOfWeek: r.dayOfWeek,
      hour: r.hour,
      score: r.score,
      sampleSize: r.sampleSize,
    }));
  }

  async triggerAccountSync(accountId: string): Promise<{ enqueued: true }> {
    await this.queue.enqueueAccountSync(accountId);
    return { enqueued: true };
  }

  async triggerPostSync(publishTargetId: string): Promise<{ enqueued: true }> {
    await this.queue.enqueuePostSync(publishTargetId);
    return { enqueued: true };
  }
}
