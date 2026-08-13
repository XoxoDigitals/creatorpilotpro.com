/**
 * Analytics sync processors (docs/07, Phase 5). Four functions that pull
 * metrics into snapshot tables. External API calls gracefully degrade when
 * credentials are absent — log + skip, never crash.
 */
import type PgBoss from 'pg-boss';
import { getPrisma, raiseIncident } from './publish-support.js';

// ── 1. Account metrics sync ────────────────────────────────────────────────

export async function runAccountSync(accountId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const account = await prisma.socialAccount.findFirst({
    where: { id: accountId, deletedAt: null },
  });
  if (!account || account.paused) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Platform API calls require credentials we may not have yet.
  // Graceful degradation: log and return, don't crash.
  if (!account.authPayload) {
    console.log(`[analytics:account-sync] account ${accountId} has no auth — skipping`);
    return;
  }

  // TODO: Call platform-specific analytics APIs (YouTube Analytics, TikTok, Facebook Insights).
  // For now, upsert a zero-value snapshot so the pipeline is wired end-to-end.
  // Real API calls will be added when platform adapters gain analytics methods.
  const metrics = {
    followers: 0,
    views: 0,
    watchTimeMin: 0,
    impressions: 0,
    ctr: 0,
    revenue: 0,
    rpm: 0,
    engagements: 0,
  };

  try {
    await prisma.metricSnapshotAccount.upsert({
      where: { accountId_date: { accountId, date: today } },
      create: {
        accountId,
        date: today,
        ...metrics,
        syncedAt: new Date(),
      },
      update: {
        ...metrics,
        syncedAt: new Date(),
      },
    });
    console.log(`[analytics:account-sync] synced account ${accountId} for ${today.toISOString().slice(0, 10)}`);
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
    include: { account: { select: { id: true, authPayload: true, platform: true, paused: true, deletedAt: true } } },
  });
  if (!target || target.status !== 'PUBLISHED') return;
  if (!target.account || target.account.deletedAt || target.account.paused) return;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (!target.account.authPayload) {
    console.log(`[analytics:post-sync] account ${target.accountId} has no auth — skipping`);
    return;
  }

  // TODO: Call platform-specific per-video analytics APIs.
  // Stub upserts zero-value snapshot to wire pipeline end-to-end.
  const metrics = {
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    watchTimeMin: 0,
    impressions: 0,
    ctr: 0,
    retentionCurve: [],
  };

  try {
    await prisma.metricSnapshotPost.upsert({
      where: { publishTargetId_date: { publishTargetId, date: today } },
      create: {
        publishTargetId,
        accountId: target.accountId,
        date: today,
        ...metrics,
        syncedAt: new Date(),
      },
      update: {
        ...metrics,
        syncedAt: new Date(),
      },
    });
    console.log(`[analytics:post-sync] synced target ${publishTargetId} for ${today.toISOString().slice(0, 10)}`);
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
