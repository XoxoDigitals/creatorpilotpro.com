# SocialCreatorPilot (creatorpilotpro) — Server Blueprint

Production layout for **https://app.creatorpilotpro.com** on a Contabo-style Ubuntu VPS.

**No Docker.** Stack is **Nginx + PM2 + native PostgreSQL + Node.js 24** (pnpm monorepo: Next.js web + NestJS API + worker).

---

## SHARED VPS — do not touch Arashan

This box already serves **https://arashan.co.uk** (`94.72.103.120`). CreatorPilot is a **second site** on the same Nginx / PM2 / PostgreSQL daemon. Add only new resources. **Never** remove, overwrite, restart, or dump into Arashan.

| Resource | Arashan (**leave alone**) | CreatorPilot (**new only**) |
|----------|---------------------------|-----------------------------|
| App path | `/var/www/arashan` | `/var/www/creatorpilot` |
| PM2 names | `arashan` | `creatorpilot-web`, `creatorpilot-api`, `creatorpilot-worker` |
| Nginx site file | `arashan.co.uk` (and `sites-enabled/default` if Arashan needs it) | **Only** `app.creatorpilotpro.com` |
| Database | `arashan` / user `arashan` | **New** DB+user `creatorpilot` / `creatorpilot` |
| Listen ports | **3000** (Next) | Web **333**, API **4000**, worker health **4100** |
| Postgres port | `5432` (shared daemon) | `5432` (same daemon, **separate database**) |
| Certbot | `arashan.co.uk` + `www` | **Only** `-d app.creatorpilotpro.com` |
| UFW | Already may be active | Do **not** `ufw --force enable`; do **not** restart/delete `arashan` |

Hard rules:

- Do **not** `rm` `/etc/nginx/sites-enabled/arashan.co.uk` or `sites-enabled/default` if Arashan uses them.
- Do **not** `pm2 delete arashan`, `pm2 restart arashan`, `pm2 delete all`, or `pm2 restart all`.
- Do **not** `pg_restore` / `DROP` / grant into database `arashan`.
- Do **not** run `deploy/setup.sh` or `deploy/Caddyfile` (those target **Caddy** + `/home/scp/socialcreatorpilot`).
- Do **not** `ufw --force enable` (risk of locking SSH or changing Arashan’s live firewall).

---

## 1. Live environment

| Item | Value |
|------|--------|
| Domain | `app.creatorpilotpro.com` |
| Server IP | `94.72.103.120` (same Contabo VPS as Arashan) |
| Host example | `vmi3497350` |
| OS | Ubuntu (native) |
| App path | `/var/www/creatorpilot` |
| Repo | `https://github.com/XoxoDigitals/creatorpilotpro.com.git` |
| Process manager | PM2 (`creatorpilot-web`, `creatorpilot-api`, `creatorpilot-worker`) |
| Ecosystem file | `/var/www/creatorpilot/ecosystem.config.cjs` |
| Reverse proxy | Nginx → web **`:333`**, API **`:4000`** |
| TLS | Certbot (Let’s Encrypt) — **only** `app.creatorpilotpro.com` |
| Database | **New** PostgreSQL DB on localhost (not Arashan) |
| DB name / user | `creatorpilot` / `creatorpilot` (placeholder password; set a strong one) |
| Storage (hot) | `/var/www/creatorpilot/.data/storage` (`STORAGE_ROOT`) |
| Queues | pg-boss inside Postgres (schema `pgboss`, **no Redis**) |
| Node | **24** (`engines.node: ">=24"`) |
| Package manager | pnpm **11.13.0** via Corepack (`packageManager` in root `package.json`) |

### Ports

| Port | Process | Public? | Notes |
|------|---------|---------|--------|
| **80 / 443** | Nginx | **Yes** | Only public HTTP(S). Shared with Arashan. |
| **333** | Next.js `@scp/web` | Localhost only | UFW deny. **Not** 3000 (Arashan). |
| **4000** | NestJS `@scp/api` (`API_PORT`) | Localhost only | UFW deny |
| **4100** | Worker health `GET /health` (`WORKER_HEALTH_PORT`) | Localhost only | **Do not** proxy in Nginx |
| **5432** | PostgreSQL | Localhost only | Shared Postgres daemon; **new DB** |
| **3000** | **Arashan** Next.js | Localhost only | **Do not bind CreatorPilot here** |

