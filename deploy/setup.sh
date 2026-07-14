#!/usr/bin/env bash
# =============================================================================
# SocialCreatorPilot — idempotent Ubuntu VPS provisioning (docs/02 §7, no Docker)
# Target: fresh Ubuntu 22.04/24.04 LTS. Safe to re-run.
# Usage:  sudo DOMAIN=scp.example.com POSTGRES_PASSWORD=... bash deploy/setup.sh
# =============================================================================
set -euo pipefail

DOMAIN="${DOMAIN:-scp.example.com}"
APP_USER="${APP_USER:-scp}"
APP_DIR="${APP_DIR:-/home/${APP_USER}/socialcreatorpilot}"
POSTGRES_USER="${POSTGRES_USER:-scp}"
POSTGRES_DB="${POSTGRES_DB:-scp}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"

log() { echo -e "\n\033[1;32m[setup]\033[0m $*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup.sh" >&2
  exit 1
fi

# --- Base packages -----------------------------------------------------------
log "apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git ufw fail2ban ffmpeg

# TODO(later phase): install yt-dlp + Demucs + faster-whisper + Kokoro TTS
# (python venv under /opt/scp-media-tools) when Pipeline 1 media processing lands.

# --- App user ----------------------------------------------------------------
if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  log "creating app user ${APP_USER}"
  useradd -m -s /bin/bash "${APP_USER}"
fi

# --- Node 24 (NodeSource) + pnpm via corepack --------------------------------
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1)" != "v24" ]]; then
  log "installing Node.js 24 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
log "enabling corepack/pnpm"
corepack enable
corepack prepare pnpm@11.13.0 --activate

# --- pm2 (global) -------------------------------------------------------------
if ! command -v pm2 >/dev/null 2>&1; then
  log "installing pm2"
  npm install -g pm2
fi

# --- PostgreSQL 16 -------------------------------------------------------------
if ! command -v psql >/dev/null 2>&1; then
  log "installing PostgreSQL 16 (PGDG)"
  install -d /usr/share/postgresql-common/pgdg
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16
fi
systemctl enable --now postgresql

log "ensuring database role + db (idempotent)"
if [[ -z "${POSTGRES_PASSWORD}" ]]; then
  echo "WARNING: POSTGRES_PASSWORD not set — skipping role/db creation." >&2
else
  sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" | grep -q 1 \
    || sudo -u postgres psql -c "CREATE ROLE ${POSTGRES_USER} LOGIN PASSWORD '${POSTGRES_PASSWORD}'"
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1 \
    || sudo -u postgres createdb -O "${POSTGRES_USER}" "${POSTGRES_DB}"
fi

# --- Caddy (official repo) -----------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  log "installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

log "installing Caddyfile (DOMAIN=${DOMAIN})"
sed "s/{\$DOMAIN}/${DOMAIN}/g" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

# --- Firewall (ufw) ------------------------------------------------------------
log "configuring ufw (22, 80, 443 only)"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable

# --- fail2ban -------------------------------------------------------------------
log "enabling fail2ban (sshd jail)"
cat > /etc/fail2ban/jail.d/scp.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
systemctl enable --now fail2ban
systemctl restart fail2ban

# --- App checkout hint -----------------------------------------------------------
log "done. Next steps (as ${APP_USER}):"
cat <<EOF
  1. git clone <repo> ${APP_DIR} && cd ${APP_DIR}
  2. cp .env.example .env && edit .env (DATABASE_URL, MASTER_KEY, SESSION_SECRET, DOMAIN...)
  3. pnpm install && pnpm build
  4. pnpm --filter @scp/db exec prisma migrate deploy && pnpm db:seed
  5. pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
See deploy/DEPLOY.md for the full runbook.
EOF
