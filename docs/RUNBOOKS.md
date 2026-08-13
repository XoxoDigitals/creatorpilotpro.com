# Runbooks

Operational playbooks for SocialCreatorPilot. Each section is a triage sheet — read top-to-bottom during an incident.

---

## 1. Backup & Restore

**Schedule:** `deploy/backup.sh` runs nightly at 03:00 UTC via cron. Writes `db-YYYYMMDDTHHMMSSZ.sql.gz` + FINAL/VOICEOVER asset rsync to `${BACKUP_DEST_DIR}`.

**Retention:** 14 days local (configurable via `BACKUP_RETAIN_DAYS`). Longer-term retention is the destination filesystem's responsibility (e.g. rclone → Drive with lifecycle rules).

**Verify a backup ran:**
```bash
ls -lh "${BACKUP_DEST_DIR}"/db-*.sql.gz | tail -5
tail -50 /var/log/scp-backup.log
```

**Restore drill (quarterly):**
```bash
# On a scratch host / staging database
export DATABASE_URL="postgres://scp:...@staging-db/scp_restore_test"
export SCP_RESTORE_CONFIRM=YES
./deploy/restore.sh /backups/db-20260717T030000Z.sql.gz

# Then verify row counts against production
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM social_accounts;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM content_items;"
```

**Full-system disaster recovery:**
1. Provision fresh VPS, run `deploy/setup.sh`
2. Restore latest dump: `./deploy/restore.sh /backups/db-<latest>.sql.gz`
3. Run pending migrations: `pnpm --filter @scp/db exec prisma migrate deploy`
4. Rsync FINAL/VOICEOVER assets back to `STORAGE_ROOT`
5. Restart pm2: `pm2 restart all`
6. Watch worker health: `curl localhost:4100/health | jq`

**RPO:** 24h. **RTO:** ~4h for the base system + however long the asset rsync takes.

---

## 2. Common Incidents

### 2.1 API returns 429 (rate limited)

The global `ThrottlerGuard` limits **20 req/s and 300 req/min per IP**. Most 429s are legitimate scraping or a runaway client. To diagnose:
```bash
# Find the offending IP in access logs
sudo journalctl -u caddy --since "10 minutes ago" | grep " 429 "
```
If a legitimate integration is hitting the limit, raise `ThrottlerModule.forRoot()` in `apps/api/src/app.module.ts` and redeploy.

### 2.2 Worker not processing jobs

Check the health endpoint first:
```bash
curl -s localhost:4100/health | jq
```
- `ok: false` — process is up but DB is unreachable. Check `DATABASE_URL` and `pg_isready`.
- `queues.<name>.size` growing but not draining — the queue's processor is stuck. Check pm2 logs: `pm2 logs worker --lines 200`.
- Health endpoint unreachable — process is down. `pm2 status`, then `pm2 restart worker`.

### 2.3 Publish attempts all failing (single account)

1. Open Incidents page → filter by that account
2. Kind `AUTH` → token expired. Reconnect the account in Settings.
3. Kind `RATE_LIMIT` → PostQued/YouTube/Meta is throttling. The publish queue's `retryBackoff` should self-heal within an hour.
4. Kind `POLICY` / `COPYRIGHT` → manual review — the content is on hold, no more auto-retries.

### 2.4 AI provider returning 401 on every call

The key pool auto-cools failing keys and rotates to the next. If all keys in a provider are `COOLDOWN` / `EXHAUSTED`:
1. Settings → AI Keys → check `lastUsedAt` and `status`
2. Add a fresh key (paid Flash recommended, ~$0.01/video)
3. The router will pick it up on the next dispatch (no restart needed)

### 2.5 Storage full

The hot-tier storage root hitting >90% blocks new ingestion and renders.
```bash
du -sh ${STORAGE_ROOT}/*/
```
Move `ORIGINAL` assets that already have a `FINAL` render to the archive tier (Drive). The eviction worker does this automatically, but a full disk means it's behind. Manual sweep:
```sql
-- Assets safe to evict: ORIGINAL for content_items that reached PUBLISHED
SELECT a.id, a.local_path, a.bytes
FROM assets a
JOIN content_items c ON c.id = a.content_item_id
WHERE a.kind = 'ORIGINAL' AND c.status = 'PUBLISHED'
  AND a.storage_state = 'LOCAL'
ORDER BY a.bytes DESC LIMIT 50;
```

---

## 3. Adding a Second Worker Node

The worker is stateless — pg-boss coordinates job distribution via the `pgboss.*` tables, so N workers can share a queue without extra config.

1. Provision new host, run `deploy/setup.sh` (installs node, pm2, ffmpeg, yt-dlp)
2. Copy `.env` from the primary worker (same `DATABASE_URL`, `MASTER_KEY`, `STORAGE_ROOT` — the second box needs shared filesystem access or its own hot tier for MEDIA-queue jobs)
3. Deploy the built `apps/worker/dist` bundle (or clone + `pnpm install --frozen-lockfile && pnpm --filter worker build`)
4. Start under pm2: `pm2 start deploy/ecosystem.config.cjs --only worker`
5. Confirm both workers appear in job dispatch logs — each should be picking up jobs

**Warnings:**
- The scheduling dispatcher, watcher dispatcher, competitor dispatcher, and analytics hot-sync dispatcher run in-process on **every** worker. Multiple workers will each try to dispatch; `singletonKey` on `boss.send()` dedups the actual jobs, but you'll see redundant dispatcher log lines. Fine.
- The nightly analytics cron (`boss.schedule`) is registered once by whichever worker starts first — pg-boss handles the cron server election internally.
- Health check port defaults to 4100. If both workers are on the same host, set `WORKER_HEALTH_PORT=4101` for the second one.

---

## 4. Security Hardening Checklist

Baseline that ships in v1:
- ✅ Helmet CSP / HSTS / X-Frame-Options on all API responses (main.ts)
- ✅ Rate limiting (20 req/s + 300 req/min per IP, ThrottlerModule)
- ✅ CORS locked to `CORS_ORIGINS` env var (comma-separated list)
- ✅ AES-256-GCM encryption of all account auth payloads + AI keys (docs/08 §2)
- ✅ Signed HttpOnly session cookies + CSRF double-submit
- ✅ RBAC guard chain: throttler → CSRF → session → RolesGuard

Quarterly:
```bash
pnpm audit          # prod deps at HIGH+
pnpm audit:all      # all deps at MODERATE+
```
Non-zero exit means action needed — read the report, run `pnpm update <pkg>` for patches, escalate to the Owner for anything requiring a major version bump.

Recommended additions (not yet shipped, tracked in backlog):
- 2FA/TOTP for OWNER and ADMIN roles
- Automated dependency PRs via Renovate/Dependabot
- WAF rules at Caddy layer (block common exploit paths)

---

## 5. Escalation

**Sev 1 — data loss / security breach:** Stop workers (`pm2 stop worker`), snapshot DB (`./deploy/backup.sh` on demand), notify Owner via Telegram + email, do not touch state until investigation plan agreed.

**Sev 2 — publishing broken across all accounts:** Check Incident center for common kind. If it's platform-wide (all accounts show same error kind), it's likely an upstream outage — post to Telegram, don't over-page.

**Sev 3 — single account or single feature broken:** Ack incident in-app, work the fix during business hours.
