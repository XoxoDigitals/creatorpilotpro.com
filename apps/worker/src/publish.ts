/**
 * Publish job processor (docs/06 §4 lifecycle):
 * preflight → adapter.publish() → record attempt → on success schedule verify
 * jobs; on failure classify (auth / retryable / terminal) per the error matrix.
 */
import type PgBoss from 'pg-boss';
import { TieredStorage } from '@scp/storage';
import { validateMetadata } from '@scp/publish-adapters';
import { QUEUE, isPublishReviewApproved } from '@scp/shared';
import {
  adapterAuth,
  buildAdapter,
  buildLocalFile,
  decryptAccountAuth,
  getMasterKey,
  getPrisma,
  notifyOwnersAdmins,
  raiseIncident,
  resolveMetadata,
  toAdapterTarget,
  type AdapterPlatform,
} from './publish-support.js';
import { ensureLocalFinalAsset } from './gdrive-archive.js';
import { VERIFY_DELAYS_SEC, type VerifyJob, type VerifyPhase } from './publish-jobs.js';

/** Max publish attempts before a retryable error becomes terminal (docs/06 §4). */
export const PUBLISH_RETRY_LIMIT = 5;

const storage = new TieredStorage();

type ErrClass = 'AUTH' | 'RETRYABLE' | 'TERMINAL';

function classifyError(err: unknown): { cls: ErrClass; code: string } {
  const e = err as { retryable?: boolean; status?: number; message?: string; code?: string };
  const msg = e.message ?? String(err);
  const status = e.status;
  const code = e.code ?? (status ? `http_${status}` : 'error');
  if (status === 401 || status === 403 || /unauthor|invalid.?token|token.*expir|invalid_grant/i.test(msg)) {
    return { cls: 'AUTH', code };
  }
  if (
    e.retryable === true ||
    status === 0 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500) ||
    /network|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed/i.test(msg)
  ) {
    return { cls: 'RETRYABLE', code };
  }
  return { cls: 'TERMINAL', code };
}

function errorPayload(err: unknown): object {
  const e = err as { message?: string; status?: number; code?: string; body?: unknown };
  return {
    message: e.message ?? String(err),
    ...(e.status !== undefined ? { status: e.status } : {}),
    ...(e.code !== undefined ? { code: e.code } : {}),
    ...(e.body !== undefined ? { body: e.body } : {}),
  };
}

/**
 * Run a single publish target end-to-end. `retryCount` is pg-boss's current
 * retry index; on the last allowed attempt a retryable error is finalized.
 */
