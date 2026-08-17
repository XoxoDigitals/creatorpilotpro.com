import { createSign } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { accountIdFromDriveFolderName } from './drive-archive-path.js';

/**
 * Minimal Google Drive client for the media library (docs/02 §6).
 *
 * Auth (either):
 * - OAuth refresh token for a user/library account (drive.file) — best for
 *   personal My Drive owned by that same user.
 * - Service account JWT (client_email + private_key) — share the root folder
 *   (Editor) with the SA email, or use a Shared Drive where the SA is a member.
 *   SA uses the broader `drive` scope so a *shared* parent folder is visible
 *   (drive.file alone cannot see folders the SA did not create).
 *
 * Library layout under root: `{Account Name}__{accountId}/{yyyy}/{mm}/`
 * (see drive-archive-path.ts). Env bootstrap: GOOGLE_DRIVE_* (see
 * resolveGDriveConfig). Settings → General preferred when non-empty.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
/** Narrow scope used historically for OAuth paste setups. */
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive.file';
/**
 * Connect-button OAuth: full Drive so Settings can list folders and archive
 * into a user-selected root (drive.file alone cannot browse arbitrary folders).
 */
const CONNECT_OAUTH_SCOPE = 'https://www.googleapis.com/auth/drive';
/** Shared-folder access for service accounts (My Drive share or Shared Drive). */
const SERVICE_ACCOUNT_SCOPE = 'https://www.googleapis.com/auth/drive';

export interface GDriveFolderEntry {
  id: string;
  name: string;
}

export type GDriveAuthMode = 'oauth' | 'service_account';

export type GDriveConfig =
  | {
      auth: 'oauth';
      clientId: string;
      clientSecret: string;
      refreshToken: string;
      rootFolderId: string;
    }
  | {
      auth: 'service_account';
      clientEmail: string;
      privateKey: string;
      rootFolderId: string;
    };

export interface GDriveUploadResult {
  fileId: string;
  md5Checksum: string | null;
  size: number | null;
  webViewLink: string | null;
  mimeType: string | null;
}

/** iframe / preview URL for Drive-hosted media. */
export function drivePreviewEmbedUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

/** True when an asset row can be shown or published (local and/or Drive). */
export function assetHasMedia(a: {
  localPath?: string | null;
  driveFileId?: string | null;
}): boolean {
  return Boolean(a.localPath || a.driveFileId);
}

export type StorageBackend = 'local' | 'gdrive';

export type GDriveSettingsPartial = Partial<{
  /** System of record: Settings → General preferred; env STORAGE_BACKEND is fallback. */
  backend: StorageBackend;
  authMode: GDriveAuthMode;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  clientEmail: string;
  privateKey: string;
  rootFolderId: string;
}>;

export function readGDriveConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GDriveConfig | null {
  return resolveGDriveConfig(null, env);
}

function pick(fromSettings: string | undefined, fromEnv: string | undefined): string {
  const s = fromSettings?.trim();
  if (s) return s;
  return fromEnv?.trim() ?? '';
}

/** Normalize PEM private keys pasted from JSON (`\\n`) or Settings. */
export function normalizePrivateKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, '\n');
}

/**
 * Merge Settings-stored credentials (preferred when non-empty) over process env.
 * Used by API + worker so Owners can paste keys in Settings → General without
 * requiring a redeploy — env remains a bootstrap/fallback.
 *
 * Resolution order:
 * 1. Explicit authMode when set
 * 2. Else OAuth if clientId+secret+refresh resolve
 * 3. Else service account if clientEmail+privateKey resolve
 */
