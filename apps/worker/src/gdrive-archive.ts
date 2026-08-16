/**
 * Archive a local Asset row to Google Drive when STORAGE_BACKEND=gdrive.
 * Clears localPath after a successful upload so Drive is the system of record.
 *
 * Credentials: Settings → General (`storage.gdrive`, encrypted) merged over
 * GOOGLE_DRIVE_* env bootstrap — same resolve path as the API.
 *
 * TODO(gdrive): also archive ORIGINAL source downloads + VOICEOVER/BG_AUDIO/
 * SUBTITLE intermediates once finals/thumbnails are stable in production.
 */
import { access, constants, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GoogleDriveClient,
  TieredStorage,
  md5File,
  resolveGDriveConfig,
  requireGDriveConfig,
  storageBackendFromEnv,
  type GDriveSettingsPartial,
} from '@scp/storage';
import { getPrisma } from '@scp/db';
import { decryptSecret, loadMasterKey } from '@scp/shared/crypto';

async function localFileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadGDriveSettingsFromDb(): Promise<GDriveSettingsPartial | null> {
  const prisma = getPrisma();
  const row = await prisma.systemSetting.findUnique({ where: { key: 'storage.gdrive' } });
  if (!row?.value || typeof row.value !== 'object') return null;
  const wrapped = row.value as { __enc?: string };
  if (wrapped.__enc) {
    const masterKey = loadMasterKey(process.env.MASTER_KEY);
    return JSON.parse(decryptSecret(wrapped.__enc, masterKey)) as GDriveSettingsPartial;
  }
  // Legacy cleartext folder-only row.
  return row.value as GDriveSettingsPartial;
}

async function resolveDriveClient(): Promise<GoogleDriveClient | null> {
  const settings = await loadGDriveSettingsFromDb();
  const cfg = resolveGDriveConfig(settings);
  return cfg ? new GoogleDriveClient(cfg) : null;
}

export async function archiveAssetToDriveIfConfigured(assetId: string): Promise<void> {
  if (storageBackendFromEnv() !== 'gdrive') return;
  const settings = await loadGDriveSettingsFromDb();
  requireGDriveConfig(process.env, settings);

  const prisma = getPrisma();
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset?.localPath) return;
  if (asset.driveFileId && asset.storageState === 'DRIVE') return;

  const { md5, bytes } =
    asset.md5 && asset.bytes != null
      ? { md5: asset.md5, bytes: Number(asset.bytes) }
      : await md5File(asset.localPath);

  const drive = await resolveDriveClient();
  const tiers = new TieredStorage({ drive });
  const archived = await tiers.archiveToDrive(
    {
      localPath: asset.localPath,
      md5,
      bytes,
      state: 'LOCAL',
      driveFileId: asset.driveFileId ?? undefined,
    },
    `items/${asset.contentItemId}/${asset.kind.toLowerCase()}`,
  );

  const localPath = asset.localPath;
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      driveFileId: archived.driveFileId ?? null,
      localPath: null,
      md5,
      bytes: BigInt(bytes),
      storageState: 'DRIVE',
    },
  });
  await unlink(localPath).catch(() => undefined);
}

/**
 * Ensure a FINAL asset has a local file for platform upload. Restores from
 * Drive into STORAGE_ROOT when needed. Verifies on-disk presence — a stale
 * localPath with a missing file used to skip Drive restore and fail publish.
 */
export async function ensureLocalFinalAsset(asset: {
  id: string;
  contentItemId: string;
  localPath: string | null;
  driveFileId: string | null;
  md5: string | null;
  bytes: bigint | null;
}): Promise<{ localPath: string; bytes: number; md5: string }> {
  if (asset.localPath && (await localFileExists(asset.localPath))) {
    return {
      localPath: asset.localPath,
      bytes: asset.bytes ? Number(asset.bytes) : 0,
      md5: asset.md5 ?? '',
    };
  }

  if (!asset.driveFileId) {
    throw new Error(
      asset.localPath
        ? `Media file missing on disk (${asset.localPath}) and not archived to Google Drive. Re-upload the video, then Retry.`
        : 'No media file on disk and no Google Drive copy to restore. Re-upload the video, then Retry.',
    );
  }

  const settings = await loadGDriveSettingsFromDb();
  requireGDriveConfig(process.env, settings);
  const root = process.env.STORAGE_ROOT;
  if (!root) throw new Error('STORAGE_ROOT is required to restore Drive assets for publish.');

  const dest = join(root, 'items', asset.contentItemId, 'final', 'restore-final.bin');
  const drive = await resolveDriveClient();
  const tiers = new TieredStorage({ drive });
  const restored = await tiers.restore(
    {
      driveFileId: asset.driveFileId,
      md5: asset.md5 ?? '',
      bytes: asset.bytes ? Number(asset.bytes) : 0,
      state: 'DRIVE',
    },
    dest,
  );

  const prisma = getPrisma();
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      localPath: restored.localPath ?? dest,
      storageState: 'BOTH',
      md5: restored.md5,
      bytes: BigInt(restored.bytes),
    },
  });

  return {
    localPath: restored.localPath ?? dest,
    bytes: restored.bytes,
    md5: restored.md5,
  };
}
