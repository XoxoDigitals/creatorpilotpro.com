#!/usr/bin/env bash
#
# Disaster recovery: restore the SocialCreatorPilot database from a pg_dump.gz
# produced by deploy/backup.sh. Assets restore is a manual rsync — this script
# only handles the database, since assets can live on another mount.
#
# Usage:
#   DATABASE_URL=postgres://... ./restore.sh /path/to/db-YYYYMMDDTHHMMSSZ.sql.gz
#
# Safety: refuses to run unless SCP_RESTORE_CONFIRM=YES is set — this DROPS
# and recreates every table in the target database.

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"

DUMP_FILE="${1:-}"
if [ -z "${DUMP_FILE}" ]; then
  echo "usage: SCP_RESTORE_CONFIRM=YES DATABASE_URL=... $0 <dump.sql.gz>"
  exit 2
fi

if [ ! -f "${DUMP_FILE}" ]; then
  echo "error: dump file not found: ${DUMP_FILE}"
  exit 2
fi

if [ "${SCP_RESTORE_CONFIRM:-}" != "YES" ]; then
  echo "REFUSING to restore — this DROPS all tables in the target database."
  echo "Re-run with SCP_RESTORE_CONFIRM=YES to proceed."
  exit 1
fi

echo "[restore] $(date -u +%FT%TZ) restoring from ${DUMP_FILE}"
echo "[restore] target: ${DATABASE_URL%%\?*}"
echo "[restore] starting in 5 seconds — Ctrl-C to abort..."
sleep 5

gunzip -c "${DUMP_FILE}" | psql "${DATABASE_URL}"

echo "[restore] $(date -u +%FT%TZ) done — run 'pnpm --filter @scp/db migrate deploy' next if the schema is newer than the dump"
