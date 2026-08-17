import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageTier, StoredObject, PutLocalInput } from './types.js';
import {
  GoogleDriveClient,
  readGDriveConfigFromEnv,
  requireGDriveConfig,
  storageBackendFromEnv,
} from './gdrive-client.js';

/**
 * Hash a file's contents with md5, streaming so we never load the whole file
 * into memory (renders can be hundreds of MB). Also returns the byte length so
 * callers can verify size in the same pass. The worker and API reuse this to
 * hash uploaded/rendered files before registering them (docs/02 §6).
 */
export async function md5File(path: string): Promise<{ md5: string; bytes: number }> {
  const hash = createHash('md5');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    hash.update(buf);
  }
  return { md5: hash.digest('hex'), bytes };
}

/**
 * Canonical hot-tier path for an asset: `{root}/items/{contentItemId}/{kind}/{filename}`.
 * `kind` is lower-cased so the folder layout matches docs/02 §6
 * (`original,processed,voiceover,final,thumbs`). The storage root comes from
 * config (env STORAGE_ROOT) at the call site — never hardcoded here. Uses
 * path.join so it stays correct on the Windows dev host and the Linux VPS.
 */
export function hotTierPath(
  root: string,
  contentItemId: string,
  kind: string,
  filename: string,
): string {
  return join(root, 'items', contentItemId, kind.toLowerCase(), filename);
}

export interface TieredStorageOptions {
  /** Injected Drive client (tests). When omitted, built from env if configured. */
  drive?: GoogleDriveClient | null;
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'm4v') return 'video/x-m4v';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

/**
 * Local NVMe hot tier + Google Drive library (docs/02 §6).
 *
 * - `putLocal` always registers a file already on disk.
 * - `archiveToDrive` uploads to the configured library folder when Drive env
 *   is present (required when STORAGE_BACKEND=gdrive) and leaves local in place
 *   (`BOTH`) so preview/publish can use the hot tier until Drive embed is ready.
 * - `restore` prefers a valid local copy; otherwise downloads original bytes from Drive.
 * - `evict` deletes the local copy after Drive id is present (optional space reclaim).
 */
export class TieredStorage implements StorageTier {
  private readonly drive: GoogleDriveClient | null;

  constructor(opts: TieredStorageOptions = {}) {
    if (opts.drive !== undefined) {
      this.drive = opts.drive;
    } else {
      const cfg = readGDriveConfigFromEnv();
      this.drive = cfg ? new GoogleDriveClient(cfg) : null;
    }
  }

  /** True when env points at Drive as the system of record. */
  static backendIsGdrive(): boolean {
    return storageBackendFromEnv() === 'gdrive';
  }

  /**
   * Register/verify a file already written to the local hot tier. This is the
   * register-a-file-already-written path: the worker renders/downloads straight
   * to `destPath`, then hands us the expected md5 + byte length to certify it.
   */
  async putLocal(input: PutLocalInput): Promise<StoredObject> {
    const { destPath, md5: expectedMd5, bytes: expectedBytes } = input;

    let stats;
    try {
      stats = await stat(destPath);
    } catch {
      throw new Error(`putLocal: no file at hot-tier path ${destPath}`);
    }
    if (!stats.isFile()) {
      throw new Error(`putLocal: hot-tier path is not a file: ${destPath}`);
    }

    const { md5, bytes } = await md5File(destPath);
    if (bytes !== expectedBytes) {
      throw new Error(
        `putLocal: byte-length mismatch for ${destPath} — expected ${expectedBytes}, on disk ${bytes}`,
      );
    }
    if (md5 !== expectedMd5) {
      throw new Error(
        `putLocal: md5 mismatch for ${destPath} — expected ${expectedMd5}, computed ${md5}`,
      );
    }

    return { localPath: destPath, md5, bytes, state: 'LOCAL' };
  }

