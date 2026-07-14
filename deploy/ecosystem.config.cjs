/**
 * pm2 process definitions (docs/02 §7 — native deploy, no Docker).
 * Usage (from repo root on the VPS):
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup   # persist across reboots
 * Updates: git pull && pnpm install && pnpm build && pm2 reload all
 *
 * Env: pm2 loads the repo-root .env via `env_file` per app (pm2 >= 5.3
 * supports node --env-file through node_args as a fallback; we pass the
 * variables explicitly with dotenv semantics via `env` blocks where needed).
 * Simplest robust path: keep secrets in /home/scp/socialcreatorpilot/.env and
 * let each app read it (Nest ConfigModule, Next.js, worker read process.env +
 * .env from cwd).
 */
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'scp-web',
      cwd: path.join(ROOT, 'apps/web'),
      // `output: 'standalone'` build → self-contained server.js
      script: '.next/standalone/apps/web/server.js',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.WEB_PORT || 3000,
        HOSTNAME: '127.0.0.1',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      out_file: path.join(ROOT, 'logs/web.out.log'),
      error_file: path.join(ROOT, 'logs/web.err.log'),
      time: true,
    },
    {
      name: 'scp-api',
      cwd: path.join(ROOT, 'apps/api'),
      script: 'dist/main.js',
      node_args: ['--env-file-if-exists=../../.env'],
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '768M',
      out_file: path.join(ROOT, 'logs/api.out.log'),
      error_file: path.join(ROOT, 'logs/api.err.log'),
      time: true,
    },
    {
      name: 'scp-worker',
      cwd: path.join(ROOT, 'apps/worker'),
      script: 'dist/index.js',
      node_args: ['--env-file-if-exists=../../.env'],
      env: {
        NODE_ENV: 'production',
      },
      // 2 worker replicas (docs/02 §7). fork mode: pg-boss handles work
      // distribution through Postgres — no port sharing needed.
      instances: 2,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '2G',
      out_file: path.join(ROOT, 'logs/worker.out.log'),
      error_file: path.join(ROOT, 'logs/worker.err.log'),
      time: true,
    },
  ],
};
