import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // No `output: 'standalone'`: pm2 runs `next start` against .next directly,
  // and standalone's symlink step fails on Windows dev machines (EPERM).
  eslint: {
    // Linting runs via `pnpm -r lint` (root flat config); avoid double-linting in build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