Dev note: `apps/web` `dev` already uses port **333**. Package.json `start` is still `next start --port 3000`. Production **must** use `ecosystem.config.cjs`, which runs `next start --port 333 --hostname 127.0.0.1` and sets `PORT=333`.

---

## 2. Architecture

```
Internet
   │
   ▼
Nginx :80 / :443  (TLS)
   │
   ├── arashan.co.uk          →  PM2 arashan           :3000   (DO NOT TOUCH)
   └── app.creatorpilotpro.com
          ├── /          →  Next.js  (PM2 creatorpilot-web)    :333
          ├── /api       →  NestJS   (PM2 creatorpilot-api)    :4000
          │                 (/api/v1/*, /api/docs)
          └── (worker health NOT proxied)
                 │
                 ├── worker (PM2 creatorpilot-worker) :4100 on 127.0.0.1 only
                 └── PostgreSQL :5432
                        ├── DB arashan        (leave alone)
                        └── DB creatorpilot   + schema pgboss
```

- Public traffic only hits **80/443**.
- Browser calls **same-origin** `/api/v1/*` (`apps/web/src/lib/api.ts`, `BASE = '/api/v1'`). Nginx `location /api` goes straight to Nest. Next also rewrites `/api/:path*` → `API_ORIGIN` (`apps/web/next.config.ts`) for anything that still hits the web process.
- Next **server** components talk to the API via `API_ORIGIN` (set to `http://127.0.0.1:4000`, not the public hostname).
- Auth: signed HttpOnly cookie **`scp_session`** (SameSite=Lax, Secure in production). Signing secret = `SESSION_SECRET`. No `COOKIE_*` env var — name is hardcoded.
- OAuth redirect URIs are built from `WEB_APP_URL` as  
  `{WEB_APP_URL}/api/v1/accounts/connect/{google|meta|tiktok}/callback`.
- Data: Prisma (`packages/db`) + `DATABASE_URL`. Secrets at rest: AES-256-GCM with `MASTER_KEY`.

---

## 3. Required packages (server)

Postgres / Nginx / Certbot / UFW / PM2 may already exist from Arashan. Install only what is missing. **Check `node -v` before upgrading** — Arashan may be on Node 20; this app **requires Node 24**. Confirm `pm2 status` still shows **`arashan` online** after any system Node change. Do **not** restart the `arashan` process unless it actually died.

```bash
apt update
apt install -y nginx postgresql postgresql-contrib certbot python3-certbot-nginx \
  ufw git curl ca-certificates gnupg ffmpeg python3-pip python3-venv

# Node.js 24 (NodeSource) — skip if node -v already shows v24
node -v
# only if not v24:
# curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
# apt install -y nodejs
node -v   # expect v24.x
pm2 status   # arashan must still be online

# pnpm 11.13.0 (matches packageManager)
corepack enable
corepack prepare pnpm@11.13.0 --activate
pnpm -v

# skip if pm2 already installed for Arashan
command -v pm2 || npm install -g pm2

# Media CLIs — leave FFMPEG_PATH / YT_DLP_PATH / EDGE_TTS_BIN unset on Linux
# (worker auto-resolves PATH, /usr/bin, /usr/local/bin, ~/.local/bin)
pip3 install -U yt-dlp edge-tts
# Optional (heavy): faster-whisper / openai-whisper, demucs
```

---

## 4. PostgreSQL setup (new dedicated DB)

**Do not** `pg_restore` from Arashan. **Do not** grant this user on the `arashan` database. Placeholder password below is `creatorpilot` — change it before go-live.

```bash
sudo -u postgres psql
```

```sql
CREATE USER creatorpilot WITH PASSWORD 'creatorpilot';
CREATE DATABASE creatorpilot OWNER creatorpilot;
GRANT ALL PRIVILEGES ON DATABASE creatorpilot TO creatorpilot;
\c creatorpilot
GRANT USAGE, CREATE ON SCHEMA public TO creatorpilot;
ALTER SCHEMA public OWNER TO creatorpilot;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO creatorpilot;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO creatorpilot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO creatorpilot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO creatorpilot;
\q
```

