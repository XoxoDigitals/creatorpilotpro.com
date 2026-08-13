import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'scp_session';

/**
 * Route protection (docs/08 §1): dashboard routes require a session cookie;
 * unauthenticated hits redirect to /login. Authenticated hits on /login bounce
 * to /dashboard. This is a coarse presence check — the API validates the cookie
 * on every request (this only avoids rendering the shell for logged-out users).
 *
 * Public (not matched): `/`, `/legal/*`, `/policies/*`, and other non-dashboard
 * marketing/compliance routes — no forced login.
 */
export function middleware(req: NextRequest): NextResponse {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const { pathname } = req.nextUrl;

  if (pathname === '/login') {
    if (hasSession) return NextResponse.redirect(new URL('/dashboard', req.url));
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL('/login', req.url);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Protect the dashboard route group and /login only. Do not add `/`, `/legal`,
// or `/policies` here — those must stay reachable for OAuth app review.
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/accounts/:path*',
    '/sources/:path*',
    '/review/:path*',
    '/ideas/:path*',
    '/dramas/:path*',
    '/calendar/:path*',
    '/analytics/:path*',
    '/incidents/:path*',
    '/workers/:path*',
    '/settings/:path*',
    '/login',
  ],
};
