/**
 * Pull unique http(s) video URLs out of messy share/paste text.
 *
 * Kwai/Kuaishou (and others) wrap a short link in quotes, Chinese tags, and
 * promo copy. Bulk import used to split on whitespace, so that junk became
 * fake "URLs". This keeps only parseable http(s) links — including
 * `v.kuaishou.com`, kwai/chenzhongtech hosts, and anything else GENERIC_URL
 * already accepts via yt-dlp.
 */

const URL_RE = /https?:\/\/[^\s<>"'`|[\]{}\\^“”‘’«»「」『』【】]+/gi;

/** Trailing punctuation / quotes that share apps glue onto the link. */
const TRAILING_PUNCT =
  /[.,;:!?…。，；：！？、'"“”‘’«»「」『』【】（）]+$/u;

export function extractVideoUrls(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    const candidate = sanitizeUrlCandidate(match[0] ?? '');
    if (!candidate) continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    if (!parsed.hostname) continue;
    const key = canonicalKey(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed.href);
  }
  return out;
}

/** First http(s) URL in messy text, if any — for single-URL fields. */
export function extractFirstVideoUrl(text: string): string | undefined {
  return extractVideoUrls(text)[0];
}

function sanitizeUrlCandidate(raw: string): string {
  let s = raw.trim();
  for (;;) {
    const next = s.replace(TRAILING_PUNCT, '');
    if (next === s) break;
    s = next;
  }
  s = stripUnbalanced(s, '(', ')');
  s = stripUnbalanced(s, '[', ']');
  return s;
}

function stripUnbalanced(s: string, open: string, close: string): string {
  while (s.endsWith(close)) {
    const opens = s.split(open).length - 1;
    const closes = s.split(close).length - 1;
    if (closes <= opens) break;
    s = s.slice(0, -1);
  }
  return s;
}

function canonicalKey(u: URL): string {
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? `:${u.port}` : ''}${u.pathname}${u.search}`;
}
