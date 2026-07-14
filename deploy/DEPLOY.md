# Deploy Runbook — SocialCreatorPilot (native, no Docker)

Owner decision 2026-07-14: **no Docker**. Everything runs natively on one Ubuntu VPS:
PostgreSQL 16 + Caddy under systemd, the three Node apps (`web`, `api`, `worker ×2`)
under pm2. Queues are **pg-boss** inside Postgres — there is no Redis.

## 1. First-time provisioning (fresh Ubuntu 22.04/24.04)

```bash
# as root — idempotent, safe to re-run
sudo DOMAIN=scp.example.com \
     POSTGRES_USER=scp POSTGRES_DB=scp POSTGRES_PASSWORD='<strong-pw>' \
     bash deploy/setup.sh
```

Installs: Node 24 (NodeSource) · pnpm via corepack · pm2 · PostgreSQL 16 (PGDG) ·
Caddy (auto-TLS) · ufw (only 22/80/443 open) · fail2ban (sshd jail) · ffmpeg.
Media tools (yt-dlp, Demucs, faster-whisper, Kokoro) are installed in a later phase —
the script carries a TODO marker.

## 2. App install

```bash
sudo -iu scp
git clone <repo-url> ~/socialcreatorpilot && cd ~/socialcreatorpilot
cp .env.example .env   # fill in: DATABASE_URL, MASTER_KEY, SESSION_SECRET, DOMAIN, ...
pnpm install
pnpm build
pnpm --filter @scp/db exec prisma migrate deploy
SEED_OWNER_PASSWORD='<owner-pw>' pnpm db:seed
```

## 3. Start / persist processes

```bash
pm2 start deploy/ecosystem.config.cjs   # scp-web, scp-api, scp-worker x2
pm2 save
pm2 startup                             # follow the printed command once
```

## 4. Update (zero-ish downtime)

```bash
cd ~/socialcreatorpilot
git pull
pnpm install
pnpm build
pnpm --filter @scp/db exec prisma migrate deploy
pm2 reload all
```

## 5. Operations cheatsheet

| Task | Command |
|---|---|
| Process status / logs | `pm2 status` · `pm2 logs scp-api` |
| Restart one app | `pm2 restart scp-worker` |
| Caddy reload after Caddyfile edit | `sudo systemctl reload caddy` |
| Postgres shell | `sudo -u postgres psql scp` |
| Manual DB backup | `pg_dump -U scp scp \| gzip > backup.sql.gz` (nightly Drive push lands with the `maintenance` queue) |
| Health check | `curl -s https://$DOMAIN/api/v1/health` |

## 6. Scaling notes (docs/02 §7)

- More worker throughput: `pm2 scale scp-worker <n>` (workers only need Postgres reachability).
- Move media-heavy workers to a second VPS later: same repo, run only `scp-worker` there,
  point `DATABASE_URL` at the primary.
