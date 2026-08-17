import type { Asset } from '@scp/db';
import { assetHasMedia, isDriveEmbedReady, localPurgeAt, resolveAssetEmbedUrl } from '@scp/storage';

/** Public view of a stored media asset (docs/03 Domain 4). No absolute paths leaked. */
export interface AssetView {
  id: string;
  contentItemId: string;
  kind: Asset['kind'];
  bytes: number | null;
  md5: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  storageState: Asset['storageState'];
  /** Google Drive file id when archived to the library. */
  driveFileId: string | null;
  /**
   * Drive preview iframe URL when Drive embed is ready (≥12h after upload),
   * or immediately when there is no local copy to stream.
   */
  embedUrl: string | null;
  /** True when local exists and Drive upload is still inside the 12h processing window. */
  driveEmbedPending: boolean;
  /** True when localPath and/or driveFileId is present. */
  hasMedia: boolean;
  createdAt: string;
}

/**
 * Ops view of a hot-tier video still on disk (Workers → local media).
 * Absolute paths are not exposed.
 */
export interface LocalAssetView {
  id: string;
  contentItemId: string;
  title: string;
  kind: Asset['kind'];
  accountId: string | null;
  accountName: string | null;
  bytes: number | null;
  storageState: Asset['storageState'];
  /** Drive upload time when dual-stored; null for local-only. */
  driveUploadedAt: string | null;
  /**
   * When dual-store: driveUploadedAt + 12h (embed-ready / local purge clock).
   * Null when local-only (no automatic purge).
   */
  localDeleteAt: string | null;
  /** True when Drive copy exists so local can be safely deleted. */
  canDeleteLocal: boolean;
  /** True when localPath is set but the file is missing on disk. */
  fileMissing: boolean;
  /** Open/acked STORAGE (and media-availability) incidents for this content item. */
  relatedIncidentIds: string[];
  createdAt: string;
}

export function toAssetView(a: Asset): AssetView {
  const driveFileId = a.driveFileId ?? null;
  const driveUploadedAt = a.driveUploadedAt ?? null;
  const embedUrl = resolveAssetEmbedUrl({
    driveFileId,
    driveUploadedAt,
    localPath: a.localPath,
  });
  return {
    id: a.id,
    contentItemId: a.contentItemId,
    kind: a.kind,
    bytes: a.bytes != null ? Number(a.bytes) : null,
    md5: a.md5,
    durationSec: a.durationSec,
    width: a.width,
    height: a.height,
    storageState: a.storageState,
    driveFileId,
    embedUrl,
    driveEmbedPending: Boolean(
      driveFileId && a.localPath && !isDriveEmbedReady(driveUploadedAt),
    ),
    hasMedia: assetHasMedia(a),
    createdAt: a.createdAt.toISOString(),
  };
}

/** Compute ISO local-delete timestamp from Drive upload (or null if none). */
export function toLocalDeleteAtIso(
  driveUploadedAt: Date | string | null | undefined,
): string | null {
  const at = localPurgeAt(driveUploadedAt);
  return at ? at.toISOString() : null;
}