export function resolveGDriveConfig(
  settings: GDriveSettingsPartial | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): GDriveConfig | null {
  const rootFolderId = pick(settings?.rootFolderId, env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if (!rootFolderId) return null;

  const clientId = pick(settings?.clientId, env.GOOGLE_DRIVE_CLIENT_ID);
  const clientSecret = pick(settings?.clientSecret, env.GOOGLE_DRIVE_CLIENT_SECRET);
  const refreshToken = pick(settings?.refreshToken, env.GOOGLE_DRIVE_REFRESH_TOKEN);
  const clientEmail = pick(settings?.clientEmail, env.GOOGLE_DRIVE_CLIENT_EMAIL);
  const privateKeyRaw = pick(settings?.privateKey, env.GOOGLE_DRIVE_PRIVATE_KEY);
  const privateKey = privateKeyRaw ? normalizePrivateKey(privateKeyRaw) : '';

  const oauthOk = Boolean(clientId && clientSecret && refreshToken);
  const saOk = Boolean(clientEmail && privateKey);

  const modeHint = (settings?.authMode ?? env.GOOGLE_DRIVE_AUTH_MODE ?? '')
    .trim()
    .toLowerCase();
  const preferSa =
    modeHint === 'service_account' || modeHint === 'service-account' || modeHint === 'sa';
  const preferOauth = modeHint === 'oauth' || modeHint === 'refresh_token';

  if (preferSa && saOk) {
    return { auth: 'service_account', clientEmail, privateKey, rootFolderId };
  }
  if (preferOauth && oauthOk) {
    return { auth: 'oauth', clientId, clientSecret, refreshToken, rootFolderId };
  }
  if (oauthOk) {
    return { auth: 'oauth', clientId, clientSecret, refreshToken, rootFolderId };
  }
  if (saOk) {
    return { auth: 'service_account', clientEmail, privateKey, rootFolderId };
  }
  return null;
}

/** Env-only backend (bootstrap). Prefer {@link resolveStorageBackend}. */
export function storageBackendFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): StorageBackend {
  const raw = (env.STORAGE_BACKEND ?? 'local').trim().toLowerCase();
  return raw === 'gdrive' ? 'gdrive' : 'local';
}

/**
 * Media system of record: Settings `storage.gdrive.backend` preferred when set;
 * otherwise `STORAGE_BACKEND` env; default `local`.
 */
export function resolveStorageBackend(
  settings: GDriveSettingsPartial | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): StorageBackend {
  const fromSettings = (settings?.backend ?? '').trim().toLowerCase();
  if (fromSettings === 'gdrive' || fromSettings === 'local') {
    return fromSettings;
  }
  return storageBackendFromEnv(env);
}

/**
 * Require Drive credentials when backend is gdrive. Throws a clear,
 * actionable error instead of silently writing forever-local.
 */
