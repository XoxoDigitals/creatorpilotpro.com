/**
 * Archive a local Asset row to Google Drive when Settings (or env fallback)
 * selects gdrive as the storage backend.
 * Keeps the local hot-tier copy (dual store: LOCAL_AND_DRIVE / BOTH) so preview
 * and publish work while Google processes the Drive file for embed playback.
 *
 * Library path: `{Account Name}__{accountId}/{yyyy}/{mm}/` under the selected
 * root (find-or-create). Credentials + backend: Settings → General
 * (`storage.gdrive`, encrypted) merged over GOOGLE_DRIVE_* / STORAGE_BACKEND
 * env bootstrap — same resolve path as the API.
 *
 * TODO(gdrive): also archive ORIGINAL source downloads + VOICEOVER/BG_AUDIO/
 * SUBTITLE intermediates once finals/thumbnails are stable in production.
 */
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GoogleDriveClient,
  TieredStorage,
  buildDriveArchiveFolderPath,
  driveArchiveFilename,
  md5File,
  resolveGDriveConfig,
  resolveStorageBackend,
  requireGDriveConfig,
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

/** Same account resolution order as render-process / content views. */
async function resolveArchiveContext(contentItemId: string): Promise<{
  accountId: string | null;
  accountName: string | null;
  archiveDate: Date;
}> {
  const prisma = getPrisma();
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: {
      createdAt: true,
      idea: { select: { account: { select: { id: true, name: true } } } },
      sourceVideo: {
        select: {
          watchedSource: {
            select: { targetAccount: { select: { id: true, name: true } } },
          },
        },
      },
      publishTargets: {
        select: { accountId: true, publishedAt: true, account: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10,
      },
    },
  });

  const fromIdea = item?.idea?.account ?? null;
  const fromSource = item?.sourceVideo?.watchedSource?.targetAccount ?? null;
  const fromTarget = item?.publishTargets.find((t) => t.account)?.account ?? null;
  const account = fromIdea ?? fromSource ?? fromTarget;

  const publishedAts = (item?.publishTargets ?? [])
    .map((t) => t.publishedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());

  return {
    accountId: account?.id ?? null,
    accountName: account?.name ?? null,
    archiveDate: publishedAts[0] ?? item?.createdAt ?? new Date(),
  };
}

export async function archiveAssetToDriveIfConfigured(assetId: string): Promise<void> {
  const settings = await loadGDriveSettingsFromDb();
  if (resolveStorageBackend(settings) !== 'gdrive') return;

  let cfg;
  try {
    cfg = requireGDriveConfig(process.env, settings);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${msg} Select a library folder in Settings → General (not "." or empty) before using Google Drive storage.`,
    );
  }
  if (!cfg.rootFolderId || cfg.rootFolderId === '.' || cfg.rootFolderId === 'root') {
    throw new Error(
      'Google Drive root folder id is missing or invalid. Use Settings → Select folder ' +
        '(folder id looks like 1fQ-…) before archiving media.',
    );
  }

  const prisma = getPrisma();
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset?.localPath) return;
  // Already dual-stored or Drive-only — do not re-upload.
  if (asset.driveFileId && (asset.storageState === 'DRIVE' || asset.storageState === 'BOTH')) {
    return;
  }

  const { md5, bytes } =
    asset.md5 && asset.bytes != null
      ? { md5: asset.md5, bytes: Number(asset.bytes) }
      : await md5File(asset.localPath);

  const ctx = await resolveArchiveContext(asset.contentItemId);
  const folderPath = buildDriveArchiveFolderPath({
    accountId: ctx.accountId,
    accountName: ctx.accountName,
    archiveDate: ctx.archiveDate,
  });
  const driveFilename = driveArchiveFilename(asset.contentItemId, asset.kind, asset.localPath);

  const drive = new GoogleDriveClient(cfg);
  const tiers = new TieredStorage({ drive });
  const archived = await tiers.archiveToDrive(
    {
      localPath: asset.localPath,
      md5,
      bytes,
      state: 'LOCAL',
      driveFileId: asset.driveFileId ?? undefined,
    },
    folderPath,
    { driveFilename },
  );

  const uploadedAt = new Date();
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      driveFileId: archived.driveFileId ?? null,
      driveUploadedAt: uploadedAt,
      localPath: asset.localPath,
      md5: archived.md5,
      bytes: BigInt(archived.bytes),
      storageState: 'BOTH',
    },
  });
  console.log(
    `[worker:gdrive] archived ${asset.kind} ${asset.id} → Drive ${archived.driveFileId} (${folderPath}/${driveFilename}) [dual-store BOTH]`,
  );
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
