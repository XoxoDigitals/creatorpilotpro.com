import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
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
  requireGDriveConfig,
  type GDriveConfig,
  type GDriveSettingsPartial,
} from '@scp/storage';
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

@Injectable()
export class StorageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
  ) {}

  /** STORAGE_BACKEND from config (`local` | `gdrive`). */
  backend(): 'local' | 'gdrive' {
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
   * to Google Drive when STORAGE_BACKEND=gdrive, and register an Asset.
   */
  async saveUpload(input: {
    contentItemId: string;
    kind: UploadKind;
    filename: string;
    stream: Readable;
    isTruncated: () => boolean;
  }): Promise<AssetView> {
    const content = await this.prisma.client.contentItem.findFirst({
      where: { id: input.contentItemId, deletedAt: null },
      select: { id: true },
    });
    if (!content) throw new NotFoundException('Content item not found.');

    const root = this.config.get<string>('storageRoot');
    if (!root) throw new BadRequestException('Storage root is not configured.');

    const useDrive = this.backend() === 'gdrive';
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

    const md5 = hash.digest('hex');
    let driveFileId: string | null = null;
    let storageState: 'LOCAL' | 'DRIVE' | 'BOTH' = 'LOCAL';
    let localPath: string | null = dest;

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
    backend: 'local' | 'gdrive';
    configured: boolean;
    rootFolderId: string | null;
    previewExample: string | null;
    source: 'settings' | 'env' | 'mixed' | 'none';
  }> {
    const backend = this.backend();
    const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
    const cfg = resolveGDriveConfig(stored ?? null);
    const envOnly = resolveGDriveConfig(null);
    let source: 'settings' | 'env' | 'mixed' | 'none' = 'none';
    if (cfg) {
      const fromSettings = Boolean(
        stored?.clientId?.trim() ||
          stored?.clientSecret?.trim() ||
          stored?.refreshToken?.trim() ||
          stored?.rootFolderId?.trim(),
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
    };
  }

  /**
   * Archive an existing local Asset to Drive and clear localPath when
   * STORAGE_BACKEND=gdrive. Used by workers via shared @scp/storage helpers;
   * kept here for API-side finalize paths.
   */
  async archiveLocalAsset(assetId: string): Promise<AssetView> {
    if (this.backend() !== 'gdrive') {
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
