/** Where a stored object currently lives (docs/03 assets.storageState). */
export type StorageState = 'LOCAL' | 'UPLOADING' | 'DRIVE' | 'BOTH' | 'EVICTED';

export interface StoredObject {
  localPath?: string;
  driveFileId?: string;
  md5: string;
  bytes: number;
  state: StorageState;
}

export interface PutLocalInput {
  /** Absolute destination path in the hot tier, e.g. /data/items/{id}/final/out.mp4 */
  destPath: string;
  bytes: number;
  md5: string;
}

/**
 * Tiered storage interface (docs/02 §6): local NVMe hot tier + Google Drive library.
 * UI embeds Drive preview URLs; platform publish still restores to local first.
 */
export interface StorageTier {
  /** Register/verify a file already written to the local hot tier. */
  putLocal(input: PutLocalInput): Promise<StoredObject>;
  /** Resumable upload local -> Drive mirrored tree; verify md5 (docs/02 §6). */
  archiveToDrive(obj: StoredObject, driveFolderPath: string): Promise<StoredObject>;
  /** Pull an evicted/Drive object back to the hot tier for re-edit/re-publish. */
  restore(obj: StoredObject, destPath: string): Promise<StoredObject>;
  /** Delete the local copy once Drive md5 is verified & outside retention window. */
  evict(obj: StoredObject): Promise<StoredObject>;
}
