/**
 * PM2 process file for production (Ubuntu VPS, no Docker).
 *
 * SHARED VPS with Arashan — do not reuse Arashan names, ports, or paths.
 *   Arashan:     /var/www/arashan   PM2 `arashan`   :3000
 *   CreatorPilot:/var/www/creatorpilot
 *                PM2 `creatorpilot-web`   :333
 *                PM2 `creatorpilot-api`   :4000
 *                PM2 `creatorpilot-worker`:4100 (health only, not in Nginx)
 *
 * Start:   pm2 start /var/www/creatorpilot/ecosystem.config.cjs
 * Persist: pm2 save
 * Do NOT:  pm2 delete all | pm2 restart all | pm2 delete arashan
 *
 * `apps/web` package.json `start` is `next start --port 3000` (Arashan’s port).
 * This file starts Next with `--port 333` so the two sites can coexist.
 *
 * Single repo-root `.env` is loaded by Nest (`envFilePath`) and the worker
 * (`dotenv`). Next.js gets runtime env via PM2 `env_file`; bake NEXT_PUBLIC_*
 * at `pnpm build` time (export .env before build).
 *
 * Keep worker `instances: 1` on one host — health listens on WORKER_HEALTH_PORT
 * (default 4100). Extra replicas need distinct WORKER_HEALTH_PORT values.
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname); // /var/www/creatorpilot on the VPS
const ENV_FILE = path.join(ROOT, '.env');

module.exports = {
  apps: [
    {
      name: 'creatorpilot-web',
      cwd: ROOT,
      script: 'pnpm',
      // Bypass package.json `start` (--port 3000) so we do not clash with Arashan.
      args: '--filter @scp/web exec next start --port 333 --hostname 127.0.0.1',
      interpreter: 'none',
      env_file: ENV_FILE,
      env: {
        NODE_ENV: 'production',
        PORT: 333,
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
    },
    {
      name: 'creatorpilot-api',
      cwd: ROOT,
      script: 'pnpm',
      args: '--filter @scp/api start',
      interpreter: 'none',
      env_file: ENV_FILE,
      env: {
        NODE_ENV: 'production',
        API_PORT: 4000,
        API_HOST: '127.0.0.1',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '768M',
      time: true,
    },
    {
      name: 'creatorpilot-worker',
      cwd: ROOT,
      script: 'pnpm',
      args: '--filter @scp/worker start',
      interpreter: 'none',
      env_file: ENV_FILE,
      env: {
        NODE_ENV: 'production',
        WORKER_HEALTH_PORT: 4100,
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '2G',
      kill_timeout: 15000,
      time: true,
    },
  ],
};
