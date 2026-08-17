import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleDriveClient,
  TieredStorage,
  drivePreviewEmbedUrl,
  hotTierPath,
  md5File,
  resolveGDriveConfig,
  resolveStorageBackend,
  requireGDriveConfig,
  type GDriveConfig,
  type GDriveSettingsPartial,
  type StorageBackend,
} from '@scp/storage';
import {
  DEFAULT_TRIM_START_MS,
  renderSettingsFromVoiceSettings,
  resolveTrimStartMs,
} from '@scp/shared';
import type { Readable } from 'node:stream';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../system/settings.service';
import { toAssetView, type AssetView } from './asset.view';

type UploadKind = 'ORIGINAL' | 'FINAL' | 'THUMBNAIL';

/** Replace path-hostile characters so a client filename can't escape the tier root. */
function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.length > 0 ? cleaned.slice(0, 180) : 'upload.bin';
}

async function runFfmpegTrim(srcPath: string, destPath: string, trimStartMs: number): Promise<void> {
  const trimSec = Math.max(0, trimStartMs) / 1000;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    ...(trimSec > 0 ? ['-ss', String(trimSec)] : []),
    '-i',
    srcPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    '-y',
    destPath,
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg trim failed (${code}): ${stderr.slice(0, 300)}`));
    });
  });
}

@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Media system of record: Settings → General (`storage.gdrive.backend`) preferred;
   * `STORAGE_BACKEND` env is optional bootstrap fallback.
   */
  async resolveBackend(): Promise<StorageBackend> {
    const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
    return resolveStorageBackend(stored ?? null);
  }

  /** @deprecated Prefer {@link resolveBackend} — env-only snapshot for sync call sites. */
  backend(): StorageBackend {
    const v = this.config.get<'local' | 'gdrive'>('storageBackend');
    return v === 'gdrive' ? 'gdrive' : 'local';
  }

  /** Settings → General credentials merged over env bootstrap. */
  async resolveDriveConfig(): Promise<GDriveConfig | null> {
    const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
    return resolveGDriveConfig(stored ?? null);
  }

  private async tiersWithResolvedDrive(): Promise<TieredStorage> {
    const cfg = await this.resolveDriveConfig();
    return new TieredStorage({
      drive: cfg ? new GoogleDriveClient(cfg) : null,
    });
  }

  /**
   * Stream an uploaded file into the local hot tier (temp), optionally archive
   * to Google Drive when Settings (or env fallback) selects gdrive, and register an Asset.
   */
  async saveUpload(input: {
    contentItemId: string;
    kind: UploadKind;
    filename: string;
    stream: Readable;
    isTruncated: () => boolean;
    /** When set (manual upload), apply account lead-in trim to FINAL videos. */
    accountId?: string;
  }): Promise<AssetView> {
    const content = await this.prisma.client.contentItem.findFirst({
      where: { id: input.contentItemId, deletedAt: null },
      select: { id: true },
    });
    if (!content) throw new NotFoundException('Content item not found.');

    const root = this.config.get<string>('storageRoot');
    if (!root) throw new BadRequestException('Storage root is not configured.');

    const useDrive = (await this.resolveBackend()) === 'gdrive';
    const driveCfg = useDrive ? await this.resolveDriveConfig() : null;
    if (useDrive) {
      try {
        requireGDriveConfig(process.env, driveCfg);
      } catch (err) {
        throw new ServiceUnavailableException(
          err instanceof Error ? err.message : 'Google Drive is not configured.',
        );
      }
    }

    const dest = hotTierPath(root, input.contentItemId, input.kind, safeFilename(input.filename));
    await mkdir(dirname(dest), { recursive: true });

    const hash = createHash('md5');
    let bytes = 0;
    try {
      await pipeline(
        input.stream,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            hash.update(chunk);
            bytes += chunk.length;
            yield chunk;
          }
        },
        createWriteStream(dest),
      );
    } catch (err) {
      await unlink(dest).catch(() => undefined);
      throw err;
    }

    // @fastify/multipart flags truncation when the fileSize limit is exceeded.
    if (input.isTruncated()) {
      await unlink(dest).catch(() => undefined);
      throw new PayloadTooLargeException('Upload exceeds the maximum file size.');
    }

    let md5 = hash.digest('hex');
    let localPath: string | null = dest;

    // Lead-in trim for manual FINAL uploads (account setting, default 500ms).
    if (input.kind === 'FINAL' && localPath) {
      let trimStartMs = DEFAULT_TRIM_START_MS;
      if (input.accountId) {
        const profile = await this.prisma.client.channelProfile.findUnique({
          where: { accountId: input.accountId },
          select: { voiceSettings: true },
        });
        trimStartMs = resolveTrimStartMs({
          accountTrimMs: renderSettingsFromVoiceSettings(profile?.voiceSettings).trimStartMs,
          sourceTrimMs: null,
        });
      }
      if (trimStartMs > 0) {
        const trimmed = join(dirname(dest), `trimmed-${safeFilename(input.filename)}`);
        try {
          await runFfmpegTrim(dest, trimmed, trimStartMs);
          await unlink(dest).catch(() => undefined);
          await rename(trimmed, dest);
          const hashed = await md5File(dest);
          md5 = hashed.md5;
          bytes = hashed.bytes;
          localPath = dest;
        } catch (err) {
          await unlink(trimmed).catch(() => undefined);
          // Keep untrimmed upload if ffmpeg is missing — do not fail the upload.
          console.warn(
            `[storage] lead-in trim skipped for ${input.contentItemId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }

    let driveFileId: string | null = null;
    let storageState: 'LOCAL' | 'DRIVE' | 'BOTH' = 'LOCAL';

    if (useDrive) {
      try {
        const tiers = await this.tiersWithResolvedDrive();
        const archived = await tiers.archiveToDrive(
          { localPath: dest, md5, bytes, state: 'LOCAL' },
          `items/${input.contentItemId}/${input.kind.toLowerCase()}`,
        );
        driveFileId = archived.driveFileId ?? null;
        const evicted = await tiers.evict(archived);
        localPath = evicted.localPath ?? null;
        storageState = 'DRIVE';
      } catch (err) {
        await unlink(dest).catch(() => undefined);
        throw new ServiceUnavailableException(
          err instanceof Error
            ? `Google Drive upload failed: ${err.message}`
            : 'Google Drive upload failed.',
        );
      }
    }

    const asset = await this.prisma.client.asset.create({
      data: {
        contentItemId: input.contentItemId,
        kind: input.kind,
        localPath,
        driveFileId,
        md5,
        bytes: BigInt(bytes),
        storageState,
      },
    });
    return toAssetView(asset);
  }

  /** Status for Settings UI — backend + whether Drive credentials resolve. */
  async driveStatus(): Promise<{
    backend: StorageBackend;
    configured: boolean;
    rootFolderId: string | null;
    previewExample: string | null;
    source: 'settings' | 'env' | 'mixed' | 'none';
    auth: 'oauth' | 'service_account' | null;
  }> {
    const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
    const backend = resolveStorageBackend(stored ?? null);
    const cfg = resolveGDriveConfig(stored ?? null);
    const envOnly = resolveGDriveConfig(null);
    let source: 'settings' | 'env' | 'mixed' | 'none' = 'none';
    if (cfg) {
      const fromSettings = Boolean(
        stored?.clientId?.trim() ||
          stored?.clientSecret?.trim() ||
          stored?.refreshToken?.trim() ||
          stored?.clientEmail?.trim() ||
          stored?.privateKey?.trim() ||
          stored?.rootFolderId?.trim() ||
          stored?.authMode ||
          stored?.backend,
      );
      if (fromSettings && envOnly) source = 'mixed';
      else if (fromSettings) source = 'settings';
      else source = 'env';
    }
    return {
      backend,
      configured: !!cfg,
      rootFolderId: cfg?.rootFolderId ?? null,
      previewExample: cfg ? drivePreviewEmbedUrl('FILE_ID') : null,
      source,
      auth: cfg?.auth ?? null,
    };
  }

  /**
   * Archive an existing local Asset to Drive and clear localPath when
   * Drive is the selected backend. Used by workers via shared @scp/storage helpers;
   * kept here for API-side finalize paths.
   */
  async archiveLocalAsset(assetId: string): Promise<AssetView> {
    if ((await this.resolveBackend()) !== 'gdrive') {
      const asset = await this.prisma.client.asset.findUnique({ where: { id: assetId } });
      if (!asset) throw new NotFoundException('Asset not found.');
      return toAssetView(asset);
    }
    const driveCfg = await this.resolveDriveConfig();
    requireGDriveConfig(process.env, driveCfg);
    const asset = await this.prisma.client.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('Asset not found.');
    if (asset.driveFileId && !asset.localPath) return toAssetView(asset);
    if (!asset.localPath) throw new BadRequestException('Asset has no local path to archive.');

    const { md5, bytes } =
      asset.md5 && asset.bytes != null
        ? { md5: asset.md5, bytes: Number(asset.bytes) }
        : await md5File(asset.localPath);

    const tiers = await this.tiersWithResolvedDrive();
    const archived = await tiers.archiveToDrive(
      { localPath: asset.localPath, md5, bytes, state: 'LOCAL', driveFileId: asset.driveFileId ?? undefined },
      `items/${asset.contentItemId}/${asset.kind.toLowerCase()}`,
    );
    const evicted = await tiers.evict(archived);
    const updated = await this.prisma.client.asset.update({
      where: { id: asset.id },
      data: {
        driveFileId: evicted.driveFileId ?? null,
        localPath: null,
        md5,
        bytes: BigInt(bytes),
        storageState: 'DRIVE',
      },
    });
    return toAssetView(updated);
  }
}

/** Build a Drive client from env only (bootstrap). Prefer StorageService.resolveDriveConfig. */
export function maybeDriveClient(): GoogleDriveClient | null {
  const cfg = resolveGDriveConfig(null);
  return cfg ? new GoogleDriveClient(cfg) : null;
}