  /**
   * Resumable upload local -> Drive library tree; verify size + md5 when Drive
   * returns them. `driveFolderPath` is relative to GOOGLE_DRIVE_ROOT_FOLDER_ID
   * (e.g. `{Account}__{id}/2026/08`). Optional `driveFilename` avoids
   * collisions when many assets share one month folder.
   */
  async archiveToDrive(
    obj: StoredObject,
    driveFolderPath: string,
    opts?: { driveFilename?: string },
  ): Promise<StoredObject> {
    const client = this.drive;
    if (!client) {
      // Only fall back to env-only require when no client was injected (callers
      // that use Settings should inject a resolved client first).
      if (TieredStorage.backendIsGdrive()) {
        requireGDriveConfig();
      }
      throw new Error(
        'archiveToDrive: Google Drive is not configured. Paste credentials in ' +
          'Settings → General → Google Drive media library, or set GOOGLE_DRIVE_* env vars.',
      );
    }
    if (!obj.localPath) {
      throw new Error('archiveToDrive: object has no localPath to upload.');
    }

    const filename =
      opts?.driveFilename?.trim() ||
      obj.localPath.split(/[\\/]/).pop() ||
      'asset.bin';
    const uploaded = await client.uploadFile({
      localPath: obj.localPath,
      filename,
      mimeType: guessMime(filename),
      folderRelativePath: driveFolderPath,
      md5Hex: obj.md5,
    });

    if (uploaded.size != null && uploaded.size !== obj.bytes) {
      throw new Error(
        `archiveToDrive: Drive size mismatch — local ${obj.bytes}, Drive ${uploaded.size}`,
      );
    }
    const driveMd5 = uploaded.md5Checksum?.toLowerCase() ?? null;
    const localMd5 = obj.md5.toLowerCase();
    if (driveMd5 && driveMd5 !== localMd5) {
      throw new Error(
        `archiveToDrive: md5 mismatch — local ${localMd5}, Drive ${driveMd5}`,
      );
    }

    return {
      ...obj,
      md5: driveMd5 ?? localMd5,
      driveFileId: uploaded.fileId,
      state: obj.localPath ? 'BOTH' : 'DRIVE',
    };
  }

  /**
   * Pull an evicted/Drive object back to the hot tier for re-edit/re-publish.
   * Prefers an intact local copy; otherwise downloads original bytes via
   * `alt=media` and verifies against Drive's md5Checksum (updates stale DB hashes).
   */
  async restore(obj: StoredObject, destPath: string): Promise<StoredObject> {
    if (obj.localPath) {
      try {
        const stats = await stat(obj.localPath);
        if (stats.isFile()) {
          const { md5, bytes } = await md5File(obj.localPath);
          // Intact local wins for publish/preview (dual-store). Recompute hash
          // when the DB value drifted so callers can persist the correction.
          return {
            ...obj,
            localPath: obj.localPath,
            md5,
            bytes,
            state: obj.driveFileId ? 'BOTH' : 'LOCAL',
          };
        }
      } catch {
        // Fall through to Drive restore.
      }
    }

    if (!obj.driveFileId) {
      throw new Error('restore: no valid local copy and no driveFileId to download.');
    }
    const client = this.drive;
    if (!client) {
      throw new Error(
        'restore: Drive client not configured — cannot pull Drive-only object to hot tier.',
      );
    }

    const meta = await client.getFileMetadata(obj.driveFileId);
    await client.downloadFile(obj.driveFileId, destPath);
    const { md5, bytes } = await md5File(destPath);

    if (meta.size != null && bytes !== meta.size) {
      await unlink(destPath).catch(() => undefined);
      throw new Error(
        `restore: incomplete Drive download — expected ${meta.size} bytes, got ${bytes}`,
      );
    }

    const driveMd5 = meta.md5Checksum;
    const expected = obj.md5?.toLowerCase() || null;
    if (driveMd5 && md5 !== driveMd5) {
      await unlink(destPath).catch(() => undefined);
      throw new Error(
        `restore: md5 mismatch after Drive download — Drive metadata ${driveMd5}, got ${md5}`,
      );
    }
    if (!driveMd5 && expected && md5 !== expected) {
      await unlink(destPath).catch(() => undefined);
      throw new Error(
        `restore: md5 mismatch after Drive download — expected ${expected}, got ${md5}`,
      );
    }
    // Prefer Drive checksum (authoritative for the stored binary). If DB had a
    // stale local hash that differed, accepting driveMd5/md5 corrects it.
    return {
      ...obj,
      localPath: destPath,
      md5: driveMd5 ?? md5,
      bytes,
      state: 'BOTH',
    };
  }

  /**
   * Delete the local copy once Drive id is present (docs/02 §6).
   */
  async evict(obj: StoredObject): Promise<StoredObject> {
    if (!obj.driveFileId) {
      throw new Error('evict: refusing to delete local file without a driveFileId.');
    }
    if (obj.localPath) {
      await unlink(obj.localPath).catch(() => undefined);
    }
    return {
      ...obj,
      localPath: undefined,
      state: 'DRIVE',
    };
  }
}
