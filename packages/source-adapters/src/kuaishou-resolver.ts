/**
 * Kuaishou direct resolver (docs/04 §1, risk R4 mitigation).
 *
 * yt-dlp has no working extractor for Kuaishou share links
 * (`v.kuaishou.com/XXXX` → `PHOTO_OTHER` share-token URLs), so we resolve them
 * ourselves the same way Kuaishou's own web player does:
 *
 *   1. Follow the share redirect with a mobile User-Agent. It lands on
 *      `v.m.chenzhongtech.com/fw/photo/<photoId>` which server-renders the page.
 *   2. The HTML embeds `window.INIT_STATE = { … }`, whose photo node carries
 *      `caption`, `userName`, `duration` and a `manifest.adaptationSet[]
 *      .representation[]` list of direct `*.kwaicdn.com/**.mp4` URLs.
 *   3. Pick the highest-resolution representation and hand the signed CDN URL
 *      back for a plain HTTP download.
 *
 * The signed URLs are short-lived, so resolve immediately before downloading.
 * If INIT_STATE parsing ever breaks, we fall back to scraping any kwaicdn mp4
 * URL out of the raw HTML.
 */

/** A Kuaishou share/photo URL we know how to resolve. */
export function isKuaishouUrl(url: string): boolean {
  return /(^|\.)(kuaishou\.com|kwai\.com|chenzhongtech\.com|kwaicdn\.com)/i.test(
    safeHost(url),
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export interface ResolvedKuaishouVideo {
  /** Direct, signed CDN mp4 URL (short-lived). */
  videoUrl: string;
  title?: string;
  author?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  /** Kuaishou's own photo id, useful as a stable sourcePlatformId. */
  photoId?: string;
}

/** Abort the page fetch after this long (Kuaishou tarpits rate-limited clients). */
const RESOLVE_TIMEOUT_MS = 30_000;

/** Desktop-ish mobile UA — Kuaishou server-renders the player for this. */
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Extract a balanced JSON object that starts at `html[start]` (which must be
 * `{`). String-aware so braces inside strings don't break the match.
 */
function extractBalancedJson(html: string, start: number): string | null {
  if (html[start] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return null;
}

/** Depth-first search for the photo node (has `caption` + `manifest`). */
function findPhotoNode(root: unknown): Record<string, unknown> | null {
  const stack: unknown[] = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const o = node as Record<string, unknown>;
    if (o.manifest && (o.caption !== undefined || o.userName !== undefined)) return o;
    for (const v of Object.values(o)) stack.push(v);
  }
  return null;
}

interface Representation {
  url?: string;
  backupUrl?: string[];
  width?: number;
  height?: number;
  fileSize?: number;
  qualityLabel?: string;
}

/** Highest-resolution representation (ties broken by fileSize). */
function pickBest(reps: Representation[]): Representation | null {
  const usable = reps.filter((r) => r.url || (r.backupUrl && r.backupUrl.length));
  if (!usable.length) return null;
  return usable.sort((a, b) => {
    const areaA = (a.width ?? 0) * (a.height ?? 0);
    const areaB = (b.width ?? 0) * (b.height ?? 0);
    if (areaB !== areaA) return areaB - areaA;
    return (b.fileSize ?? 0) - (a.fileSize ?? 0);
  })[0]!;
}

/**
 * Resolve a Kuaishou share/photo URL to a direct CDN mp4 URL + metadata.
 * Throws a descriptive error when the page can't be parsed.
 */
export async function resolveKuaishou(
  url: string,
  fetchImpl: typeof fetch = (...a) => globalThis.fetch(...a),
  timeoutMs: number = RESOLVE_TIMEOUT_MS,
): Promise<ResolvedKuaishouVideo> {
  // Hard timeout: Kuaishou tarpits (holds the socket open without responding)
  // when it rate-limits a client. Without this the worker slot hangs forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  let res: Response;
  let html: string;
  try {
    res = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': MOBILE_UA, accept: 'text/html,*/*' },
    });
    if (!res.ok) {
      throw new Error(`Kuaishou resolve returned ${res.status} for ${url}`);
    }
    // Reading the body can stall too — keep it inside the timeout window.
    html = await res.text();
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    throw new Error(
      aborted
        ? `Kuaishou resolve timed out after ${timeoutMs}ms for ${url} (likely rate-limited — retry later)`
        : `Kuaishou resolve failed for ${url}: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timer);
  }
  const finalUrl = res.url || url;

  const photoId =
    /\/fw\/photo\/([A-Za-z0-9_-]+)/.exec(finalUrl)?.[1] ??
    /[?&]photoId=([A-Za-z0-9_-]+)/.exec(finalUrl)?.[1] ??
    /\/short-video\/([A-Za-z0-9_-]+)/.exec(finalUrl)?.[1];

  // --- Preferred path: parse window.INIT_STATE for URLs + metadata ----------
  const marker = /window\.INIT_STATE\s*=\s*/.exec(html);
  if (marker) {
    const braceAt = html.indexOf('{', marker.index + marker[0].length);
    const json = braceAt === -1 ? null : extractBalancedJson(html, braceAt);
    if (json) {
      try {
        const state = JSON.parse(json) as unknown;
        const photo = findPhotoNode(state);
        if (photo) {
          const manifest = photo.manifest as
            | { adaptationSet?: Array<{ representation?: Representation[] }> }
            | undefined;
          const reps = manifest?.adaptationSet?.flatMap((a) => a.representation ?? []) ?? [];
          const best = pickBest(reps);
          const videoUrl = best?.url ?? best?.backupUrl?.[0];
          if (videoUrl) {
            const durationMs = typeof photo.duration === 'number' ? photo.duration : undefined;
            return {
              videoUrl,
              ...(typeof photo.caption === 'string' ? { title: photo.caption } : {}),
              ...(typeof photo.userName === 'string' ? { author: photo.userName } : {}),
              ...(durationMs ? { durationSec: durationMs / 1000 } : {}),
              ...(best?.width ? { width: best.width } : {}),
              ...(best?.height ? { height: best.height } : {}),
              ...(photoId ? { photoId } : {}),
            };
          }
        }
      } catch {
        /* fall through to the raw-scrape fallback */
      }
    }
  }

  // --- Fallback: scrape any kwaicdn mp4 URL straight out of the HTML --------
  const scraped = [...html.matchAll(/https:\/\/[^"'\s\\]*kwaicdn\.com\/[^"'\s\\]*\.mp4[^"'\s\\]*/g)]
    .map((m) => m[0])
    .filter(Boolean);
  if (scraped.length) {
    return {
      videoUrl: scraped[0]!,
      ...(photoId ? { photoId } : {}),
    };
  }

  throw new Error(
    `Could not extract a video URL from the Kuaishou page for ${url}. ` +
      'The page layout may have changed, or the video is private/removed.',
  );
}
