'use client';

/**
 * Browser API client. All calls go to the same-origin `/api/v1/*` path, which
 * Next rewrites to the backend (see next.config.ts) so the session cookie is
 * sent automatically and stays first-party.
 */
const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  // Only set content-type when we're actually sending a body. Fastify (strict)
  // rejects a POST/PUT/PATCH with content-type: application/json but no body.
  const hasBody = init?.body != null;
  const defaultHeaders: Record<string, string> = hasBody
    ? { 'content-type': 'application/json' }
    : {};
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers: { ...defaultHeaders, ...(init?.headers ?? {}) },
  });

  if (res.status === 401 && typeof window !== 'undefined') {
    // Session gone — bounce to login.
    window.location.href = '/login';
    throw new ApiError(401, 'Not authenticated');
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (body && (body.message || body.error)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : String(message));
  }
  return body as T;
}

/**
 * Multipart upload (a File streamed as form-data). Does NOT set content-type —
 * the browser sets the multipart boundary. Same-origin + credentials as apiFetch.
 */
export async function apiUpload<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}${path}`, { method: 'POST', credentials: 'include', body: form });

  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
    throw new ApiError(401, 'Not authenticated');
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message = (body && (body.message || body.error)) || `Upload failed (${res.status})`;
    throw new ApiError(res.status, Array.isArray(message) ? message.join(', ') : String(message));
  }
  return body as T;
}

/**
 * Same as `apiUpload`, but reports byte progress. Uses XMLHttpRequest because
 * `fetch` cannot observe request-body progress.
 */
export function apiUploadWithProgress<T = unknown>(
  path: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE}${path}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed — check your connection.'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload cancelled.'));
    xhr.onload = () => {
      if (xhr.status === 401 && typeof window !== 'undefined') {
        window.location.href = '/login';
        reject(new ApiError(401, 'Not authenticated'));
        return;
      }
      let body: { message?: unknown; error?: unknown } | undefined;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = (body?.message ?? body?.error) || `Upload failed (${xhr.status})`;
        reject(
          new ApiError(xhr.status, Array.isArray(message) ? message.join(', ') : String(message)),
        );
        return;
      }
      onProgress(100);
      resolve(body as T);
    };
    xhr.send(form);
  });
}

export const api = {
  get: <T>(p: string) => apiFetch<T>(p),
  post: <T>(p: string, body?: unknown) =>
    apiFetch<T>(p, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(p: string, body?: unknown) =>
    apiFetch<T>(p, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(p: string, body?: unknown) =>
    apiFetch<T>(p, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(p: string) => apiFetch<T>(p, { method: 'DELETE' }),
  upload: <T>(p: string, file: File) => apiUpload<T>(p, file),
  uploadWithProgress: <T>(p: string, file: File, onProgress: (percent: number) => void) =>
    apiUploadWithProgress<T>(p, file, onProgress),
};
