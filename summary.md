# Session Summary — 2026-07-15 (for next session)

Claude acts as PM / System Architect / Tech Lead. **Model routing (owner instruction): Opus subagents write code, Haiku reads/explores; main session orchestrates, verifies, commits.** Owner: Saboor (saboor@xoxodigitals.com), OWNER seed account uses `SEED_OWNER_PASSWORD` from git-ignored root `.env`.

## What this project is

Self-hosted bulk social manager (YouTube/Facebook Reels/TikTok) with 3 pipelines (repurposed Kuaishou content, AI content research, AI drama series). Full plan: [README.md](README.md) + `docs/01..11`. Locked decisions: **no Docker** (native Postgres 16 + pm2), **pg-boss not Redis**, **YouTube+TikTok publish via PostQued** (`docs/specs/postqued-openapi.json`), Google APIs read-only (analytics/thumbnails/copyright), storage = local hot tier + owner's 10TB Google Drive. Team: 1 OWNER, 1 REVIEWER, 3 WORKERs.

## Completed & committed on `master`

- **Phase 0** (monorepo, auth/RBAC/vault, settings, CI) — done earlier.
- **UI redesign** (account-centric IA, connect wizard, mock-data layer) — done earlier.
- **Phase 1a (accounts + connect flows) — COMMITTED this session** (5 commits `326ff49`→`f433a30`): SocialAccount/ChannelProfile schema+migration, AES crypto helpers, API accounts module (PostQued import + Google/Meta OAuth connect + TikTok own-app 501 stub), web wiring + finished 5-step connect wizard + Meta page-picker, worker token-refresh maintenance job. Migration `phase1_accounts` live. Runtime-verified (curl transcript, 18 api unit tests).
- **Phase 1b (publish engine) — COMPLETE & COMMITTED this session** (7 commits `e12aad9`→`23bd325`):
  - `db`: ContentItem (state machine) / Asset (tiered StorageState) / PublishTarget (cross-post) / ScheduleSlot / PublishAttempt / Incident models + enums. Migration `phase1b_publish_engine` **applied live**.
  - `storage`: local hot-tier `TieredStorage` (putLocal streamed-md5 + verify, restore fast-path; `md5File`/`hotTierPath` helpers). Drive archive/evict are documented Phase-2 stubs. 7 tests.
  - `publish-adapters`: `PostQuedV2Client` (3-step upload, publish w/ Idempotency-Key, status poll) + PostQued(TikTok)/YouTube(via PostQued)/Facebook(direct Graph Reels) adapters + `validateMetadata`. Errors carry `.retryable`. 10 tests.
  - `worker`: publish + verify processors + per-minute dispatcher on the `publish` queue. Preflight→adapter.publish→PublishAttempt→schedule +15m/+24h verify; error matrix (auth breaks+pauses account, retryable→pg-boss backoff retryLimit 5, terminal→DRAFT); verify BLOCK→DRAFT+incident+auto-hold siblings.
  - `api`: filled 5 module stubs + global pg-boss `QueueProducer`. storage (multipart upload→hot tier→Asset), content (+ review queue + state-machine service), scheduling (slot CRUD + tz-aware `SlotPlanner`), publishing (create cross-post targets, fail-fast metadata guard, dispatch NOW), incidents (list/retry/ack/resolve). +`@fastify/multipart`, `STORAGE_ROOT` config. 4 new tests (22 api total).
  - `web`: wired incidents (live + retry/resolve), calendar (real targets), review (persisted approve/reject), schedule (upcoming + planner slots + **manual upload modal**). New `api-data` accessors + `apiUpload` multipart helper, same demo-mode fallback as accounts.

