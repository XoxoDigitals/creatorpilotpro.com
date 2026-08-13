#!/usr/bin/env bash
#
# Nightly backup: pg_dump the SocialCreatorPilot database + rsync final assets
# and voiceovers to a mounted Drive/S3/rclone destination. Media originals are
# NOT backed up (the ingestion pipeline can rederive them, and they dominate
# storage). See docs/RUNBOOKS.md for schedule + restore.
#
# Environment:
#   DATABASE_URL       — full postgres connection string
#   BACKUP_DEST_DIR    — target directory (rclone mount, NFS, or local disk)
#   STORAGE_ROOT       — hot-tier root (default: /opt/scp/storage)
#   BACKUP_RETAIN_DAYS — how many daily dumps to keep locally (default: 14)
#
# Cron: 0 3 * * * /opt/scp/deploy/backup.sh >> /var/log/scp-backup.log 2>&1

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DEST_DIR:?BACKUP_DEST_DIR is required}"

STORAGE_ROOT="${STORAGE_ROOT:-/opt/scp/storage}"
BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-14}"

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP_FILE="${BACKUP_DEST_DIR}/db-${STAMP}.sql.gz"

mkdir -p "${BACKUP_DEST_DIR}"

echo "[backup] $(date -u +%FT%TZ) starting"

# 1. Postgres logical dump (custom format compressed).
echo "[backup] dumping database → ${DUMP_FILE}"
pg_dump --no-owner --no-privileges --clean --if-exists "${DATABASE_URL}" \
  | gzip -9 > "${DUMP_FILE}"
DUMP_SIZE=$(stat -c '%s' "${DUMP_FILE}" 2>/dev/null || stat -f '%z' "${DUMP_FILE}")
echo "[backup] dump complete — ${DUMP_SIZE} bytes"

# 2. Rsync final assets + voiceovers only (skip originals — the pipeline can
#    rederive them and they dominate storage). Adjust filters per your layout.
if [ -d "${STORAGE_ROOT}" ]; then
  echo "[backup] syncing FINAL + VOICEOVER assets → ${BACKUP_DEST_DIR}/assets/"
  rsync -a --delete \
    --include='*/' \
    --include='final/**' \
    --include='voiceover/**' \
    --exclude='*' \
    "${STORAGE_ROOT}/" "${BACKUP_DEST_DIR}/assets/"
fi

# 3. Prune old local dumps.
find "${BACKUP_DEST_DIR}" -maxdepth 1 -name 'db-*.sql.gz' -mtime "+${BACKUP_RETAIN_DAYS}" -delete
echo "[backup] pruned dumps older than ${BACKUP_RETAIN_DAYS}d"

echo "[backup] $(date -u +%FT%TZ) done"
