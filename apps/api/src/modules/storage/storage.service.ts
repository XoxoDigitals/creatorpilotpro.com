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
  buildDriveArchiveFolderPath,
  driveArchiveFilename,
  drivePreviewEmbedUrl,
  hotTierPath,
  md5File,
  resolveGDriveConfig,
  resolveStorageBackend,
  requireGDriveConfig,
  GDRIVE_CONNECT_OAUTH_SCOPE,
  driveScopeAllowsFolderBrowse,
  parseDriveFolderId,
  normalizeDriveListParentId,
  type GDriveConfig,
  type GDriveFolderEntry,
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
import { GoogleOAuthService, type GoogleConfig } from '../accounts/oauth/google.service';
import { signState, verifyState } from '../accounts/oauth/oauth-state.util';
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
    private readonly google: GoogleOAuthService,
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
   * Resolve account + archive date for Drive library layout
   * (`{Account}__{id}/{yyyy}/{mm}`). Prefer content publishedAt, else item createdAt.
   */
  private async resolveDriveArchiveContext(
    contentItemId: string,
    preferredAccountId?: string | null,
  ): Promise<{ accountId: string | null; accountName: string | null; archiveDate: Date }> {
    const item = await this.prisma.client.contentItem.findUnique({
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
          select: {
            accountId: true,
            publishedAt: true,
            account: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
          take: 10,
        },
      },
    });

    let account: { id: string; name: string } | null = null;
    if (preferredAccountId) {
      account = await this.prisma.client.socialAccount.findFirst({
        where: { id: preferredAccountId, deletedAt: null },
        select: { id: true, name: true },
      });
    }
    if (!account) {
      account =
        item?.idea?.account ??
        item?.sourceVideo?.watchedSource?.targetAccount ??
        item?.publishTargets.find((t) => t.account)?.account ??
        null;
    }

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
        const ctx = await this.resolveDriveArchiveContext(input.contentItemId, input.accountId);
        const folderPath = buildDriveArchiveFolderPath({
          accountId: ctx.accountId,
          accountName: ctx.accountName,
          archiveDate: ctx.archiveDate,
        });
        const driveFilename = driveArchiveFilename(input.contentItemId, input.kind, dest);
        const archived = await tiers.archiveToDrive(
          { localPath: dest, md5, bytes, state: 'LOCAL' },
          folderPath,
          { driveFilename },
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
    /** OAuth refresh token present (may still need a root folder). */
    oauthConnected: boolean;
    /** Platform Apps → Google OAuth client is configured (Connect can run). */
    googleAppConfigured: boolean;
  }> {
    const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
    const googleApp = await this.settings.getDecrypted<GoogleConfig>('platform_apps.google');
    const backend = resolveStorageBackend(stored ?? null);
    const cfg = resolveGDriveConfig(stored ?? null);
    const envOnly = resolveGDriveConfig(null);
    const oauthConnected = Boolean(
      stored?.refreshToken?.trim() || process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim(),
    );
    let source: 'settings' | 'env' | 'mixed' | 'none' = 'none';
    if (cfg || oauthConnected) {
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
      if (cfg) {
        if (fromSettings && envOnly) source = 'mixed';
        else if (fromSettings) source = 'settings';
        else source = 'env';
      } else if (fromSettings) {
        source = 'settings';
      }
    }
    const authHint =
      cfg?.auth ??
      (stored?.authMode === 'service_account'
        ? 'service_account'
        : oauthConnected
          ? 'oauth'
          : null);
    return {
      backend,
      configured: !!cfg,
      rootFolderId:
        cfg?.rootFolderId ??
        parseDriveFolderId(stored?.rootFolderId) ??
        parseDriveFolderId(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) ??
        null,
      previewExample: cfg ? drivePreviewEmbedUrl('FILE_ID') : null,
      source,
      auth: authHint,
      oauthConnected,
      googleAppConfigured: Boolean(googleApp?.clientId?.trim() && googleApp?.clientSecret?.trim()),
    };
  }

  /** OAuth redirect URI for system-level Drive connect (same Google client as YouTube). */
  private gdriveRedirectUri(): string {
    const web = this.config.get<string>('webAppUrl') ?? 'http://localhost:3000';
    return `${web}/api/v1/storage/gdrive/connect/callback`;
  }

  private sessionSecret(): string {
    const s = process.env.SESSION_SECRET;
    if (!s) throw new BadRequestException('SESSION_SECRET is not configured.');
    return s;
  }

  /**
   * Start Drive OAuth using Platform Apps → Google client (same as YouTube).
   * Requests `drive` scope with incremental auth (`include_granted_scopes`).
   */
  async gdriveConnectStartUrl(userId: string): Promise<string> {
    const cfg = await this.google.getConfig();
    const state = signState({ userId, purpose: 'gdrive' }, this.sessionSecret());
    return this.google.buildAuthUrl({
      clientId: cfg.clientId,
      redirectUri: this.gdriveRedirectUri(),
      scopes: [GDRIVE_CONNECT_OAUTH_SCOPE],
      state,
    });
  }

  /**
   * Exchange code → store refresh token + Platform Apps client id/secret into
   * `storage.gdrive` (system-level). Does not create a social account.
   */
  async gdriveConnectCallback(code: string, state: string): Promise<void> {
    const payload = verifyState<{ userId: string; purpose?: string }>(state, this.sessionSecret());
    if (!payload || payload.purpose !== 'gdrive') {
      throw new BadRequestException('Invalid or expired OAuth state.');
    }

    const cfg = await this.google.getConfig();
    const bundle = await this.google.exchangeCode(code, this.gdriveRedirectUri());
    if (!bundle.refreshToken) {
      throw new BadRequestException(
        'Google did not return a refresh token. Revoke app access in Google Account → Security → Third-party access, then Connect again.',
      );
    }
    if (!driveScopeAllowsFolderBrowse(bundle.scope)) {
      throw new BadRequestException(
        'Google did not grant Drive folder access. On the OAuth consent screen add scope ' +
          'https://www.googleapis.com/auth/drive (not only drive.file), save, revoke this app under ' +
          'Google Account → Security → Third-party access if needed, then Connect with Google again.',
      );
    }

    await this.settings.put('storage.gdrive', {
      authMode: 'oauth',
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      refreshToken: bundle.refreshToken,
    });
  }

  /** Clear OAuth credentials from storage.gdrive; keep folder / SA / backend. */
  async gdriveDisconnect(): Promise<void> {
    const existing =
      (await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive')) ?? {};
    const next: GDriveSettingsPartial = { ...existing };
    delete next.clientId;
    delete next.clientSecret;
    delete next.refreshToken;
    if (next.authMode === 'oauth') {
      if (next.clientEmail || next.privateKey) next.authMode = 'service_account';
      else delete next.authMode;
    }
    await this.settings.putReplace('storage.gdrive', next);
  }

  /**
   * List Drive folders for the Settings picker. Uses OAuth or SA credentials
   * already stored (OAuth may be connected without a root folder yet).
   */
  async listGdriveFolders(parentId?: string): Promise<GDriveFolderEntry[]> {
    try {
      const client = await this.driveClientForBrowse();
      const raw = parentId?.trim();
      let parent: string;
      if (!raw) {
        // No parent query: list under saved library root when set, else My Drive.
        const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
        parent =
          parseDriveFolderId(stored?.rootFolderId) ||
          parseDriveFolderId(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) ||
          'root';
      } else {
        parent = normalizeDriveListParentId(raw);
      }
      return await client.listFolders(parent);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg =
        err instanceof Error ? err.message : 'Could not list Google Drive folders.';
      // BadRequest so the UI toast shows the actionable text (not a generic 500).
      throw new BadRequestException(msg);
    }
  }

  /** Persist selected library root folder id. */
  async setGdriveRootFolder(folderId: string): Promise<{ rootFolderId: string }> {
    const id = parseDriveFolderId(folderId);
    if (!id) {
      throw new BadRequestException(
        'folderId must be a Drive folder id or https://drive.google.com/drive/folders/{id} URL ' +
          '(not ".", empty, or My Drive root).',
      );
    }
    await this.settings.put('storage.gdrive', { rootFolderId: id });
    return { rootFolderId: id };
  }

  /** Client for folder browse — oauth/SA without requiring a configured root yet. */
  private async driveClientForBrowse(): Promise<GoogleDriveClient> {
    const stored = await this.settings.getDecrypted<GDriveSettingsPartial>('storage.gdrive');
    const googleApp = await this.settings.getDecrypted<GoogleConfig>('platform_apps.google');

    const rootFolderId =
      parseDriveFolderId(stored?.rootFolderId) ||
      parseDriveFolderId(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) ||
      'root';

    const refreshToken =
      stored?.refreshToken?.trim() || process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() || '';
    const clientId =
      stored?.clientId?.trim() ||
      googleApp?.clientId?.trim() ||
      process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() ||
      '';
    const clientSecret =
      stored?.clientSecret?.trim() ||
      googleApp?.clientSecret?.trim() ||
      process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ||
      '';

    const clientEmail =
      stored?.clientEmail?.trim() || process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim() || '';
    const privateKey =
      stored?.privateKey?.trim() || process.env.GOOGLE_DRIVE_PRIVATE_KEY?.trim() || '';

    const preferSa =
      stored?.authMode === 'service_account' ||
      (!refreshToken && Boolean(clientEmail && privateKey));

    if (!preferSa && clientId && clientSecret && refreshToken) {
      return new GoogleDriveClient({
        auth: 'oauth',
        clientId,
        clientSecret,
        refreshToken,
        rootFolderId,
      });
    }
    if (clientEmail && privateKey) {
      return new GoogleDriveClient({
        auth: 'service_account',
        clientEmail,
        privateKey,
        rootFolderId,
      });
    }
    throw new BadRequestException(
      'Connect Google Drive first (Connect with Google), or configure a service account.',
    );
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
    const ctx = await this.resolveDriveArchiveContext(asset.contentItemId);
    const folderPath = buildDriveArchiveFolderPath({
      accountId: ctx.accountId,
      accountName: ctx.accountName,
      archiveDate: ctx.archiveDate,
    });
    const driveFilename = driveArchiveFilename(asset.contentItemId, asset.kind, asset.localPath);
    const archived = await tiers.archiveToDrive(
      { localPath: asset.localPath, md5, bytes, state: 'LOCAL', driveFileId: asset.driveFileId ?? undefined },
      folderPath,
      { driveFilename },
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
