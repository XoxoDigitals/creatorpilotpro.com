/**
 * Verify job processor (docs/06 §4 step 4): re-check a published post at +15m
 * and +24h. A BLOCK issue (copyright / rejection / processing failure) triggers
 * the failure protocol — target → DRAFT, incident, notify, auto-hold siblings.
 */
import { FacebookAdapter } from '@scp/publish-adapters';
import {
  adapterAuth,
  buildAdapter,
  decryptAccountAuth,
  detectHeaderStyle,
  getMasterKey,
  getPrisma,
  loadPostquedConfig,
  raiseIncident,
  type AdapterPlatform,
} from './publish-support.js';
import type { VerifyJob } from './publish-jobs.js';

const COPYRIGHT_RE = /copyright|claim|takedown/i;

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

  let postqued = null as { apiKey: string; headerStyle: 'bearer' | 'x-api-key'; workspaceId?: string } | null;
  if (platform !== 'FACEBOOK') {
    const cfg = await loadPostquedConfig(prisma, masterKey);
    if (!cfg) return; // can't verify without the key; leave as-is for the next pass.
    postqued = { apiKey: cfg.apiKey, headerStyle: await detectHeaderStyle(cfg.apiKey), workspaceId: cfg.workspaceId };
  }

  const adapter = buildAdapter(platform, postqued);

  // Facebook's verify() needs the page token re-seeded in this fresh process.
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
  }

  const { live, issues } = await adapter.verify(job.platformPostId);
  const blocking = issues.filter((i) => i.severity === 'BLOCK');

  if (blocking.length > 0) {
    // Failure protocol: roll the target back to DRAFT + raise an incident.
    await prisma.publishTarget.update({ where: { id: target.id }, data: { status: 'DRAFT' } });
    const isCopyright = blocking.some((i) => COPYRIGHT_RE.test(i.code) || COPYRIGHT_RE.test(i.message));
    await raiseIncident(prisma, {
      kind: isCopyright ? 'COPYRIGHT' : 'PLATFORM_REJECT',
      severity: 'HIGH',
      accountId: account.id,
      contentItemId: target.contentItemId,
      publishTargetId: target.id,
      title: `${isCopyright ? 'Copyright issue' : 'Platform issue'} on ${account.name} (${job.phase})`,
      detail: { platformPostId: job.platformPostId, issues: blocking },
    });

    // Auto-hold siblings still scheduled (docs/06 §5, default ON).
    await prisma.publishTarget.updateMany({
      where: { contentItemId: target.contentItemId, status: 'SCHEDULED', id: { not: target.id } },
      data: { status: 'DRAFT' },
    });
    return;
  }

  // Clean & live → nothing to do here; metric syncing begins in Phase 2.
  if (!live) {
    // Still processing at this pass; the later pass (or a retry) re-checks.
    return;
  }
}
