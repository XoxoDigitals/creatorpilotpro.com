import { cookies } from 'next/headers';
import type { SessionUser } from './types';

// Server-to-server API origin (not the browser rewrite).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';
const SESSION_COOKIE = 'scp_session';

/**
 * Resolve the current user from a Server Component by forwarding the session
 * cookie to the API. Returns null when unauthenticated (middleware normally
 * redirects first, but this keeps rendering safe).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE);
  if (!token) return null;

  try {
    const res = await fetch(`${API_ORIGIN}/api/v1/auth/me`, {
      headers: { cookie: `${SESSION_COOKIE}=${token.value}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { user: SessionUser };
    return body.user;
  } catch {
    return null;
  }
}
