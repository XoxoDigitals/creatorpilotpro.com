import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed OAuth `state` (docs mission §SECURITY): HMAC-SHA256 over a JSON payload
 * with SESSION_SECRET, base64url-encoded. Carries the acting userId + wizard
 * choices across the redirect so the callback can be trusted without a session
 * cookie (top-level redirects from the provider may not carry SameSite cookies).
 *
 * Format: `<payloadB64url>.<sigB64url>`. Includes an `iat` for TTL enforcement.
 */

const STATE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signState(payload: Record<string, unknown>, secret: string): string {
  const body = { ...payload, iat: Date.now() };
  const json = b64url(Buffer.from(JSON.stringify(body), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(json).digest());
  return `${json}.${sig}`;
}

export function verifyState<T = Record<string, unknown>>(state: string, secret: string): T | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [json, sig] = parts;
  const expected = b64url(createHmac('sha256', secret).update(json!).digest());
  const a = Buffer.from(sig!);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const body = JSON.parse(fromB64url(json!).toString('utf8')) as { iat?: number } & T;
    if (typeof body.iat !== 'number' || Date.now() - body.iat > STATE_TTL_MS) return null;
    return body;
  } catch {
    return null;
  }
}