export async function runPublish(
  publishTargetId: string,
  boss: PgBoss,
  retryCount = 0,
): Promise<void> {
  const prisma = getPrisma();
  const masterKey = getMasterKey();
  if (!masterKey) throw new Error('MASTER_KEY is required to publish.');

  const target = await prisma.publishTarget.findUnique({
    where: { id: publishTargetId },
    include: {
      account: { include: { profile: true } },
      contentItem: { include: { assets: true } },
    },
  });
  if (!target) return; // deleted between enqueue and run — nothing to do.
  if (!['PENDING', 'SCHEDULED', 'PUBLISHING'].includes(target.status)) return; // already terminal.

  const { account, contentItem } = target;

  // Defense in depth: never publish while held in Review or without publish approval.
  if (target.status === 'PENDING') return;
  if (
    contentItem.status === 'REVIEW_PENDING' ||
    contentItem.status === 'REJECTED' ||
    contentItem.status === 'INGESTED'
  ) {
    if (target.status === 'SCHEDULED' || target.status === 'PUBLISHING') {
      await prisma.publishTarget.update({
        where: { id: target.id },
        data: { status: 'PENDING' },
      });
    }
    return;
  }
  if (contentItem.type === 'REPURPOSED' && !isPublishReviewApproved(contentItem.currentStep)) {
    await prisma.contentItem.update({
      where: { id: contentItem.id },
      data: { status: 'REVIEW_PENDING', statusReason: null },
    });
    await prisma.publishTarget.updateMany({
      where: {
        contentItemId: contentItem.id,
        status: { in: ['SCHEDULED', 'PUBLISHING', 'PENDING'] },
      },
      data: { status: 'PENDING' },
    });
    return;
  }

  const platform = account.platform as AdapterPlatform;

  // Mark in-flight (idempotent; singletonKey prevents concurrent dispatch).
  await prisma.publishTarget.update({ where: { id: target.id }, data: { status: 'PUBLISHING' } });

  const attemptNo = (await prisma.publishAttempt.count({ where: { publishTargetId: target.id } })) + 1;
  const attempt = await prisma.publishAttempt.create({
    data: { publishTargetId: target.id, attemptNo },
  });

  const fail = async (
    outcome: 'RETRYABLE_ERROR' | 'TERMINAL_ERROR',
    code: string,
    err: unknown,
  ): Promise<void> => {
    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: { finishedAt: new Date(), outcome, errorCode: code, errorPayload: errorPayload(err) },
    });
    await prisma.publishTarget.update({
      where: { id: target.id },
      data: { lastError: errorPayload(err) },
    });
  };

  const toDraft = async (): Promise<void> => {
    await prisma.publishTarget.update({ where: { id: target.id }, data: { status: 'DRAFT' } });
  };

  // ── Preflight ───────────────────────────────────────────────────────────
  // Account health (docs/06 §4: unhealthy → instant DRAFT + AUTH incident).
  if (account.connectionStatus === 'BROKEN' || account.paused) {
    await fail('TERMINAL_ERROR', 'account_unhealthy', new Error('Account is broken or paused.'));
    await toDraft();
    await raiseIncident(prisma, {
      kind: 'AUTH',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: contentItem.id,
      publishTargetId: target.id,
      title: `Cannot publish to ${account.name}: account not healthy`,
      detail: { connectionStatus: account.connectionStatus, paused: account.paused },
    });
    return;
  }

  // Pick the publishable asset (FINAL, else ORIGINAL for manual uploads).
  // Platforms always need a local file — restore from Drive when needed.
  const asset =
    contentItem.assets.find((a) => a.kind === 'FINAL') ??
    contentItem.assets.find((a) => a.kind === 'ORIGINAL');
  if (!asset || (!asset.localPath && !asset.driveFileId)) {
    await fail('TERMINAL_ERROR', 'no_asset', new Error('No FINAL/ORIGINAL asset with media.'));
    await toDraft();
    await raiseIncident(prisma, {
      kind: 'STORAGE',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: contentItem.id,
      publishTargetId: target.id,
      title: `No media file to publish for “${contentItem.title}”`,
    });
    return;
  }

  let localAsset = asset;
  try {
    const ensured = await ensureLocalFinalAsset({
      id: asset.id,
      contentItemId: contentItem.id,
      localPath: asset.localPath,
      driveFileId: asset.driveFileId,
      md5: asset.md5,
      bytes: asset.bytes,
    });
    localAsset = { ...asset, localPath: ensured.localPath, md5: ensured.md5, bytes: BigInt(ensured.bytes) };
  } catch (err) {
    await fail('TERMINAL_ERROR', 'restore_failed', err);
    await toDraft();
    await raiseIncident(prisma, {
      kind: 'STORAGE',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: contentItem.id,
      publishTargetId: target.id,
      title: `Media for “${contentItem.title}” is not available locally`,
      detail: errorPayload(err),
    });
    return;
  }

  // Ensure a local copy exists (restore is a no-op fast path for LOCAL/BOTH).
  try {
    await storage.restore(
      {
        localPath: localAsset.localPath ?? undefined,
        md5: localAsset.md5 ?? '',
        bytes: localAsset.bytes ? Number(localAsset.bytes) : 0,
        state: localAsset.storageState,
        driveFileId: localAsset.driveFileId ?? undefined,
      },
      localAsset.localPath!,
    );
  } catch (err) {
    await fail('TERMINAL_ERROR', 'restore_failed', err);
    await toDraft();
    await raiseIncident(prisma, {
      kind: 'STORAGE',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: contentItem.id,
      publishTargetId: target.id,
      title: `Media for “${contentItem.title}” is not available locally`,
      detail: errorPayload(err),
    });
    return;
  }

  const localFile = buildLocalFile(localAsset);
  const override = (target.metadataOverride ?? {}) as Record<string, unknown>;
  const step = (contentItem.currentStep ?? {}) as Record<string, unknown>;
  const aiMeta =
    step.metadata && typeof step.metadata === 'object' && !Array.isArray(step.metadata)
      ? (step.metadata as Record<string, unknown>)
      : null;
  const meta = resolveMetadata(override, account.profile, contentItem.title, aiMeta);

  // Build the adapter (its constraints drive fail-fast metadata validation).
  // MANUAL accounts short-circuit — the adapter marks the target published so
  // the Owner can download the final asset and upload it by hand.
  const adapter = buildAdapter(
    platform,
    (account.connectionMethod ?? 'OWN_APP') as 'OWN_APP' | 'MANUAL' | 'POSTQUED',
  );

  const blocking = validateMetadata(meta, localFile, adapter.getConstraints()).filter(
    (i) => i.severity === 'BLOCK',
  );
  if (blocking.length > 0) {
    await fail('TERMINAL_ERROR', 'metadata_invalid', new Error(blocking.map((b) => b.message).join('; ')));
    await toDraft();
    await raiseIncident(prisma, {
      kind: 'PLATFORM_REJECT',
      severity: 'MEDIUM',
      accountId: account.id,
      contentItemId: contentItem.id,
      publishTargetId: target.id,
      title: `Metadata rejected for “${contentItem.title}” on ${account.name}`,
      detail: { issues: blocking },
    });
    return;
  }

  const rawAuth = decryptAccountAuth(account.authPayload, masterKey);
  const adapterTarget = toAdapterTarget(
    target.id,
    contentItem.id,
    account.externalId,
    platform,
    adapterAuth(platform, rawAuth),
    target.scheduledAt,
  );

  // ── Publish ──────────────────────────────────────────────────────────────
  try {
    const { platformPostId } = await adapter.publish(adapterTarget, localFile, meta);

    await prisma.publishAttempt.update({
      where: { id: attempt.id },
      data: { finishedAt: new Date(), outcome: 'SUCCESS' },
    });

    // MANUAL accounts stay in PUBLISHING (awaiting the Owner to download the
    // rendered file, upload it to the platform, and click Mark published in
    // the UI — that call flips the target to PUBLISHED). No verify jobs.
    if (account.connectionMethod === 'MANUAL') {
      await prisma.publishTarget.update({
        where: { id: target.id },
        data: { status: 'PUBLISHING', platformPostId, lastError: undefined },
      });
      return;
    }

    await prisma.publishTarget.update({
      where: { id: target.id },
      data: { status: 'PUBLISHED', platformPostId, publishedAt: new Date(), lastError: undefined },
    });
    await maybeMarkContentPublished(prisma, contentItem.id);

    // Schedule the two post-publish verify passes (docs/06 §4 step 3).
    for (const phase of ['T+15m', 'T+24h'] as VerifyPhase[]) {
      const data: VerifyJob = { kind: 'verify', publishTargetId: target.id, platformPostId, phase };
      await boss.send(QUEUE.PUBLISH, data, { startAfter: VERIFY_DELAYS_SEC[phase] });
    }
    return;
  } catch (err) {
    const { cls, code } = classifyError(err);

    if (cls === 'AUTH') {
      await fail('TERMINAL_ERROR', code, err);
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { connectionStatus: 'BROKEN', paused: true },
      });
      await toDraft();
      await raiseIncident(prisma, {
        kind: 'AUTH',
        severity: 'HIGH',
        accountId: account.id,
        contentItemId: contentItem.id,
        publishTargetId: target.id,
        title: `Authentication failed for ${account.name} — reconnect required`,
        detail: errorPayload(err),
      });
      return;
    }

    if (cls === 'RETRYABLE' && retryCount + 1 < PUBLISH_RETRY_LIMIT) {
      await fail('RETRYABLE_ERROR', code, err);
      // Reset to SCHEDULED so a re-dispatch is coherent, then re-throw for pg-boss retry.
      await prisma.publishTarget.update({ where: { id: target.id }, data: { status: 'SCHEDULED' } });
      throw err;
    }

    // Terminal, or retryable budget exhausted → FAILED/DRAFT + incident.
    await fail('TERMINAL_ERROR', code, err);
    await prisma.publishTarget.update({
      where: { id: target.id },
      data: { status: cls === 'RETRYABLE' ? 'FAILED' : 'DRAFT' },
    });
    await raiseIncident(prisma, {
      kind: cls === 'RETRYABLE' ? 'RATE_LIMIT' : 'PLATFORM_REJECT',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: contentItem.id,
      publishTargetId: target.id,
      title: `Publish failed for “${contentItem.title}” on ${account.name}`,
      detail: errorPayload(err),
    });
    await notifyOwnersAdmins(prisma, 'publish.failed', {
      title: `Publish failed on ${account.name}`,
      publishTargetId: target.id,
    });
  }
}

/** Flip the content item to PUBLISHED once every target has reached a terminal state. */
async function maybeMarkContentPublished(
  prisma: ReturnType<typeof getPrisma>,
  contentItemId: string,
): Promise<void> {
  const targets = await prisma.publishTarget.findMany({
    where: { contentItemId },
    select: { status: true },
  });
  const terminal = new Set(['PUBLISHED', 'FAILED', 'DRAFT']);
  const allTerminal = targets.every((t) => terminal.has(t.status));
  const anyPublished = targets.some((t) => t.status === 'PUBLISHED');
  if (allTerminal && anyPublished) {
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'PUBLISHED' },
    });
  }
}
