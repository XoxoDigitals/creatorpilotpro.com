import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { StorageTier, StoredObject, PutLocalInput } from './types.js';

/**
 * Hash a file's contents with md5, streaming so we never load the whole file
 * into memory (renders can be hundreds of MB). Also returns the byte length so
 * callers can verify size in the same pass. The worker and API reuse this to
 * hash uploaded/rendered files before registering them (docs/02 §6).
 */
export async function md5File(path: string): Promise<{ md5: string; bytes: number }> {
  const hash = createHash('md5');
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
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

/**
 * Local NVMe hot tier + Google Drive library implementation (docs/02 §6).
 *
 * Phase 1 (live): the local hot tier — register a file already written to disk
 * (`putLocal`) and guarantee a local copy exists for the publish preflight
 * (`restore`, local-present fast path).
 *
 * Phase 2 (deferred): Drive archival/eviction (`archiveToDrive`, `evict`, and
 * the Drive-restore branch of `restore`) land with the `storage` queue —
 * resumable uploads under the 750GB/day/account cap with md5 verification
 * before any local copy is evicted. The Google Drive client is not wired up
 * yet, so those paths throw a clear NotImplemented error rather than pretending
 * to work.
 */
export class TieredStorage implements StorageTier {
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
   * Resumable upload local -> Drive mirrored tree; verify md5 (docs/02 §6).
   *
   * Deferred to Phase 2: needs the Google Drive client and the `storage` queue
   * for 750GB/day rate limiting. Signature is final so callers can be written
   * against it now.
   */
  async archiveToDrive(_obj: StoredObject, _driveFolderPath: string): Promise<StoredObject> {
    throw new Error(
      'archiveToDrive: Drive archival is deferred to the Phase-2 storage queue ' +
        '(resumable uploads, 750GB/day rate limiting, md5 verify before evict).',
    );
  }

  /**
   * Pull an evicted/Drive object back to the hot tier for re-edit/re-publish.
   *
   * Local-present fast path (live): the publish preflight calls this to
   * guarantee a local copy exists. If `obj.localPath` is on disk and its md5
   * still matches, we return it as LOCAL immediately — idempotent, no Drive
   * needed. LOCAL/BOTH objects therefore always succeed offline.
   *
   * Drive restore (deferred): if there is no valid local copy the object lives
   * only in Drive/evicted, and pulling it back needs the Phase-2 Drive client —
   * so we throw until that lands.
   */
  async restore(obj: StoredObject, _destPath: string): Promise<StoredObject> {
    if (obj.localPath) {
      try {
        const stats = await stat(obj.localPath);
        if (stats.isFile()) {
          const { md5, bytes } = await md5File(obj.localPath);
          if (md5 === obj.md5) {
            return { ...obj, localPath: obj.localPath, md5, bytes, state: 'LOCAL' };
          }
        }
      } catch {
        // No usable local copy — fall through to the deferred Drive path.
      }
    }

    throw new Error(
      'restore: no valid local copy and Drive restore is deferred to the Phase-2 ' +
        'storage queue — cannot pull an evicted/Drive-only object back to the hot tier yet.',
    );
  }

  /**
   * Delete the local copy once Drive md5 is verified & outside retention window.
   *
   * Deferred to Phase 2: eviction must confirm the Drive md5 matches before
   * removing the local file (docs/02 §6), which needs the Drive client. Signature
   * is final so the maintenance/eviction job can be written against it now.
   */
  async evict(_obj: StoredObject): Promise<StoredObject> {
    throw new Error(
      'evict: local eviction is deferred to the Phase-2 storage queue — must md5-verify ' +
        'the Drive copy before deleting the local file, and the Drive client is not wired up yet.',
    );
  }
}
