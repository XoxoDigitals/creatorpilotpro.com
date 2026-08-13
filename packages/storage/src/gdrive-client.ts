import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Minimal Google Drive client for the media library (docs/02 §6).
 *
 * Auth: OAuth refresh token for the Workspace/library account (env
 * GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN). Prefer this over a
 * service account — personal/My Drive and Workspace user drives are awkward
 * with service accounts unless you use Shared Drives.
 *
 * Scope: `https://www.googleapis.com/auth/drive.file` is enough when uploading
 * into a folder the same OAuth user owns (GOOGLE_DRIVE_ROOT_FOLDER_ID).
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DEFAULT_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface GDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Drive folder id that receives SCP media (mirrored tree under it). */
  rootFolderId: string;
}

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

export type GDriveSettingsPartial = Partial<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootFolderId: string;
}>;

export function readGDriveConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GDriveConfig | null {
  return resolveGDriveConfig(null, env);
}

/**
 * Merge Settings-stored credentials (preferred when non-empty) over process env.
 * Used by API + worker so Owners can paste keys in Settings → General without
 * requiring a redeploy — env remains a bootstrap/fallback.
 */
export function resolveGDriveConfig(
  settings: GDriveSettingsPartial | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): GDriveConfig | null {
  const pick = (fromSettings: string | undefined, fromEnv: string | undefined): string => {
    const s = fromSettings?.trim();
    if (s) return s;
    return fromEnv?.trim() ?? '';
  };
  const clientId = pick(settings?.clientId, env.GOOGLE_DRIVE_CLIENT_ID);
  const clientSecret = pick(settings?.clientSecret, env.GOOGLE_DRIVE_CLIENT_SECRET);
  const refreshToken = pick(settings?.refreshToken, env.GOOGLE_DRIVE_REFRESH_TOKEN);
  const rootFolderId = pick(settings?.rootFolderId, env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
  if (!clientId || !clientSecret || !refreshToken || !rootFolderId) return null;
  return { clientId, clientSecret, refreshToken, rootFolderId };
}

export function storageBackendFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): 'local' | 'gdrive' {
  const raw = (env.STORAGE_BACKEND ?? 'local').trim().toLowerCase();
  return raw === 'gdrive' ? 'gdrive' : 'local';
}

/**
 * Require Drive credentials when STORAGE_BACKEND=gdrive. Throws a clear,
 * actionable error instead of silently writing forever-local.
 */
export function requireGDriveConfig(
  env: NodeJS.ProcessEnv = process.env,
  settings?: GDriveSettingsPartial | null,
): GDriveConfig {
  const cfg = resolveGDriveConfig(settings, env);
  if (!cfg) {
    throw new Error(
      'STORAGE_BACKEND=gdrive but Google Drive is not configured. Paste credentials in ' +
        'Settings → General → Google Drive media library, or set ' +
        'GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, ' +
        'GOOGLE_DRIVE_REFRESH_TOKEN, and GOOGLE_DRIVE_ROOT_FOLDER_ID ' +
        '(OAuth library account with Drive API enabled).',
    );
  }
  return cfg;
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
      scope?: string;
    };
    this.accessToken = json.access_token;
    this.accessExpiryMs = Date.now() + json.expires_in * 1000;
    return this.accessToken;
  }

  /**
   * Ensure a nested folder path exists under the configured root
   * (e.g. `items/{contentItemId}/final`). Returns the leaf folder id.
   */
  async ensureFolderPath(relativePath: string): Promise<string> {
    const parts = relativePath
      .split(/[\\/]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    let parentId = this.config.rootFolderId;
    for (const name of parts) {
      parentId = await this.findOrCreateFolder(name, parentId);
    }
    return parentId;
  }

  private async findOrCreateFolder(name: string, parentId: string): Promise<string> {
    const token = await this.getAccessToken();
    const q = [
      `name='${name.replace(/'/g, "\\'")}'`,
      `mimeType='application/vnd.google-apps.folder'`,
      `'${parentId}' in parents`,
      'trashed=false',
    ].join(' and ');
    const listUrl = `${DRIVE_FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const listRes = await this.fetchImpl(listUrl, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      throw new Error(`Drive folder list failed (${listRes.status})`);
    }
    const listed = (await listRes.json()) as { files?: Array<{ id: string }> };
    if (listed.files?.[0]?.id) return listed.files[0].id;

    const createRes = await this.fetchImpl(`${DRIVE_FILES}?fields=id`, {
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
      `${DRIVE_UPLOAD}?uploadType=resumable&fields=id,md5Checksum,size,webViewLink,mimeType`,
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
    const res = await this.fetchImpl(`${DRIVE_FILES}/${encodeURIComponent(fileId)}/permissions`, {
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
    });
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
      `${DRIVE_FILES}/${encodeURIComponent(fileId)}?alt=media`,
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

export const GDRIVE_OAUTH_SCOPE = DEFAULT_SCOPE;
