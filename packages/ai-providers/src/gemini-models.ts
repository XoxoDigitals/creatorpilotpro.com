/**
 * Gemini text-model defaults + fallback chain (cheap / mid-tier first).
 *
 * As of 2026-08, `gemini-2.5-flash` returns 404 for many new API keys
 * ("no longer available to new users"). Prefer current Flash-Lite / Flash
 * IDs and rolling aliases; never default to Pro / Ultra / thinking flagships.
 *
 * TTS / image / embedding model IDs are specialty — they do not inherit this
 * text chain (see `resolveGeminiModelChain`).
 */

/** Preferred primary for idea gen, briefs, analysis, metadata, etc. */
export const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-3.5-flash-lite';

/**
 * Ordered fallbacks after the requested model. Cheap lite → mid flash →
 * legacy IDs that still work for some keys. No Pro/Ultra.
 */
export const GEMINI_TEXT_MODEL_CHAIN: readonly string[] = [
  'gemini-3.5-flash-lite', // current cheapest Flash-Lite (new users)
  'gemini-3.1-flash-lite', // prior cost-efficient lite
  'gemini-flash-lite-latest', // rolling lite alias
  'gemini-2.5-flash-lite', // legacy lite (still valid for some keys)
  'gemini-3.5-flash', // mid-tier flash (not Pro)
  'gemini-3.6-flash', // newer mid flash if 3.5 unavailable
  'gemini-flash-latest', // rolling flash alias
  'gemini-2.5-flash', // legacy; works for older keys, 404 for many new ones
];

/** Default Gemini speech model (specialty — never walk the text chain). */
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';

/** Specialty model families that must not fall through to the text chain. */
const SPECIALTY_MODEL_RE = /tts|image|embedding|imagen|lyria|veo/i;

/** TTS requests with a text-model id (e.g. edge-neural fallback) stay on the speech model. */
export function resolveGeminiTtsModel(requested: string): string {
  const trimmed = requested.trim();
  if (trimmed && SPECIALTY_MODEL_RE.test(trimmed)) return trimmed;
  return DEFAULT_GEMINI_TTS_MODEL;
}

/**
 * Build the try-order for one request: requested model first, then the
 * cheap/mid text chain (deduped). Specialty models stay single-shot.
 */
export function resolveGeminiModelChain(requested: string): string[] {
  const trimmed = requested.trim();
  if (!trimmed) return [...GEMINI_TEXT_MODEL_CHAIN];
  if (SPECIALTY_MODEL_RE.test(trimmed)) return [trimmed];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [trimmed, ...GEMINI_TEXT_MODEL_CHAIN]) {
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/**
 * True when Google rejected the model id (404 / "no longer available" / not
 * found) — caller should try the next model rather than fail permanently.
 */
export function isGeminiModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; message?: string };
  const msg = e.message ?? '';
  if (e.status === 404) return true;
  if (/no longer available/i.test(msg)) return true;
  if (/is not found for API version|model .+ not found|not found for models\//i.test(msg)) {
    return true;
  }
  // Some gateways surface unknown models as 400 NOT_FOUND.
  if (e.status === 400 && /NOT_FOUND|not found|no longer available/i.test(msg)) {
    return true;
  }
  return false;
}
