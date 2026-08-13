/**
 * Shared helpers for the publish + verify processors (docs/06 §2, §4):
 * master-key loading, per-account auth decryption, adapter construction,
 * metadata resolution, and incident/notification writes.
 *
 * As of Phase 9 all adapters talk to the platforms directly:
 *   YouTube  → Google YouTube Data API v3 (per-channel OAuth token)
 *   Facebook → Meta Graph vLatest (page access token)
 *   TikTok   → native adapter is stubbed until the Content Posting API is wired
 */
import { extname } from 'node:path';
import { getPrisma, type PrismaClient } from '@scp/db';
import { decryptSecret, loadMasterKey } from '@scp/shared/crypto';
import {
  FacebookAdapter,
  ManualAdapter,
  TikTokAdapter,
  YouTubeAdapter,
  type LocalFile,
  type PublishAdapter,
  type PublishTarget as AdapterTarget,
  type ResolvedMetadata,
} from '@scp/publish-adapters';

/** Load the AES master key from env, or null if unset (worker then no-ops). */
export function getMasterKey(): Buffer | null {
  const raw = process.env.MASTER_KEY;
  return raw ? loadMasterKey(raw) : null;
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

export type AdapterPlatform = 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';
export type AdapterConnectionMethod = 'OWN_APP' | 'MANUAL' | 'POSTQUED';

/**
 * Build the publish adapter for a platform + connection method. MANUAL accounts
 * short-circuit publishing so the Owner can download the file and upload it by
 * hand; every other method routes to the platform-native adapter.
 */
export function buildAdapter(
  platform: AdapterPlatform,
  connectionMethod: AdapterConnectionMethod = 'OWN_APP',
): PublishAdapter {
  if (connectionMethod === 'MANUAL') return new ManualAdapter(platform);
  if (platform === 'FACEBOOK') return new FacebookAdapter();
  if (platform === 'YOUTUBE') return new YouTubeAdapter();
  return new TikTokAdapter();
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
  if (platform === 'YOUTUBE') {
    return { accessToken: raw.accessToken };
  }
  // TikTok — native Content Posting API (Phase 9.6). accessToken from OAuth.
  return { accessToken: raw.accessToken };
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
 * Resolve final per-target metadata (docs/06 §5):
 *   1. target.metadataOverride
 *   2. AI `currentStep.metadata` (title / description / tags / category)
 *   3. ChannelProfile templates / defaultTags
 *   4. content item title
 */
export function resolveMetadata(
  override: Record<string, unknown>,
  profile: ProfileLike | null,
  contentTitle: string,
  aiMetadata?: Record<string, unknown> | null,
): ResolvedMetadata {
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
  const ai = aiMetadata ?? {};
  const aiTags = Array.isArray(ai.tags)
    ? (ai.tags as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  const title =
    str(override.title) ?? str(ai.title) ?? str(profile?.titleTemplate) ?? contentTitle;
  const description =
    str(override.description) ??
    str(ai.description) ??
    str(profile?.descriptionTemplate) ??
    '';
  const tags = Array.isArray(override.tags)
    ? (override.tags as string[])
    : aiTags.length > 0
      ? aiTags
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
    ...(str(override.category) ?? str(ai.category)
      ? { category: str(override.category) ?? str(ai.category) }
      : {}),
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