Verify (must print `creatorpilot` / `creatorpilot`, **not** `arashan`):

```bash
psql -h 127.0.0.1 -U creatorpilot -d creatorpilot -c "SELECT current_database(), current_user;"
```

### After restore (important)

`pg_restore` often leaves tables owned by `postgres`. The app user then gets `permission denied`.

Fix once after restore (**database `creatorpilot` only**):

```bash
sudo -u postgres psql -d creatorpilot
```

```sql
GRANT USAGE, CREATE ON SCHEMA public TO creatorpilot;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO creatorpilot;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO creatorpilot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO creatorpilot;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO creatorpilot;

-- Prefer owning everything as the app role:
REASSIGN OWNED BY postgres TO creatorpilot;
-- Or ALTER TABLE ... OWNER TO creatorpilot; for each table if REASSIGN fails.

\dt
\q
```

After `prisma migrate deploy`, pg-boss creates schema **`pgboss`** automatically on first worker start.

---

## 5. Migrate data (local → server) — optional, THIS DB only

Skip on a fresh install; use `prisma migrate deploy` instead (section 6).

If you already have a **local `creatorpilot` / `scp` database** to copy, dump **that** database only. **Never** dump or restore `arashan`.

On **local** (Windows example):

```powershell
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -Fc -f creatorpilot.dump "postgresql://USER:PASS@localhost:5432/creatorpilot"
```

Copy dump to server (`/tmp/creatorpilot.dump`), then:

```bash
# restore ONLY into creatorpilot — never -d arashan
sudo -u postgres pg_restore -d creatorpilot --clean --if-exists /tmp/creatorpilot.dump
# then apply ownership/grants from section 4
```

Also ensure `STORAGE_ROOT` (`/var/www/creatorpilot/.data/storage`) exists on the server (media is not inside the SQL dump).

---

## 6. App deploy

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/XoxoDigitals/creatorpilotpro.com.git creatorpilot
cd /var/www/creatorpilot
```

### `.env` (production) — `/var/www/creatorpilot/.env`

One file at **repo root**. Names match `.env.example` plus `WEB_APP_URL` / `WORKER_HEALTH_PORT` (used in code, not listed in the example file). API loads `.env` then `../../.env`; worker dotenv does the same. Export this file **before** `pnpm build` so `NEXT_PUBLIC_*` is inlined.

Generate secrets:

```bash
openssl rand -base64 32   # MASTER_KEY (must decode to exactly 32 bytes)
openssl rand -base64 48   # SESSION_SECRET
```

```env
NODE_ENV=production

# --- Core / DB (dedicated creatorpilot DB — not arashan) ---
DATABASE_URL="postgresql://creatorpilot:creatorpilot@127.0.0.1:5432/creatorpilot?schema=public"

# --- Secrets (required) ---
MASTER_KEY="PASTE_32_BYTE_BASE64"
SESSION_SECRET="PASTE_LONG_RANDOM"

# --- API (Nest @scp/api) ---
API_PORT=4000
API_HOST=127.0.0.1
CORS_ORIGINS="https://app.creatorpilotpro.com"
WEB_APP_URL="https://app.creatorpilotpro.com"
APP_VERSION="0.0.0"

# --- Web (Next @scp/web) ---
# Browser uses same-origin /api/v1 (hardcoded). NEXT_PUBLIC_API_URL is for turbo / any leftover client.
NEXT_PUBLIC_API_URL="https://app.creatorpilotpro.com/api/v1"
# Next server → API (SSR auth/me). Must be loopback, not the public host.
API_ORIGIN="http://127.0.0.1:4000"
# Informational + ecosystem PORT. Production listen is 333 (not 3000).
WEB_PORT=333
NEXT_PUBLIC_SITE_URL="https://app.creatorpilotpro.com"

# Legal / OAuth app review copy (public pages /legal/*)
NEXT_PUBLIC_LEGAL_COMPANY_NAME="Xoxo Digitals"
NEXT_PUBLIC_LEGAL_EMAIL="privacy@creatorpilotpro.com"
NEXT_PUBLIC_SUPPORT_EMAIL="support@creatorpilotpro.com"
NEXT_PUBLIC_LEGAL_ADDRESS="[Street Address], [City], [Country]"
NEXT_PUBLIC_LEGAL_EFFECTIVE_DATE="2026-01-01"

