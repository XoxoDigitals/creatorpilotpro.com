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
 *   is present (required when STORAGE_BACKEND=gdrive).
 * - `restore` prefers a valid local copy; otherwise downloads from Drive.
 * - `evict` deletes the local copy after Drive id is present.
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
   * Resumable upload local -> Drive mirrored tree; verify size when Drive
   * returns it. `driveFolderPath` is relative to GOOGLE_DRIVE_ROOT_FOLDER_ID
   * (e.g. `items/{contentItemId}/final`).
   */
  async archiveToDrive(obj: StoredObject, driveFolderPath: string): Promise<StoredObject> {
    if (TieredStorage.backendIsGdrive()) {
      requireGDriveConfig();
    }
    const client = this.drive;
    if (!client) {
      throw new Error(
        'archiveToDrive: Google Drive is not configured. Set GOOGLE_DRIVE_CLIENT_ID, ' +
          'GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID.',
      );
    }
    if (!obj.localPath) {
      throw new Error('archiveToDrive: object has no localPath to upload.');
    }

    const filename = obj.localPath.split(/[\\/]/).pop() ?? 'asset.bin';
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

    return {
      ...obj,
      driveFileId: uploaded.fileId,
      state: obj.localPath ? 'BOTH' : 'DRIVE',
    };
  }

  /**
   * Pull an evicted/Drive object back to the hot tier for re-edit/re-publish.
   * Local-present fast path when md5 still matches; otherwise download from Drive.
   */
  async restore(obj: StoredObject, destPath: string): Promise<StoredObject> {
    if (obj.localPath) {
      try {
        const stats = await stat(obj.localPath);
        if (stats.isFile()) {
          const { md5, bytes } = await md5File(obj.localPath);
          // Prefer exact md5 match; if Drive is unavailable, still use the local file.
          if (!obj.md5 || md5 === obj.md5 || !obj.driveFileId) {
            return { ...obj, localPath: obj.localPath, md5, bytes, state: 'LOCAL' };
          }
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
    await client.downloadFile(obj.driveFileId, destPath);
    const { md5, bytes } = await md5File(destPath);
    if (obj.md5 && md5 !== obj.md5) {
      await unlink(destPath).catch(() => undefined);
      throw new Error(
        `restore: md5 mismatch after Drive download — expected ${obj.md5}, got ${md5}`,
      );
    }
    return {
      ...obj,
      localPath: destPath,
      md5,
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
