import type { StorageTier, StoredObject, PutLocalInput } from './types.js';

/**
 * Local NVMe hot tier + Google Drive library implementation (docs/02 §6).
 * TODO(storage): implement fs writes + Drive resumable uploads with 750GB/day
 * rate limiting via the `storage` queue; md5 verification before evict.
 */
export class TieredStorage implements StorageTier {
  async putLocal(_input: PutLocalInput): Promise<StoredObject> {
    throw new Error('TODO(storage): TieredStorage.putLocal not implemented yet');
  }

  async archiveToDrive(_obj: StoredObject, _driveFolderPath: string): Promise<StoredObject> {
    throw new Error('TODO(storage): TieredStorage.archiveToDrive not implemented yet');
  }

  async restore(_obj: StoredObject, _destPath: string): Promise<StoredObject> {
    throw new Error('TODO(storage): TieredStorage.restore not implemented yet');
  }

  async evict(_obj: StoredObject): Promise<StoredObject> {
    throw new Error('TODO(storage): TieredStorage.evict not implemented yet');
  }
}
