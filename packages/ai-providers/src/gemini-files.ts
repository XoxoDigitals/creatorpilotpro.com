/**
 * Gemini Files API helpers — upload local media so VIDEO_ANALYSIS can watch
 * clips larger than the ~20 MB inline_data ceiling (docs/05 §3).
 *
 * Uses the resumable upload protocol, then polls until the file is ACTIVE
 * (processed) before returning a fileUri suitable for `fileData` parts.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

const DEFAULT_BASE =
  process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiUploadedFile {
  /** `files/…` name used for GET/DELETE. */
  name: string;
  /** URI to pass as `fileData.fileUri` in generateContent. */
  uri: string;
  mimeType: string;
  state?: string;
}

export interface UploadGeminiFileOptions {
  apiKey: string;
  filePath: string;
  mimeType?: string;
  displayName?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Max time to wait for ACTIVE (default 120s). */
  readyTimeoutMs?: number;
}

function uploadRoot(baseUrl: string): string {
  // v1beta base → host root for `/upload/v1beta/files`
  return baseUrl.replace(/\/v1beta\/?$/, '');
}

/**
 * Upload a local file via Gemini's resumable protocol and wait until ACTIVE.
 */
export async function uploadGeminiFile(
  opts: UploadGeminiFileOptions,
): Promise<GeminiUploadedFile> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const mimeType = opts.mimeType ?? 'video/mp4';
  const displayName = opts.displayName ?? basename(opts.filePath);
  const s = await stat(opts.filePath);
  const numBytes = s.size;
  const bytes = await readFile(opts.filePath);

  // Step 1: start resumable upload — server returns an upload URL.
  const startRes = await fetchImpl(
    `${uploadRoot(base)}/upload/v1beta/files?key=${encodeURIComponent(opts.apiKey)}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(numBytes),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { displayName } }),
    },
  );
  if (!startRes.ok) {
    const body = await startRes.text().catch(() => '');
    throw Object.assign(
      new Error(`Gemini Files start upload failed ${startRes.status}: ${body.slice(0, 300)}`),
      { status: startRes.status },
    );
  }
  const uploadUrl =
    startRes.headers.get('x-goog-upload-url') ?? startRes.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new Error('Gemini Files: missing x-goog-upload-url on start response');
  }

  // Step 2: send bytes + finalize.
  const uploadRes = await fetchImpl(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(numBytes),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });
  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => '');
    throw Object.assign(
      new Error(`Gemini Files upload failed ${uploadRes.status}: ${body.slice(0, 300)}`),
      { status: uploadRes.status },
    );
  }
  const created = (await uploadRes.json()) as {
    file?: { name?: string; uri?: string; mimeType?: string; state?: string };
    name?: string;
    uri?: string;
    mimeType?: string;
    state?: string;
  };
  const file = created.file ?? created;
  const name = file.name;
  const uri = file.uri;
  if (!name || !uri) {
    throw new Error(
      `Gemini Files: unexpected upload response: ${JSON.stringify(created).slice(0, 400)}`,
    );
  }

  const ready = await waitGeminiFileActive({
    apiKey: opts.apiKey,
    name,
    baseUrl: base,
    fetchImpl,
    timeoutMs: opts.readyTimeoutMs ?? 120_000,
  });

  return {
    name: ready.name,
    uri: ready.uri,
    mimeType: ready.mimeType ?? mimeType,
    state: ready.state,
  };
}

export async function waitGeminiFileActive(opts: {
  apiKey: string;
  name: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<GeminiUploadedFile> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let lastState = '';

  while (Date.now() < deadline) {
    const res = await fetchImpl(
      `${base}/${opts.name}?key=${encodeURIComponent(opts.apiKey)}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(
        new Error(`Gemini Files poll failed ${res.status}: ${body.slice(0, 300)}`),
        { status: res.status },
      );
    }
    const data = (await res.json()) as {
      name?: string;
      uri?: string;
      mimeType?: string;
      state?: string;
      error?: { message?: string };
    };
    lastState = data.state ?? '';
    if (data.state === 'ACTIVE' && data.uri && data.name) {
      return {
        name: data.name,
        uri: data.uri,
        mimeType: data.mimeType ?? 'video/mp4',
        state: data.state,
      };
    }
    if (data.state === 'FAILED' || data.error) {
      throw new Error(
        `Gemini Files processing failed: ${data.error?.message ?? data.state ?? 'unknown'}`,
      );
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `Gemini Files: timed out waiting for ACTIVE (last state=${lastState || 'unknown'})`,
  );
}

/** Best-effort cleanup — ignore failures (files auto-expire ~48h). */
export async function deleteGeminiFile(opts: {
  apiKey: string;
  name: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  try {
    await fetchImpl(`${base}/${opts.name}?key=${encodeURIComponent(opts.apiKey)}`, {
      method: 'DELETE',
    });
  } catch {
    /* ignore */
  }
}