### Verified this session
Full monorepo **9/9 typecheck clean, all tests pass** (storage 7 + adapters 10 + api 22). API booted, all routes mapped, QueueProducer connects. **End-to-end publish loop proven**: inserted a test HEALTHY TikTok/PostQued account → created content → uploaded a file (fetch+FormData → HTTP 201, asset on hot tier w/ md5) → approve → POST /publish NOW → worker consumed the pg-boss job → restored asset → attempted adapter → (PostQued key absent) recorded TERMINAL_ERROR PublishAttempt + drafted target + raised SYSTEM incident, surfaced via GET /incidents. All test data cleaned up (0 real accounts, back to demo state). Only the real PostQued/Graph HTTP call is unexercised — needs owner externals.

## Architecture decisions made this session (non-obvious)
- **Shared publish-job contract**: single `publish` pg-boss queue, discriminated union `{kind:'publish',publishTargetId}` (singletonKey=id) and `{kind:'verify',publishTargetId,platformPostId,phase}` (startAfter). Defined in `apps/worker/src/publish-jobs.ts`; API's `QueueProducer` sends the publish variant.
- **ESM/CJS boundary**: `@scp/storage` + `@scp/publish-adapters` are ESM but the Nest API is CJS. Made them **dual-consumable** by adding a `default` export condition (commit `363ac9a`) → Node 24 require-esm loads them. Do NOT do this for `@scp/db` (it re-exports CJS @prisma/client and breaks require-esm — the API uses `@prisma/client` directly + `import type` from @scp/db, see `prisma.service.ts`).
- Worker constructs adapters per-job: reads encrypted `platform_apps.postqued` key (same pattern as maintenance.ts reads `platform_apps.google`), decrypts `SocialAccount.authPayload` for per-target auth. FB verify() re-primes page token via `primeVerifyAuth`.

## Task board (persisted)
#7 **owner externals still pending** (blocks real publishing): Google Cloud read-only app, Meta app + testers, **PostQued API key + connect TikTok/YouTube accounts in PostQued**, optional Telegram bot — guide `docs/OWNER-SETUP.md`. #8 Phase 1a/1b **done**. #9–14 phases 2–7 pending. #1–6, #15 done.

### Next session — likely work
1. When owner adds the PostQued key + a real connected account, re-run the same E2E loop to confirm a real publish (the only unproven step).
2. Phase 2 (task #9): sources/watchers + ingestion (Kuaishou download pipeline), or AI research/ideas — see docs/03 Domain 3/5, docs/04, docs/05. Content state machine + Asset/AiOutput models partly exist; `watched_sources`/`ideas`/`dramas` tables are NET-NEW.
3. Backlog: real Google Drive archival (storage `archiveToDrive`/`evict` are stubs + the STORAGE queue), analytics metric sync (Phase 6), calendar drag-to-reschedule.

## Environment & gotchas (hard-won)
- Windows 11, Node 24, pnpm 11, git, NO Docker/Redis. Dev: `pnpm dev` (turbo) or Browser-pane launch config "dev".
- Root `.env`: DATABASE_URL/MASTER_KEY/SESSION_SECRET/SEED_OWNER_PASSWORD/STORAGE_ROOT. api loads via envFilePath `['.env','../../.env']`, worker via dotenv — cwd differs turbo vs pm2, don't regress.
- Prisma CLI needs `DATABASE_URL` exported (read from root .env). **`prisma generate` EPERM on Windows** = a node process holds `query_engine-windows.dll.node`; kill lingering node procs first.
- `nest build` incremental disabled (stale-tsbuildinfo). Next.js `output:'standalone'` removed (Windows symlink EPERM); pm2 runs `next start`.
- **Browser-pane screenshots time out on this machine** — verify with `read_page` / curl of SSR HTML.
- **Multipart upload**: test with `fetch`+`FormData` (browser path), NOT curl `-F` (unreliable on Windows/MSYS → HTTP 000).
- Login test: read creds from `.env`, POST `/api/v1/auth/login` with `Origin: http://localhost:3000` (CSRF), cookie jar; never echo secrets.
- **Background Opus agents die on session usage limits** — expect it. This session finished Phase 1b's worker + API + web **inline** in the main session after both background agents died mid-task. Partial agent work lands on disk; resume via SendMessage or finish inline.
