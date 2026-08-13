import type { Asset } from '@scp/db';
import { assetHasMedia, drivePreviewEmbedUrl } from '@scp/storage';

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
  /** Drive preview iframe URL when driveFileId is set. */
  embedUrl: string | null;
  /** True when localPath and/or driveFileId is present. */
  hasMedia: boolean;
  createdAt: string;
}

export function toAssetView(a: Asset): AssetView {
  const driveFileId = a.driveFileId ?? null;
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
    embedUrl: driveFileId ? drivePreviewEmbedUrl(driveFileId) : null,
    hasMedia: assetHasMedia(a),
    createdAt: a.createdAt.toISOString(),
  };
}
