import type { Asset } from '@scp/db';

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
  createdAt: string;
}

export function toAssetView(a: Asset): AssetView {
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
    createdAt: a.createdAt.toISOString(),
  };
}
