import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { SourceProgressCallback } from './types.js';

/**
 * Plain HTTP download with exact byte-level progress (docs/04 §2).
 *
 * Used for sources we resolve ourselves to a direct CDN URL (Kuaishou), where
 * yt-dlp has no extractor. Because we own the byte counting, progress/ETA/speed
 * are exact and start ticking immediately — no parsing of a child process.
 *
 * Streams straight to disk (never buffers the file in memory) and hashes md5
 * on the way through, so a 4 GB video costs one pass and constant memory.
 */

export interface HttpDownloadResult {
  bytes: number;
  md5: string;
}

/** Abort a stalled download after this long with no completion. */
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export async function downloadWithProgress(
  url: string,
  destPath: string,
  onProgress?: SourceProgressCallback,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; referer?: string } = {},
): Promise<HttpDownloadResult> {
  const fetchImpl = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  let res: Response;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // CDNs commonly gate on a plausible UA/referer.
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        accept: '*/*',
        ...(opts.referer ? { referer: opts.referer } : {}),
      },
    });
  } catch (err) {
    clearTimeout(timer);
    const aborted = (err as Error).name === 'AbortError';
    throw new Error(
      aborted
        ? `Download timed out after ${timeoutMs}ms: ${url}`
        : `Download failed (network): ${(err as Error).message}`,
    );
  }

  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw new Error(`Download returned ${res.status} for ${url}`);
  }

  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : 0;

  const hash = createHash('md5');
  let downloaded = 0;
  const startedAt = Date.now();
  let lastEmit = 0;

  // Count + hash bytes as they stream past, emitting throttled progress.
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      downloaded += chunk.length;
      hash.update(chunk);

      const now = Date.now();
      if (onProgress && now - lastEmit >= 400) {
        lastEmit = now;
        const elapsedSec = Math.max(0.001, (now - startedAt) / 1000);
        const speedBps = Math.round(downloaded / elapsedSec);
        const percent = total > 0 ? Math.min(99.9, (downloaded / total) * 100) : 0;
        const remaining = total > 0 ? total - downloaded : 0;
        onProgress({
          percent,
          ...(speedBps > 0 ? { speedBps } : {}),
          ...(total > 0 && speedBps > 0 ? { etaSec: Math.round(remaining / speedBps) } : {}),
        });
      }
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(destPath),
    );
  } catch (err) {
    throw new Error(`Download stream failed for ${url}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  onProgress?.({ percent: 100 });
  return { bytes: downloaded, md5: hash.digest('hex') };
}
