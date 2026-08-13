import type { NextConfig } from 'next';

// Backend origin (server-to-server). The browser always talks to the API via
// the same-origin `/api/*` rewrite below, so the session cookie is scoped to the
// web origin and readable by middleware (avoids the split-origin cookie problem).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  // No `output: 'standalone'`: pm2 runs `next start` against .next directly,
  // and standalone's symlink step fails on Windows dev machines (EPERM).
  eslint: {
    // Linting runs via `pnpm -r lint` (root flat config); avoid double-linting in build.
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      { source: '/policies', destination: '/legal', permanent: false },
      { source: '/policies/:path*', destination: '/legal/:path*', permanent: false },
    ];
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
