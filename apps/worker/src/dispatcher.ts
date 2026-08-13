/**
 * Scheduling dispatcher (docs/06 §3 Layer 2). Runs every minute: find publish
 * targets whose scheduledAt has arrived and enqueue a publish job for each, with
 * singletonKey = publishTargetId so a target can never be double-dispatched.
 *
 * Also reclaims legacy SCHEDULED targets that never passed publish Review
 * (AI “Schedule to publish” used to skip the gate).
 */
import type PgBoss from 'pg-boss';
import { QUEUE, isPublishReviewApproved } from '@scp/shared';
import { getPrisma } from './publish-support.js';
import type { PublishJob } from './publish-jobs.js';

/**
 * Pull SCHEDULED targets back into Review when the content never received a
 * publish-Review approval stamp. MANUAL / WORKER / DRAMA items that reached
 * SCHEDULED via Approve (pre-stamp era) are left alone — only REPURPOSED
 * packages and inconsistent METADATA_READY/RENDERED rows are reclaimed.
 */
export async function reclaimUnreviewedScheduledTargets(): Promise<number> {
  const prisma = getPrisma();
  const candidates = await prisma.publishTarget.findMany({
    where: {
      status: { in: ['SCHEDULED', 'PENDING'] },
      contentItem: {
        deletedAt: null,
        OR: [
          { status: 'METADATA_READY' },
          { status: 'RENDERED' },
          { status: 'SCHEDULED', type: 'REPURPOSED' },
          // SCHEDULED targets while content is still in Review — demote targets.
          { status: 'REVIEW_PENDING' },
        ],
      },
    },
    select: {
      id: true,
      status: true,
      contentItemId: true,
      contentItem: {
        select: { id: true, status: true, type: true, currentStep: true },
      },
    },
    take: 200,
  });

  const touchedContent = new Set<string>();
  let reclaimed = 0;

  for (const t of candidates) {
    const content = t.contentItem;
    if (isPublishReviewApproved(content.currentStep)) {
      // Approved for publish but target stuck PENDING while content moved on —
      // leave dispatcher / approve path to handle.
      if (content.status === 'REVIEW_PENDING' && t.status === 'SCHEDULED') {
        await prisma.publishTarget.update({
          where: { id: t.id },
          data: { status: 'PENDING' },
        });
        reclaimed += 1;
      }
      continue;
    }

    // REVIEW_PENDING + SCHEDULED target → always demote target (gate hold).
    if (content.status === 'REVIEW_PENDING') {
      if (t.status === 'SCHEDULED') {
        await prisma.publishTarget.update({
          where: { id: t.id },
          data: { status: 'PENDING' },
        });
        reclaimed += 1;
      }
      continue;
    }

    // REPURPOSED without stamp, or AI-ready status with live targets → Review.
    const needsReclaim =
      content.status === 'METADATA_READY' ||
      content.status === 'RENDERED' ||
      (content.type === 'REPURPOSED' && content.status === 'SCHEDULED');

    if (!needsReclaim) continue;
    if (touchedContent.has(content.id)) continue;
    touchedContent.add(content.id);

    await prisma.contentItem.update({
      where: { id: content.id },
      data: { status: 'REVIEW_PENDING', statusReason: null },
    });
    const result = await prisma.publishTarget.updateMany({
      where: {
        contentItemId: content.id,
        status: { in: ['SCHEDULED', 'PENDING'] },
      },
      data: { status: 'PENDING' },
    });
    reclaimed += result.count;
  }

  return reclaimed;
}

export async function dispatchDueTargets(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();

  await reclaimUnreviewedScheduledTargets();

  // Never auto-publish while the content item is still awaiting human Review
  // (PENDING targets are also excluded by status: SCHEDULED).
  // REPURPOSED packages also need the publishReviewApproved stamp.
  const due = await prisma.publishTarget.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledAt: { not: null, lte: new Date() },
      contentItem: {
        deletedAt: null,
        status: { notIn: ['REVIEW_PENDING', 'REJECTED', 'INGESTED'] },
      },
    },
    select: {
      id: true,
      contentItem: { select: { type: true, currentStep: true } },
    },
    take: 200,
  });

  let dispatched = 0;
  for (const t of due) {
    if (
      t.contentItem.type === 'REPURPOSED' &&
      !isPublishReviewApproved(t.contentItem.currentStep)
    ) {
      continue;
    }
    const data: PublishJob = { kind: 'publish', publishTargetId: t.id };
    await boss.send(QUEUE.PUBLISH, data, { singletonKey: t.id });
    dispatched += 1;
  }
  return dispatched;
}
