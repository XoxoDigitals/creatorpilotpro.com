/**
 * Shared helpers for the publish + verify processors (docs/06 §2, §4):
 * master-key loading, PostQued app-key decryption, per-account auth decryption,
 * adapter construction, metadata resolution, and incident/notification writes.
 *
 * Mirrors apps/worker/src/maintenance.ts for the encrypted-settings + notify
 * patterns so the two processors stay consistent.
 */
import { extname } from 'node:path';
import { getPrisma, type PrismaClient } from '@scp/db';
import { decryptSecret, loadMasterKey } from '@scp/shared';
import {
  FacebookAdapter,
  PostQuedAdapter,
  YouTubeAdapter,
  type LocalFile,
  type PublishAdapter,
  type PublishTarget as AdapterTarget,
  type PqHeaderStyle,
  type ResolvedMetadata,
} from '@scp/publish-adapters';

const POSTQUED_BASE_URL = process.env.POSTQUED_BASE_URL ?? 'https://api.postqued.com';

/** Load the AES master key from env, or null if unset (worker then no-ops). */
export function getMasterKey(): Buffer | null {
  const raw = process.env.MASTER_KEY;
  return raw ? loadMasterKey(raw) : null;
}

function getEnc(value: unknown): string | null {
  if (typeof value === 'object' && value && '__enc' in value) {
    const v = (value as { __enc?: unknown }).__enc;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

export interface PostquedAppConfig {
  apiKey: string;
  workspaceId?: string;
}

/** Read + decrypt the owner's PostQued API key (platform_apps.postqued), or null. */
export async function loadPostquedConfig(
  prisma: PrismaClient,
  masterKey: Buffer,
): Promise<PostquedAppConfig | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'platform_apps.postqued' } });
  const enc = getEnc(row?.value);
  if (!enc) return null;
  try {
    const cfg = JSON.parse(decryptSecret(enc, masterKey)) as {
      apiKey?: string;
      workspaceId?: string;
    };
    if (!cfg.apiKey) return null;
    return { apiKey: cfg.apiKey, workspaceId: cfg.workspaceId };
  } catch {
    return null;
  }
}