# --- Worker ---
WORKER_CONCURRENCY=4
WORKER_HEALTH_PORT=4100

# --- Storage ---
STORAGE_BACKEND=local
STORAGE_ROOT=/var/www/creatorpilot/.data/storage

# --- Seed (only for pnpm db:seed; Owner email saboor@xoxodigitals.com) ---
SEED_OWNER_PASSWORD="change-me-owner-password"

# --- Optional: Google Drive library (or configure in Settings → General) ---
# STORAGE_BACKEND=gdrive
# GOOGLE_DRIVE_CLIENT_ID=""
# GOOGLE_DRIVE_CLIENT_SECRET=""
# GOOGLE_DRIVE_REFRESH_TOKEN=""
# GOOGLE_DRIVE_ROOT_FOLDER_ID=""

# --- Optional bootstrap AI / YouTube (keys usually live encrypted in DB) ---
# GEMINI_API_KEY=""
# OPENAI_API_KEY=""
# YOUTUBE_DATA_API_KEY=""
# KOKORO_URL="http://127.0.0.1:8880"

# --- Optional notifications / PostQued ---
# POSTQUED_API_URL="https://api.postqued.com"
# TELEGRAM_BOT_TOKEN=""
# SMTP_URL=""

# --- Media binaries: leave UNSET on Linux (auto-detect) ---
# FFMPEG_PATH=
# FFPROBE_PATH=
# YT_DLP_PATH=
# WHISPER_BIN=
# DEMUCS_PATH=
# EDGE_TTS_BIN=
# WHISPER_MODEL=base

# Unused on this Nginx VPS (legacy Caddy deploy/setup.sh):
# DOMAIN=app.creatorpilotpro.com
# POSTGRES_USER=creatorpilot
# POSTGRES_PASSWORD=
# POSTGRES_DB=creatorpilot
```

#### Env checklist (every name the server `.env` may need)

| Variable | Required in prod | Purpose |
|----------|------------------|---------|
| `NODE_ENV` | yes | `production` (Secure cookie, etc.) |
| `DATABASE_URL` | yes | Prisma + pg-boss (**creatorpilot** DB) |
| `MASTER_KEY` | yes | AES-256-GCM vault (32 bytes, base64 or hex) |
| `SESSION_SECRET` | yes | Cookie HMAC; API **refuses to start** without it |
| `API_PORT` | yes | Nest listen (**4000**) |
| `API_HOST` | yes | Bind **127.0.0.1** in prod |
| `CORS_ORIGINS` | yes | `https://app.creatorpilotpro.com` |
| `WEB_APP_URL` | yes | OAuth redirects + post-connect UI redirects (used in API; not in `.env.example`) |
| `APP_VERSION` | no | `GET /api/v1/health` |
| `NEXT_PUBLIC_API_URL` | bake at build | Documented public API base (`…/api/v1`); browser client uses relative `/api/v1` |
| `API_ORIGIN` | yes | Next SSR → `http://127.0.0.1:4000` |
| `WEB_PORT` | informational | PM2 / ecosystem uses **333**; do not use 3000 |
| `NEXT_PUBLIC_SITE_URL` | bake at build | Legal pages / public origin |
| `NEXT_PUBLIC_LEGAL_*` | bake at build | Company, emails, address, effective date |
| `WORKER_CONCURRENCY` | no | Default `4` |
| `WORKER_HEALTH_PORT` | no | Default **4100** (used in worker; not in `.env.example`) |
| `SEED_OWNER_PASSWORD` | seed only | `pnpm db:seed` |
| `STORAGE_BACKEND` | yes | `local` or `gdrive` |
| `STORAGE_ROOT` | yes (media) | Absolute hot-tier path |
| `GOOGLE_DRIVE_*` | if gdrive | Client ID/secret/refresh/root folder |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` | no | Optional bootstrap; prefer Settings vault |
| `YOUTUBE_DATA_API_KEY` | no | Competitor resolve; prefer Platform Apps |
| `KOKORO_URL` / `KOKORO_INPROC` | no | Local TTS HTTP / in-process |
| `POSTQUED_API_URL` | no | TikTok bridge |
| `TELEGRAM_BOT_TOKEN` / `SMTP_URL` | no | Notifications |
| `FFMPEG_PATH` / `FFPROBE_PATH` / `YT_DLP_PATH` / `WHISPER_BIN` / `DEMUCS_PATH` / `EDGE_TTS_BIN` | **unset** | Auto-resolved on Linux |
| Cookie | n/a | Name **`scp_session`**; signed with `SESSION_SECRET`; Secure + HttpOnly + SameSite=Lax |

#### OAuth redirect URIs (Google / Meta / TikTok consoles)

Register exactly (HTTPS, no trailing slash on host):

```
https://app.creatorpilotpro.com/api/v1/accounts/connect/google/callback
https://app.creatorpilotpro.com/api/v1/storage/gdrive/connect/callback
https://app.creatorpilotpro.com/api/v1/accounts/connect/meta/callback
https://app.creatorpilotpro.com/api/v1/accounts/connect/tiktok/callback
```

Same Google OAuth client for YouTube + Drive; both redirect URIs must be listed.

Privacy / site URL for app review: `https://app.creatorpilotpro.com` and `/legal/*`.