export function requireGDriveConfig(
  env: NodeJS.ProcessEnv = process.env,
  settings?: GDriveSettingsPartial | null,
): GDriveConfig {
  const cfg = resolveGDriveConfig(settings, env);
  if (!cfg) {
    throw new Error(
      'Google Drive is selected as the storage backend but is not configured. Use Settings → General → ' +
        'Google Drive → Connect with Google and Select folder (or paste OAuth / service-account credentials), ' +
        'set the root folder ID, and choose Google Drive as the backend — or set GOOGLE_DRIVE_* env bootstrap vars. ' +
        'For a service account, share the root folder with the SA email (Editor) or add it to a Shared Drive.',
    );
  }
  return cfg;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/** Mint a Google OAuth access token via service-account JWT assertion. */
export function buildServiceAccountAssertion(
  clientEmail: string,
  privateKey: string,
  scope: string = SERVICE_ACCOUNT_SCOPE,
  nowSec: number = Math.floor(Date.now() / 1000),
): string {
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const claim = base64UrlJson({
    iss: clientEmail,
    scope,
    aud: TOKEN_ENDPOINT,
    iat: nowSec,
    exp: nowSec + 3600,
  });
  const unsigned = `${header}.${claim}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(normalizePrivateKey(privateKey), 'base64url');
  return `${unsigned}.${signature}`;
}

/** Query params so Shared Drive folders work the same as My Drive shares. */
function driveSupportsAll(): string {
  return 'supportsAllDrives=true&includeItemsFromAllDrives=true';
}

/**
 * True when the granted OAuth scope string can browse arbitrary Drive folders
 * (full `drive` or `drive.readonly`). `drive.file` alone cannot list user folders.
 */
export function driveScopeAllowsFolderBrowse(scope: string | null | undefined): boolean {
  const parts = (scope ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.some(
    (s) =>
      s === 'https://www.googleapis.com/auth/drive' ||
      s === 'https://www.googleapis.com/auth/drive.readonly',
  );
}

/**
 * Turn a Google Drive HTTP error into actionable Settings copy.
 * Google often returns 404 notFound when the token lacks Drive access (privacy).
 */
export function formatDriveApiError(status: number, body: string, action: string): string {
  let googleMsg = '';
  let reason = '';
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: {
          message?: string;
          status?: string;
          errors?: Array<{ reason?: string; message?: string }>;
        };
      };
      googleMsg = parsed.error?.message ?? parsed.error?.errors?.[0]?.message ?? '';
      reason =
        parsed.error?.errors?.[0]?.reason ?? parsed.error?.status ?? '';
    } catch {
      /* keep raw body */
    }
  }

  const detail = (googleMsg || trimmed).slice(0, 180);
  const reconnectHint =
    'Enable Google Drive API for the Cloud project, add scope ' +
    'https://www.googleapis.com/auth/drive on the OAuth consent screen, then ' +
    'Settings → Google Drive → Disconnect and Connect with Google again.';

  if (status === 401) {
    return `${action} failed: Drive credentials expired or invalid. ${reconnectHint}`;
  }
  if (
    status === 403 ||
    reason === 'accessNotConfigured' ||
    reason === 'PERMISSION_DENIED' ||
    /has not been used|disabled|insufficient.?authentication.?scopes|ACCESS_TOKEN_SCOPE/i.test(
      detail,
    )
  ) {
    return `${action} failed: Drive permission denied. ${reconnectHint}${detail ? ` (${detail})` : ''}`;
  }
  if (status === 404 || reason === 'notFound' || /file not found/i.test(detail)) {
    return (
      `${action} failed: Google Drive returned not found. ` +
      `This usually means the token cannot see that folder (missing full drive scope) ` +
      `or the folder id is wrong. ${reconnectHint}` +
      (detail ? ` Google said: ${detail}` : '')
    );
  }
  return `${action} failed (${status})${detail ? `: ${detail}` : ''}`;
}

export class GoogleDriveClient {
  private accessToken: string | null = null;
  private accessExpiryMs = 0;
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  constructor(private readonly config: GDriveConfig) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessExpiryMs - 60_000) {
      return this.accessToken;
    }
    if (this.config.auth === 'service_account') {
      return this.refreshViaServiceAccount();
    }
    return this.refreshViaOauth();
  }

  private async refreshViaOauth(): Promise<string> {
    if (this.config.auth !== 'oauth') {
      throw new Error('OAuth refresh called without OAuth config');
    }
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: this.config.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Google Drive token refresh failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = json.access_token;
    this.accessExpiryMs = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  private async refreshViaServiceAccount(): Promise<string> {
    if (this.config.auth !== 'service_account') {
      throw new Error('Service-account refresh called without SA config');
    }
    const assertion = buildServiceAccountAssertion(
      this.config.clientEmail,
      this.config.privateKey,
    );
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Google Drive service-account token failed (${res.status}): ${body.slice(0, 200)}`,
      );
    }
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = json.access_token;
    this.accessExpiryMs = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  /**
   * List child folders under `parentId` (use `'root'` for My Drive top level).
   * Used by Settings → Select folder (no Google Picker API required).
   *
   * Service accounts have no useful My Drive root — at `root` we list folders
   * the SA can already see (shared with it / Shared Drives).
   */
  async listFolders(parentId: string = 'root'): Promise<GDriveFolderEntry[]> {
    const token = await this.getAccessToken();
    const parent = (parentId || 'root').trim() || 'root';
    const saRootBrowse = this.config.auth === 'service_account' && parent === 'root';
    const safeParent = parent.replace(/'/g, "\\'");
    const q = saRootBrowse
      ? `mimeType='application/vnd.google-apps.folder' and trashed=false`
      : [
          `mimeType='application/vnd.google-apps.folder'`,
          `'${safeParent}' in parents`,
          'trashed=false',
        ].join(' and ');
    const out: GDriveFolderEntry[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q,
        fields: 'nextPageToken,files(id,name)',
        pageSize: '100',
        orderBy: 'name',
        spaces: 'drive',
        corpora: saRootBrowse ? 'allDrives' : 'user',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await this.fetchImpl(`${DRIVE_FILES}?${params.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(formatDriveApiError(res.status, body, 'Drive folder list'));
      }
      const json = (await res.json()) as {
        nextPageToken?: string;
        files?: Array<{ id: string; name: string }>;
      };
      for (const f of json.files ?? []) {
        out.push({ id: f.id, name: f.name });
      }
      pageToken = json.nextPageToken;
    } while (pageToken);
    return out;
  }

  /**
   * Ensure a nested folder path exists under the configured root
   * (e.g. `{Account}__{id}/2026/08`). Returns the leaf folder id.
   * The first segment is matched by trailing `__{accountId}` when present so
   * account renames still reuse the same Drive folder.
   */
  async ensureFolderPath(relativePath: string): Promise<string> {
    const parts = relativePath
      .split(/[\\/]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    let parentId = this.config.rootFolderId;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      if (i === 0) {
        const accountId = accountIdFromDriveFolderName(name);
        if (accountId) {
          parentId = await this.findOrCreateAccountFolder(name, accountId, parentId);
          continue;
        }
      }
      parentId = await this.findOrCreateFolder(name, parentId);
    }
    return parentId;
  }

  /**
   * Prefer an existing child folder whose name ends with `__{accountId}`;
   * otherwise find-or-create by the exact preferred name.
   */
  private async findOrCreateAccountFolder(
    preferredName: string,
    accountId: string,
    parentId: string,
  ): Promise<string> {
    const token = await this.getAccessToken();
    const suffix = `__${accountId}`.replace(/'/g, "\\'");
    const q = [
      `name contains '${suffix}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      'trashed=false',
    ].join(' and ');
    const listUrl =
      `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=25` +
      `&${driveSupportsAll()}`;
    const listRes = await this.fetchImpl(listUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      const body = await listRes.text().catch(() => '');
      throw new Error(formatDriveApiError(listRes.status, body, 'Drive folder list'));
    }
    const listed = (await listRes.json()) as {
      files?: Array<{ id: string; name: string }>;
    };
    const exact = listed.files?.find((f) => f.name === preferredName);
    if (exact?.id) return exact.id;
    const bySuffix = listed.files?.find((f) => accountIdFromDriveFolderName(f.name) === accountId);
    if (bySuffix?.id) return bySuffix.id;

    return this.findOrCreateFolder(preferredName, parentId);
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const token = await this.getAccessToken();
    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      'trashed=false',
    ].join(' and ');
    const listUrl =
      `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1` +
      `&${driveSupportsAll()}`;
    const listRes = await this.fetchImpl(listUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      const body = await listRes.text().catch(() => '');
      throw new Error(formatDriveApiError(listRes.status, body, 'Drive folder list'));
    }
    const listed = (await listRes.json()) as { files?: Array<{ id: string }> };
    if (listed.files?.[0]?.id) return listed.files[0].id;

    const createRes = await this.fetchImpl(`${DRIVE_FILES}?fields=id&${driveSupportsAll()}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.text().catch(() => '');
      throw new Error(`Drive folder create failed (${createRes.status}): ${body.slice(0, 200)}`);
    }
    const created = (await createRes.json()) as { id: string };
    return created.id;
  }

  /**
   * Resumable multipart upload of a local file into `folderRelativePath`
   * under the library root. Sets "anyone with link can view" so the app can
   * iframe the Drive preview without requiring a Google login in the browser.
   */
  async uploadFile(input: {
    localPath: string;
    filename: string;
    mimeType: string;
    folderRelativePath: string;
    /** Optional content hash for Drive contentHints (hex md5). */
    md5Hex?: string;
  }): Promise<GDriveUploadResult> {
    const parentId = await this.ensureFolderPath(input.folderRelativePath);
    const token = await this.getAccessToken();

    const metadata: Record<string, unknown> = {
      name: input.filename,
      parents: [parentId],
    };
    if (input.md5Hex) {
      metadata.contentHints = { indexableText: `md5:${input.md5Hex}` };
    }

    // Simple multipart upload (sufficient for typical finals/thumbnails; large
    // files still work via Node streaming the multipart body as a Buffer build
    // would OOM — use resumable for big files).
    const initRes = await this.fetchImpl(
      `${DRIVE_UPLOAD}?uploadType=resumable&fields=id,md5Checksum,size,webViewLink,mimeType&${driveSupportsAll()}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': input.mimeType,
        },
        body: JSON.stringify(metadata),
      },
    );
    if (!initRes.ok) {
      const body = await initRes.text().catch(() => '');
      throw new Error(`Drive resumable init failed (${initRes.status}): ${body.slice(0, 200)}`);
    }
    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('Drive resumable init did not return a Location header.');

    const putInit = {
      method: 'PUT',
      headers: {
        'content-type': input.mimeType,
      },
      // Node fetch requires duplex when body is a stream.
      body: createReadStream(input.localPath) as unknown as NonNullable<RequestInit['body']>,
      duplex: 'half' as const,
    };
    const putRes = await this.fetchImpl(uploadUrl, putInit as RequestInit);
    if (!putRes.ok) {
      const body = await putRes.text().catch(() => '');
      throw new Error(`Drive upload failed (${putRes.status}): ${body.slice(0, 200)}`);
    }
    const file = (await putRes.json()) as {
      id: string;
      md5Checksum?: string;
      size?: string;
      webViewLink?: string;
      mimeType?: string;
    };

    await this.makeAnyoneWithLinkReader(file.id);

    return {
      fileId: file.id,
      md5Checksum: file.md5Checksum ?? null,
      size: file.size ? Number(file.size) : null,
      webViewLink: file.webViewLink ?? null,
      mimeType: file.mimeType ?? null,
    };
  }

  /** Allow iframe embed without the viewer signing into Google. */
  async makeAnyoneWithLinkReader(fileId: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await this.fetchImpl(
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}/permissions?${driveSupportsAll()}&sendNotificationEmail=false`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
          allowFileDiscovery: false,
        }),
      },
    );
    // 400 often means permission already exists — treat as ok.
    if (!res.ok && res.status !== 400) {
      const body = await res.text().catch(() => '');
      throw new Error(`Drive permission update failed (${res.status}): ${body.slice(0, 200)}`);
    }
  }

  /** Download a Drive file to a local path (publish restore / re-edit). */
  async downloadFile(fileId: string, destPath: string): Promise<void> {
    const token = await this.getAccessToken();
    await mkdir(dirname(destPath), { recursive: true });
    const res = await this.fetchImpl(
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media&${driveSupportsAll()}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`Drive download failed (${res.status}): ${body.slice(0, 200)}`);
    }
    // Convert web ReadableStream → Node Writable via pipeline when possible.
    const nodeStream = res.body as unknown as Readable;
    try {
      await pipeline(nodeStream, createWriteStream(destPath));
    } catch (err) {
      await unlink(destPath).catch(() => undefined);
      throw err;
    }
  }
}

export const GDRIVE_OAUTH_SCOPE = OAUTH_SCOPE;
export const GDRIVE_CONNECT_OAUTH_SCOPE = CONNECT_OAUTH_SCOPE;
export const GDRIVE_SERVICE_ACCOUNT_SCOPE = SERVICE_ACCOUNT_SCOPE;