/** Decrypt a SocialAccount.authPayload envelope into a plain object (or {}). */
export function decryptAccountAuth(
  authPayload: string | null,
  masterKey: Buffer,
): Record<string, unknown> {
  if (!authPayload) return {};
  try {
    return JSON.parse(decryptSecret(authPayload, masterKey)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Cache the working PostQued header style per API key (avoids re-probing every job). */
const headerStyleCache = new Map<string, PqHeaderStyle>();

/**
 * Probe GET /v2/ping with each header style; cache and return the first that
 * authenticates. Defaults to 'bearer' if the probe is inconclusive — the real
 * publish call then surfaces any auth error through the retry matrix.
 */
export async function detectHeaderStyle(apiKey: string): Promise<PqHeaderStyle> {
  const cached = headerStyleCache.get(apiKey);
  if (cached) return cached;
  for (const style of ['bearer', 'x-api-key'] as PqHeaderStyle[]) {
    try {
      const res = await fetch(`${POSTQUED_BASE_URL}/v2/ping`, {
        method: 'GET',
        headers:
          style === 'bearer'
            ? { accept: 'application/json', Authorization: `Bearer ${apiKey}` }
            : { accept: 'application/json', 'x-api-key': apiKey },
      });
      if (res.ok) {
        headerStyleCache.set(apiKey, style);
        return style;
      }
    } catch {
      /* try the next style */
    }
  }
  return 'bearer';
}

export type AdapterPlatform = 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';

/**
 * Build the publish adapter for a platform. YouTube + TikTok publish via PostQued
 * (Owner decision, docs/06 §2); Facebook publishes Reels directly via Meta Graph.
 */
export function buildAdapter(
  platform: AdapterPlatform,
  postqued: { apiKey: string; headerStyle: PqHeaderStyle; workspaceId?: string } | null,
): PublishAdapter {
  if (platform === 'FACEBOOK') return new FacebookAdapter();
  if (!postqued) {
    throw new Error(
      'PostQued API key is not configured; cannot publish YouTube/TikTok. Add it in Settings → Platform Apps.',
    );
  }
  const config = {
    baseUrl: POSTQUED_BASE_URL,
    apiKey: postqued.apiKey,
    headerStyle: postqued.headerStyle,
    ...(postqued.workspaceId ? { workspaceId: postqued.workspaceId } : {}),
  };
  return platform === 'YOUTUBE' ? new YouTubeAdapter(config) : new PostQuedAdapter(config);
}

/** Map the decrypted account auth into the shape the chosen adapter expects. */
export function adapterAuth(
  platform: AdapterPlatform,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  if (platform === 'FACEBOOK') {
    return {
      pageId: raw.pageId ?? raw.externalId,
      pageAccessToken: raw.pageAccessToken ?? raw.accessToken,
    };
  }
  return {
    postquedAccountId: raw.postquedAccountId ?? raw.pqAccountId,
    workspaceId: raw.workspaceId,
  };
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.m4v': 'video/x-m4v',
};

export function mimeFromPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

interface AssetLike {
  localPath: string | null;
  bytes: bigint | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/** Project an Asset row into the adapter LocalFile shape. */
export function buildLocalFile(asset: AssetLike): LocalFile {
  if (!asset.localPath) throw new Error('Asset has no local path for upload.');
  return {
    path: asset.localPath,
    bytes: asset.bytes ? Number(asset.bytes) : 0,
    mimeType: mimeFromPath(asset.localPath),
    ...(asset.durationSec != null ? { durationSec: asset.durationSec } : {}),
    ...(asset.width != null ? { width: asset.width } : {}),
    ...(asset.height != null ? { height: asset.height } : {}),
  };
}

interface ProfileLike {
  titleTemplate: string;
  descriptionTemplate: string;
  defaultTags: string[];
  aiLabelDefault: boolean;
}

/**
 * Resolve final per-target metadata: target.metadataOverride wins, else the
 * account's ChannelProfile templates, else the content item's title (docs/06 §5).
 */
export function resolveMetadata(
  override: Record<string, unknown>,
  profile: ProfileLike | null,
  contentTitle: string,
): ResolvedMetadata {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const title =
    str(override.title) ?? str(profile?.titleTemplate) ?? contentTitle;
  const description =
    str(override.description) ?? str(profile?.descriptionTemplate) ?? '';
  const tags = Array.isArray(override.tags)
    ? (override.tags as string[])
    : (profile?.defaultTags ?? []);
  const visibility = (str(override.visibility) as ResolvedMetadata['visibility']) ?? 'PUBLIC';
  const aiLabel =
    typeof override.aiLabel === 'boolean' ? override.aiLabel : (profile?.aiLabelDefault ?? true);
  return {
    title,
    description,
    tags,
    visibility,
    aiLabel,
    ...(str(override.category) ? { category: str(override.category) } : {}),
  };
}

/** Build an adapter-facing target projection from Prisma rows. */
export function toAdapterTarget(
  targetId: string,
  contentItemId: string,
  accountExternalId: string,
  platform: AdapterPlatform,
  auth: Record<string, unknown>,
  scheduledAt: Date | null,
): AdapterTarget {
  return { id: targetId, contentItemId, accountId: accountExternalId, platform, auth, scheduledAt };
}

/** Notify all active Owners/Admins in-app (matches maintenance.ts notifyBroken). */
export async function notifyOwnersAdmins(
  prisma: PrismaClient,
  type: string,
  payload: object,
  incidentId?: string,
): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (recipients.length === 0) return;
  await prisma.notification.createMany({
    data: recipients.map((u) => ({
      userId: u.id,
      type,
      payload,
      channels: ['INAPP'] as const,
      ...(incidentId ? { incidentId } : {}),
    })),
  });
}

export interface IncidentInput {
  kind: 'COPYRIGHT' | 'AUTH' | 'RATE_LIMIT' | 'PLATFORM_REJECT' | 'STORAGE' | 'SYSTEM';
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
  accountId?: string | null;
  contentItemId?: string | null;
  publishTargetId?: string | null;
  title: string;
  detail?: object;
}

/** Create an incident + notify Owners/Admins (docs/06 §4 failure protocol). */
export async function raiseIncident(prisma: PrismaClient, input: IncidentInput): Promise<string> {
  const incident = await prisma.incident.create({
    data: {
      kind: input.kind,
      severity: input.severity ?? 'MEDIUM',
      accountId: input.accountId ?? null,
      contentItemId: input.contentItemId ?? null,
      publishTargetId: input.publishTargetId ?? null,
      title: input.title,
      detail: (input.detail ?? {}) as object,
    },
  });
  await notifyOwnersAdmins(
    prisma,
    `incident.${input.kind.toLowerCase()}`,
    { title: input.title, incidentId: incident.id, ...input.detail },
    incident.id,
  );
  return incident.id;
}

export { getPrisma };
export type { PrismaClient };