### Install / build / migrate / run

```bash
cd /var/www/creatorpilot
mkdir -p /var/www/creatorpilot/.data/storage logs
# Next.js reads apps/web/.env (pnpm --filter runs with that cwd)
ln -sfn /var/www/creatorpilot/.env /var/www/creatorpilot/apps/web/.env

set -a
source /var/www/creatorpilot/.env
set +a

pnpm install
pnpm --filter @scp/db generate
pnpm --filter @scp/db exec prisma migrate deploy
pnpm build

# Optional first Owner + default AI provider rows:
# SEED_OWNER_PASSWORD='…' pnpm db:seed

pm2 start /var/www/creatorpilot/ecosystem.config.cjs
pm2 save
# If pm2 startup systemd is already configured for Arashan, do NOT re-run it
# and do NOT restart arashan. Only if this VPS has never had pm2 startup:
#   pm2 startup systemd -u root --hp /root
#   # run the command pm2 prints, then:
#   pm2 save
```

Health (localhost — CreatorPilot ports, **not** 3000):

```bash
curl -I http://127.0.0.1:333
curl -s http://127.0.0.1:4000/api/v1/health
curl -s http://127.0.0.1:4100/health
# Arashan still on 3000:
curl -I http://127.0.0.1:3000
```

Expect Next headers on **333**, JSON `{ ok: … }` from API and worker, and Arashan still answering on **3000**.

---

## 7. Nginx

**New site only.** Leave `/etc/nginx/sites-available/arashan.co.uk` and `/etc/nginx/sites-enabled/arashan.co.uk` untouched. Do **not** `rm` `sites-enabled/default` if Arashan already relies on it.

