/**
 * Verify job processor (docs/06 §4 step 4): re-check a published post at +15m
 * and +24h. A BLOCK issue (copyright / rejection / processing failure) triggers
 * the failure protocol — target → DRAFT, incident, notify, auto-hold siblings.
 */
import { Prisma } from '@scp/db';
import { FacebookAdapter, TikTokAdapter, YouTubeAdapter } from '@scp/publish-adapters';
import {
  adapterAuth,
  buildAdapter,
  decryptAccountAuth,
  getMasterKey,
  getPrisma,
  raiseIncident,
  type AdapterPlatform,
} from './publish-support.js';
import type { VerifyJob } from './publish-jobs.js';

const COPYRIGHT_RE =
  /copyright|claim|takedown|rights.?manager|infring|dmca|muted|matched.?third.?party|content.?id/i;

/** Auto-pause the account after this many copyright strikes (docs/10 backlog #8). */
const STRIKE_PAUSE_THRESHOLD = 3;

export async function runVerify(job: VerifyJob): Promise<void> {
  const prisma = getPrisma();
  const masterKey = getMasterKey();
  if (!masterKey) throw new Error('MASTER_KEY is required to verify.');

  const target = await prisma.publishTarget.findUnique({
    where: { id: job.publishTargetId },
    include: { account: true },
  });
  if (!target || target.status !== 'PUBLISHED') return; // already handled/rolled back.

  const { account } = target;
  const platform = account.platform as AdapterPlatform;

  // Manual accounts don't publish externally, so nothing to verify against.
  if (account.connectionMethod === 'MANUAL') return;

  const adapter = buildAdapter(
    platform,
    (account.connectionMethod ?? 'OWN_APP') as 'OWN_APP' | 'MANUAL' | 'POSTQUED',
  );

  // Re-seed per-adapter auth in this fresh worker process so verify() authenticates.
  if (adapter instanceof FacebookAdapter) {
    const auth = adapterAuth('FACEBOOK', decryptAccountAuth(account.authPayload, masterKey)) as {
      pageId?: string;
      pageAccessToken?: string;
    };
    if (auth.pageId && auth.pageAccessToken) {
      adapter.primeVerifyAuth(job.platformPostId, {
        pageId: auth.pageId,
        pageAccessToken: auth.pageAccessToken,
      });
    }
  } else if (adapter instanceof YouTubeAdapter) {
    const auth = adapterAuth('YOUTUBE', decryptAccountAuth(account.authPayload, masterKey)) as {
      accessToken?: string;
    };
    if (auth.accessToken) {
      adapter.primeVerifyAuth(job.platformPostId, { accessToken: auth.accessToken });
    }
  } else if (adapter instanceof TikTokAdapter) {
    const auth = adapterAuth('TIKTOK', decryptAccountAuth(account.authPayload, masterKey)) as {
      accessToken?: string;
    };
    if (auth.accessToken) {
      adapter.primeVerifyAuth(job.platformPostId, { accessToken: auth.accessToken });
    }
  }

  const { live, issues } = await adapter.verify(job.platformPostId);
  const blocking = issues.filter((i) => i.severity === 'BLOCK');

  if (blocking.length > 0) {
    // Failure protocol: roll the target back to DRAFT + raise an incident.
    const summary = blocking.map((b) => b.message).join('; ');
    const isDeleted = blocking.some((i) => i.code === 'video-deleted' || i.code === 'not-found');
    const isCopyright =
      !isDeleted &&
      blocking.some((i) => COPYRIGHT_RE.test(i.code) || COPYRIGHT_RE.test(i.message));
    await prisma.publishTarget.update({
      where: { id: target.id },
      data: {
        status: 'DRAFT',
        lastError: {
          message: summary,
          platformPostId: job.platformPostId,
          issues: blocking.map((i) => ({
            code: i.code,
            message: i.message,
            severity: i.severity,
          })),
          detectedAt: new Date().toISOString(),
          reason: isDeleted ? 'removed_from_platform' : isCopyright ? 'copyright' : 'platform_reject',
        } as Prisma.InputJsonValue,
      },
    });
    await raiseIncident(prisma, {
      kind: isCopyright ? 'COPYRIGHT' : 'PLATFORM_REJECT',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: target.contentItemId,
      publishTargetId: target.id,
      title: isDeleted
        ? `Video removed from ${account.name} (${job.phase})`
        : `${isCopyright ? 'Copyright issue' : 'Platform issue'} on ${account.name} (${job.phase})`,
      detail: { platformPostId: job.platformPostId, issues: blocking },
    });

    // Auto-hold siblings still scheduled (docs/06 §5, default ON).
    await prisma.publishTarget.updateMany({
      where: { contentItemId: target.contentItemId, status: 'SCHEDULED', id: { not: target.id } },
      data: { status: 'DRAFT' },
    });

    // Strike counter + auto-pause (docs/10 backlog #8). Only copyright issues
    // count toward the strike total; platform rejections don't threaten the
    // channel's standing the same way.
    if (isCopyright) {
      const updated = await prisma.socialAccount.update({
        where: { id: account.id },
        data: { copyrightStrikeCount: { increment: 1 } },
        select: { copyrightStrikeCount: true, paused: true },
      });
      if (updated.copyrightStrikeCount >= STRIKE_PAUSE_THRESHOLD && !updated.paused) {
        await prisma.socialAccount.update({
          where: { id: account.id },
          data: {
            paused: true,
            pausedReason: `Auto-paused: ${updated.copyrightStrikeCount} copyright strikes`,
          },
        });
        await raiseIncident(prisma, {
          kind: 'COPYRIGHT',
          severity: 'HIGH',
          accountId: account.id,
          title: `Account auto-paused after ${updated.copyrightStrikeCount} copyright strikes`,
          detail: { strikeCount: updated.copyrightStrikeCount, threshold: STRIKE_PAUSE_THRESHOLD },
        });
      }
    }
    return;
  }

  // Clean & live → nothing to do here; metric syncing begins in Phase 2.
  if (!live) {
    // Still processing at this pass; the later pass (or a retry) re-checks.
    return;
  }
}