`/etc/nginx/sites-available/app.creatorpilotpro.com`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name app.creatorpilotpro.com;

    # Manual video upload cap in API is 4 GB
    client_max_body_size 4G;

    location /api {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_request_buffering off;
    }

    location / {
        proxy_pass http://127.0.0.1:333;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

`proxy_pass` to `:4000` has **no trailing slash** — URI `/api/v1/...` is forwarded unchanged (Nest global prefix is `api/v1`). `location /api` also covers Swagger `/api/docs`.

Enable:

```bash
ln -sf /etc/nginx/sites-available/app.creatorpilotpro.com /etc/nginx/sites-enabled/app.creatorpilotpro.com
nginx -t
systemctl reload nginx
curl -I -H "Host: app.creatorpilotpro.com" http://127.0.0.1
curl -I -H "Host: arashan.co.uk" http://127.0.0.1
```

Do **not** expose `:4100` in Nginx. Do **not** `systemctl restart nginx` unless reload is insufficient — reload is enough and safer for the live Arashan vhost.

---

## 8. DNS

At the registrar for **creatorpilotpro.com** only (do not change `arashan.co.uk` records):

| Type | Name | Value |
|------|------|--------|
| A | `app` | `94.72.103.120` |

Check:

```bash
dig +short app.creatorpilotpro.com
```

Must return `94.72.103.120` before Certbot.

---

## 9. TLS (Certbot)

Ports **80** and **443** must already be reachable (Arashan uses them). Certbot **only**:

```bash
certbot --nginx -d app.creatorpilotpro.com --non-interactive --agree-tos -m support@creatorpilotpro.com --redirect
curl -I https://app.creatorpilotpro.com
curl -I https://arashan.co.uk
certbot certificates
```

Do **not** pass `-d arashan.co.uk`. Confirm Arashan certs still list with `certbot certificates`.

Also open **80/443** in any Contabo/panel firewall if present (likely already open for Arashan).

---

## 10. Firewall (final)

Arashan may already have UFW **active**. **Allow SSH first.** Deny CreatorPilot app ports from the internet. Postgres should already be localhost-only.

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw deny 333/tcp
ufw deny 4000/tcp
ufw deny 4100/tcp
ufw deny 5432/tcp
# 3000 should already be denied for Arashan; do not delete that rule
# DO NOT run: ufw --force enable
ufw status
```

Do **not** enable fail2ban until SSH (keys) is stable.

---

## 11. Day-2 operations

### Update code

```bash
cd /var/www/creatorpilot
git pull
set -a; source .env; set +a
pnpm install
pnpm --filter @scp/db generate
pnpm build
pm2 restart creatorpilot-web creatorpilot-api creatorpilot-worker
# do NOT: pm2 restart arashan  |  pm2 restart all
```

### After `.env` change

Rebuild if any `NEXT_PUBLIC_*` changed. Then restart **only** the three CreatorPilot PM2 apps.

```bash
cd /var/www/creatorpilot
set -a; source .env; set +a
pnpm build
pm2 restart creatorpilot-web creatorpilot-api creatorpilot-worker
```

### After Prisma schema change

```bash
cd /var/www/creatorpilot
set -a; source .env; set +a
pnpm --filter @scp/db exec prisma migrate deploy
pnpm build
pm2 restart creatorpilot-web creatorpilot-api creatorpilot-worker
```

### Seed Owner (empty DB only)

```bash
cd /var/www/creatorpilot
set -a; source .env; set +a
pnpm db:seed
```

Login: `saboor@xoxodigitals.com` / `SEED_OWNER_PASSWORD`.

### Logs / status

```bash
pm2 status
pm2 logs creatorpilot-api --lines 80
pm2 logs creatorpilot-worker --lines 80
pm2 logs creatorpilot-web --lines 80
```

### DB connectivity

```bash
cd /var/www/creatorpilot
set -a; source .env; set +a
psql "$DATABASE_URL" -c "SELECT current_database(), current_user;"
```

Must show database `creatorpilot`, not `arashan`.

---

## 12. Known gotchas

1. **Shared VPS with Arashan**  
   New Nginx site + new Postgres DB + new PM2 names only. Never drop `arashan` DB, never `pm2 delete all`, never replace Arashan `server_name`, never bind CreatorPilot to **3000**.

2. **Web port 333 vs package.json `start`**  
   `apps/web` `start` is `next start --port 3000`. Always start web via `ecosystem.config.cjs` (`PORT=333` + `next start --port 333`). A naive `pnpm --filter @scp/web start` on this VPS would collide with Arashan.

3. **Node 24 vs Arashan Node 20**  
   System-wide NodeSource 24 can change the node `pm2` uses after a host reboot. Verify `pm2 describe arashan` / `curl -I http://127.0.0.1:3000` still works after upgrade. Do not `pm2 restart arashan` “just in case”.

4. **Do not run `deploy/setup.sh`**  
   It installs **Caddy**, fail2ban, and assumes `/home/scp/socialcreatorpilot`. This blueprint is Nginx + `/var/www/creatorpilot`.

5. **`SESSION_SECRET` missing**  
   API exits: `SESSION_SECRET is not set — refusing to start`.

6. **`MASTER_KEY` wrong length**  
   Must decode to **32 bytes** (`openssl rand -base64 32`). Changing it later makes existing encrypted tokens/keys unreadable.

7. **`NEXT_PUBLIC_*` not in build**  
   Must `source .env` before `pnpm build`. Runtime `.env` alone will not update client legal URLs.

8. **`API_ORIGIN` must be loopback**  
   `http://127.0.0.1:4000`. Pointing it at `https://app.creatorpilotpro.com` makes Next SSR hairpin through Nginx. Symlink root `.env` → `apps/web/.env` so `next start` sees it.

9. **Nginx `proxy_pass` trailing slash**  
   `http://127.0.0.1:4000` (no `/`). A trailing slash would strip `/api` and break Nest (`api/v1` global prefix).

10. **Worker health port clash**  
    One worker process per host unless you set distinct `WORKER_HEALTH_PORT` (4100, 4101, …). Keep `instances: 1` in `ecosystem.config.cjs` unless you do that. Worker currently binds `0.0.0.0:4100` — rely on UFW deny.

11. **PG 15+ `public` schema**  
    App user needs `USAGE, CREATE` on `public` (section 4). Fresh migrate — no Arashan dump.

12. **Certbot timeout**  
    DNS OK but port 80 blocked (UFW or Contabo firewall). Do not re-issue Arashan certs.

13. **`ufw --force enable`**  
    Do not run it. If UFW is already on from Arashan, only add allow/deny rules. Forcing enable can drop SSH or change live policy.

14. **EDGE_TTS_BIN**  
    Leave unset on Linux. A Windows `.exe` path copied from local `.env` will be ignored if the file does not exist, but keep the var empty to avoid confusion.

15. **Copy-paste in VNC**  
    Prefer one command per line.

16. **Secrets in chat**  
    Rotate DB password, `MASTER_KEY`, and `SESSION_SECRET` if they were shared. Prefer SSH keys. Placeholder DB password `creatorpilot` must be changed.

---

## 13. Quick verify checklist

```bash
pm2 status
node -v && pnpm -v
curl -I http://127.0.0.1:333
curl -s http://127.0.0.1:4000/api/v1/health
curl -s http://127.0.0.1:4100/health
curl -I http://127.0.0.1:3000
curl -I https://app.creatorpilotpro.com
curl -s https://app.creatorpilotpro.com/api/v1/health
curl -I https://arashan.co.uk
psql -h 127.0.0.1 -U creatorpilot -d creatorpilot -c "SELECT current_user;"
sudo -u postgres psql -d creatorpilot -c "\dt"
certbot certificates
ufw status
ss -lntp | grep -E ':333|:4000|:4100|:3000|:5432|:80|:443'
```

App: `https://app.creatorpilotpro.com/login`  
Swagger (optional, public via `/api`): `https://app.creatorpilotpro.com/api/docs`  
Arashan must still work: `https://arashan.co.uk`

---

## 14. Stack summary

| Layer | Choice |
|-------|--------|
| Web | Next.js 15 (`@scp/web`) — prod **:333** (Arashan keeps **:3000**) |
| API | NestJS + Fastify (`@scp/api`) — **:4000**, prefix `/api/v1` |
| Worker | `@scp/worker` + pg-boss — health **:4100** `/health` |
| Auth | DB sessions + signed cookie `scp_session` |
| DB | PostgreSQL (local), DB/user `creatorpilot`, Prisma migrations |
| Queue | pg-boss (Postgres schema `pgboss`, no Redis) |
| Process | PM2 (`ecosystem.config.cjs` at repo root) |
| Proxy / TLS | Nginx + Certbot (`app.creatorpilotpro.com` only) |
| Files | Local `STORAGE_ROOT` (+ optional Google Drive) |
| Media | ffmpeg, yt-dlp, edge-tts (optional whisper/demucs/Kokoro) |
| Deploy model | Native Ubuntu (no Docker Compose) |
| Domain | `app.creatorpilotpro.com` → `94.72.103.120` |
| Isolation | Path `/var/www/creatorpilot`, new DB, new PM2 names, no Arashan restarts |

---

## 15. First-time install — ordered commands (shared VPS)

Copy-paste in order on Ubuntu. Stop if Arashan health fails. Do **not** `--force enable` UFW. Do **not** restart/delete `arashan`.

```bash
# --- 0. Confirm Arashan is live (stop if this fails) ---
pm2 status
curl -I http://127.0.0.1:3000
curl -I -H "Host: arashan.co.uk" http://127.0.0.1

# --- 1. Packages (idempotent if already installed) ---
apt update
apt install -y nginx postgresql postgresql-contrib certbot python3-certbot-nginx \
  ufw git curl ca-certificates gnupg ffmpeg python3-pip python3-venv

# --- 2. Node 24 + pnpm 11.13 + pm2 (skip NodeSource if already v24) ---
node -v
# If NOT v24:
# curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
# apt install -y nodejs
node -v
pm2 status
corepack enable
corepack prepare pnpm@11.13.0 --activate
pnpm -v
command -v pm2 || npm install -g pm2
pip3 install -U yt-dlp edge-tts

# --- 3. Postgres: NEW db+user only (placeholder password creatorpilot) ---
sudo -u postgres psql -c "CREATE USER creatorpilot WITH PASSWORD 'creatorpilot';" || true
sudo -u postgres psql -c "CREATE DATABASE creatorpilot OWNER creatorpilot;" || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE creatorpilot TO creatorpilot;"
sudo -u postgres psql -d creatorpilot -c "GRANT USAGE, CREATE ON SCHEMA public TO creatorpilot;"
sudo -u postgres psql -d creatorpilot -c "ALTER SCHEMA public OWNER TO creatorpilot;"
sudo -u postgres psql -d creatorpilot -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO creatorpilot;"
sudo -u postgres psql -d creatorpilot -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO creatorpilot;"
sudo -u postgres psql -d creatorpilot -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO creatorpilot;"
sudo -u postgres psql -d creatorpilot -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO creatorpilot;"
psql -h 127.0.0.1 -U creatorpilot -d creatorpilot -c "SELECT current_database(), current_user;"

# --- 4. App checkout ---
mkdir -p /var/www
cd /var/www
git clone https://github.com/XoxoDigitals/creatorpilotpro.com.git creatorpilot
cd /var/www/creatorpilot
mkdir -p /var/www/creatorpilot/.data/storage logs

# --- 5. .env (edit secrets before build) ---
nano /var/www/creatorpilot/.env
# Use section 6 template: WEB_PORT=333, API_PORT=4000, API_HOST=127.0.0.1,
# DATABASE_URL to creatorpilot DB, WEB_APP_URL=https://app.creatorpilotpro.com,
# API_ORIGIN=http://127.0.0.1:4000, CORS_ORIGINS=https://app.creatorpilotpro.com
ln -sfn /var/www/creatorpilot/.env /var/www/creatorpilot/apps/web/.env

# --- 6. Install / Prisma / build ---
set -a
source /var/www/creatorpilot/.env
set +a
pnpm install
pnpm --filter @scp/db generate
pnpm --filter @scp/db exec prisma migrate deploy
pnpm build
# optional empty-DB seed:
# pnpm db:seed

# --- 7. PM2 (add CreatorPilot only — do not restart arashan) ---
pm2 start /var/www/creatorpilot/ecosystem.config.cjs
pm2 save
pm2 status
curl -I http://127.0.0.1:333
curl -s http://127.0.0.1:4000/api/v1/health
curl -s http://127.0.0.1:4100/health
curl -I http://127.0.0.1:3000

# --- 8. Nginx site for app.creatorpilotpro.com ONLY ---
# Write /etc/nginx/sites-available/app.creatorpilotpro.com (section 7 full config)
ln -sf /etc/nginx/sites-available/app.creatorpilotpro.com /etc/nginx/sites-enabled/app.creatorpilotpro.com
nginx -t
systemctl reload nginx
curl -I -H "Host: app.creatorpilotpro.com" http://127.0.0.1
curl -I -H "Host: arashan.co.uk" http://127.0.0.1

# --- 9. DNS must already point app → 94.72.103.120 ---
dig +short app.creatorpilotpro.com

# --- 10. TLS (this hostname only) ---
certbot --nginx -d app.creatorpilotpro.com --non-interactive --agree-tos -m support@creatorpilotpro.com --redirect
curl -I https://app.creatorpilotpro.com
curl -I https://arashan.co.uk
certbot certificates

# --- 11. Firewall rules only (do NOT ufw --force enable) ---
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw deny 333/tcp
ufw deny 4000/tcp
ufw deny 4100/tcp
ufw deny 5432/tcp
ufw status
```
