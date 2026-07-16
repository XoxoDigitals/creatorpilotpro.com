# Session Summary — 2026-07-15/16 (authoritative handoff; supersedes `summary.md`)

Claude acts as PM / System Architect / Tech Lead. **Model routing (owner instruction): Opus writes code, Haiku reads/explores; main session orchestrates, verifies, commits.** Owner: Saboor (saboor@xoxodigitals.com). OWNER seed account uses `SEED_OWNER_PASSWORD` from the git-ignored root `.env`.

**Owner directive (2026-07-16): build all phases now; the owner will add API keys/credentials at the END of all phases.** So: build every layer with **graceful degradation** when an external (PostQued key, Google/Meta app, yt-dlp, ffmpeg) is absent — the established pattern is a clear terminal error → incident → surfaced in the UI, never a crash.

## What this project is

Self-hosted bulk social manager (YouTube / Facebook Reels / TikTok), 3 pipelines: (1) repurposed Kuaishou content, (2) AI content research → worker production, (3) AI drama series. Full plan: [README.md](README.md) + `docs/01..11`. Locked decisions: **no Docker** (native Postgres 16 + pm2), **pg-boss not Redis**, **YouTube+TikTok publish via PostQued** (`docs/specs/postqued-openapi.json`), Google APIs read-only (analytics/thumbnails/copyright), storage = local hot tier + owner's 10TB Google Drive. Team: 1 OWNER, 1 REVIEWER, 3 WORKERs.

---

## COMMITTED on `master` (21 commits this session, `326ff49` → `431c776`)

### Phase 1a — Accounts & connect flows (5 commits, DONE)
Picked up half-finished/uncommitted from the prior session and completed it. SocialAccount/ChannelProfile schema+migration (`phase1_accounts`, live), AES-256-GCM crypto helpers, API accounts module (PostQued import + Google/Meta OAuth connect w/ HMAC state + Meta page-picker session + TikTok own-app 501 stub), web wiring + finished the 5-step connect wizard + `/accounts/connect/meta` page-picker page, worker Google token-refresh maintenance job. **Fixed a real bug**: `connectMeta` ignored the wizard choices stored in the OAuth session — now applies them (matching `googleCallback`); `metaConnectSchema` narrowed to `{session, pageId}`.

### Phase 1b — Publish engine (7 commits, DONE & verified end-to-end)
- **db** (`e12aad9`): ContentItem (state machine) / Asset (tiered StorageState) / PublishTarget (cross-post) / ScheduleSlot / PublishAttempt / Incident + enums. Migration `phase1b_publish_engine` **live**. Wired the `Notification.incidentId` relation left as a phase-0 TODO.
- **storage** (`ce73af7`): local hot-tier `TieredStorage.putLocal` (streamed md5 + byte verify) and `restore` local-present fast path; exports `md5File`, `hotTierPath`. `archiveToDrive`/`evict` are **documented Phase-2+ stubs** (Drive queue, 750GB/day). 7 tests.
- **adapters** (`17de171`): `PostQuedV2Client` (3-step upload → presigned PUT → complete; publish with required `Idempotency-Key`; status poll) + `PostQuedAdapter`(TikTok) / `YouTubeAdapter`(via PostQued) / `FacebookAdapter`(direct Graph Reels start→upload→finish) + `validateMetadata`. Errors carry `.retryable`. 10 tests.
- **packages** (`363ac9a`): made `@scp/storage` + `@scp/publish-adapters` **dual-consumable** (see ESM/CJS note below).
- **worker** (`20bf0e5`): publish + verify processors + per-minute dispatcher. Preflight (asset restore, account health, fail-fast metadata) → `adapter.publish` → `PublishAttempt` → schedules +15m/+24h verify. Error matrix: auth → account BROKEN+paused+incident; retryable → re-throw for pg-boss backoff (retryLimit 5, set on the queue at `createQueue`); terminal → DRAFT+incident. Verify BLOCK → DRAFT + COPYRIGHT/PLATFORM_REJECT incident + **auto-hold sibling SCHEDULED targets**.
- **api** (`2e74cc1`): filled the 5 module stubs + a global pg-boss `QueueProducer`. `storage` (multipart upload → hot tier → Asset), `content` (+ review queue + state-machine service), `scheduling` (slot CRUD + tz-aware `SlotPlanner`), `publishing` (create cross-post targets, fail-fast metadata guard, resolve NOW/FIXED/QUEUE_SLOT, dispatch NOW), `incidents` (list/retry/ack/resolve). Added `@fastify/multipart` + `STORAGE_ROOT` config. 22 api tests.
- **web** (`23bd325`): wired incidents (live + working retry/resolve), calendar (real targets), review (persisted approve/reject), schedule (real upcoming + planner slots + **manual upload modal**). New `api-data` accessors + `apiUpload` multipart helper; same demo-mode fallback as accounts. `ReviewList` gained an optional `onDecide` (real API vs demo local state).

### Phase 2 — Ingestion & Review (ALL 6 layers DONE, `66ab3ca` + 5 commits `4945ffd`→`7fb1db5`)
- **2.1 db** (`66ab3ca`): `WatchedSource` (type KUAISHOU_PROFILE|GENERIC_URL, url, label, `checkIntervalMin` default 360, `trimStartMs` default 500, lastCheckedAt, status ACTIVE/PAUSED/ERROR, `consecutiveFailures`, `targetAccountId` FK→SocialAccount SetNull, errorNote, soft-delete) + `SourceVideo` (watchedSourceId FK Cascade, sourceUrl, sourcePlatformId, uploaderName, title, durationSec, publishedAt, perceptualHash, md5, downloadStatus PENDING/DOWNLOADING/DONE/FAILED/SKIPPED_DUPLICATE, rightsNote, rightsConfirmedById *(soft ref)*, `nearDuplicateOfId`). Unique `(watchedSourceId, sourcePlatformId)`, index on `perceptualHash`. `ContentItem.sourceVideo` is a real FK. Migration `phase2_sources_ingestion` **live**.
- **2.2 adapters** (`4945ffd`): wired `ytdlp.ts` (injectable `CommandRunner`/`spawnRunner`, `YtDlp.available/listEntries/download`, `hashFile`, `YtDlpNotAvailableError`) into `KuaishouAdapter` (list→listEntries, download→download) + `GenericUrlAdapter` (download→download; listNewVideos keeps the self-ref for bulk import). Both take an injected `YtDlp`. Exported from `index.ts`. Added vitest + 15 tests (mocked runner).
- **2.3 worker media primitives** (`a7633d6`): `apps/worker/src/media/ffmpeg.ts` (injectable-runner `Ffmpeg`: `available`, `trimNormalize` drop-first-`trimStartMs`+H.264/AAC faststart mp4, `extractGrayFrame`) + `phash.ts` (`dHash`, `hammingDistance`, `isNearDuplicate` threshold 10, `computePerceptualHash`→undefined when ffmpeg absent). Added vitest to the worker + 14 tests.
- **2.4 worker processors + watcher dispatcher** (`e440cbe`): `ingestion-jobs.ts` (WatchJob/DownloadJob/MediaJob + guards, one kind per queue) · `ingestion-support.ts` (adapter factory, `sources/` hot-tier path, reuses publish-support prisma/incident helpers) · `watcher.ts` (`dispatchDueSources` per-minute singletonKey + `runWatch`: list→upsert by (watchedSourceId,sourcePlatformId)→enqueue DOWNLOAD; auto-pause ERROR+incident after 3 failures) · `download.ts` (fetch→md5+best-effort pHash→exact-md5 dup=SKIPPED_DUPLICATE / near-dup flags `nearDuplicateOfId` but still processes→enqueue MEDIA; failure=FAILED+incident) · `media-process.ts` (trim/normalize→REPURPOSED ContentItem REVIEW_PENDING + ORIGINAL/FINAL assets; ffmpeg absent→raw mp4 is FINAL + "normalization skipped" incident). `index.ts` gained a 2nd per-minute dispatcher; worker gained `@scp/source-adapters` + `STORAGE_ROOT` config. **Live-verified against the DB: 12/12 checks** (auto-pause, generic discovery+dedupe, graceful download failure), data cleaned up.
- **2.5 API sources module** (`e5f9835`): full CRUD (`GET/POST/GET:id/PATCH:id/DELETE:id`), `POST /sources/:id/check` (ERROR auto-resume, PAUSED rejected), `POST /sources/import` (bulk: one PAUSED GENERIC_URL batch + SourceVideo per unique URL, each enqueued), `GET /sources/videos`, `PATCH /sources/video/:id/rights`. RBAC + `@Audit`. `QueueProducer` gained `enqueueWatch`/`enqueueDownload`. **Live-verified via the compiled service: 11/11 checks**, data cleaned up.
- **2.6 web** (`7fb1db5`): sources page real data (new `getSourcesView` + demo fallback) with per-row check-now/pause-resume/remove + Add-watched-profile & Bulk-import modals (`source-modals.tsx`); review rights gate — ingested items can't be approved without a rights note, `ReviewList` enforces it + inline "Add rights note" (`setSourceRights`→PATCH). API content review view now joins `sourceVideo` → real items carry `sourceUrl`+`rightsNote`+`sourceVideoId`. Maps KUAISHOU_PROFILE→WATCHED_PROFILE / GENERIC_URL→BULK_IMPORT, checkIntervalMin→hours.

### Phase 2 type/shape decisions (as-built — don't re-litigate)
- Source of truth = DB + adapters (`KUAISHOU_PROFILE | GENERIC_URL`); web keeps `SourceType='WATCHED_PROFILE'|'BULK_IMPORT'`, mapped in `api-data.ts`. `checkIntervalMin`(DB)→`checkIntervalHours`(web).
- Bulk import = one PAUSED `GENERIC_URL` batch (url `batch:<label>`, `targetAccountId` set) + a `SourceVideo` per URL (sourcePlatformId=url), each enqueued for DOWNLOAD.
- **Note:** `STORAGE_ROOT` is **NOT in root `.env`** (the prior summary was wrong). The API storage module + worker ingestion both need it — the owner must add it before ingestion runs. (Set to a scratch path only for smoke tests.)

---

## Architecture decisions (non-obvious — carry forward)

- **Publish-job contract**: ONE pg-boss `publish` queue, discriminated union `{kind:'publish',publishTargetId}` (sent with `singletonKey`=id, so double-dispatch is impossible) and `{kind:'verify',publishTargetId,platformPostId,phase}` (sent with `startAfter`). Defined once in `apps/worker/src/publish-jobs.ts`. The API's `QueueProducer` (`apps/api/src/common/queue/`) sends only the publish variant; the worker schedules verify itself. **Use this same pattern for the ingestion queues.**
- **ESM/CJS boundary (bit me, now solved)**: `@scp/storage` + `@scp/publish-adapters` are ESM but the Nest API is CJS. Their `exports` map only had `types`+`import` → `require()` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`. Fix: added a **`"default"` export condition** → Node 24 `require(esm)` loads them fine (verified). **Do NOT do this to `@scp/db`** — it `export *`s CJS `@prisma/client`, which breaks require-esm; the API instead instantiates `@prisma/client` directly and takes only `import type` from `@scp/db` (see the comment in `apps/api/src/prisma/prisma.service.ts`). `@scp/source-adapters` currently has **no `default` condition** — only the worker (ESM) imports it, so that's fine unless the API ever needs it.
- Worker builds adapters per-job: reads the encrypted `platform_apps.postqued` setting (same pattern `maintenance.ts` uses for `platform_apps.google`), decrypts `SocialAccount.authPayload` for per-target auth. FB `verify()` re-primes the page token via `primeVerifyAuth` (the frozen `verify(platformPostId)` signature carries no auth).
- **Known divergence (not yet reconciled)**: `packages/shared/src/content-status.ts` has a `CONTENT_TRANSITIONS` map that differs from the authoritative one I wrote in `apps/api/src/modules/content/content-state.ts` (the API's allows `APPROVED→SCHEDULED`, needed by manual publish; shared's doesn't). The API's is the one in use. Consider consolidating onto shared (adding the missing edge) rather than letting them drift.

---

## Verification status

**Whole monorepo green**: 9/9 typecheck clean, all tests pass (storage 7 + publish-adapters 10 + source-adapters 15 + **ai-providers 30** + worker 14 + api 22). Web + api build clean.

**Phase 2 ingestion verified live** (yt-dlp/ffmpeg absent → graceful-degradation paths): worker pipeline 12/12 (watcher auto-pause after 3 failures, generic-url self-ref discovery + no-dup re-poll, download FAILED+incident, no MEDIA on failure) and API sources service 11/11 (create/resume-latch/check-now guards/bulk-import dedupe 3→2/rights note/list) — both driven against the real DB via the compiled code with a stub queue, **all test data cleaned up**. Smoke scripts in the session scratchpad. Unexercised: the real yt-dlp/ffmpeg binaries and the browser render of the new sources page (client-rendered + auth; build validates compile).

**Phase 1b publish loop proven end-to-end** (with a temporary test account, since owner externals are absent): created content → uploaded a file (`fetch`+`FormData` → 201, asset on hot tier with md5) → approve → `POST /publish` NOW → API enqueued → **worker consumed the pg-boss job** → restored the asset → selected the adapter → (PostQued key absent) recorded a `TERMINAL_ERROR` `PublishAttempt` + drafted the target + raised a `SYSTEM` incident → surfaced via `GET /incidents` with the account name joined. Also verified: state machine rejects illegal transitions (400), missing incident → 404, require-esm interop in the compiled CJS API. **All test data was cleaned up (0 real accounts, back to demo state).** The only unexercised step is the real PostQued/Graph HTTP call.

---

## Task board
- **#7 owner externals — DEFERRED to the end by owner** (PostQued API key + connected accounts, Google Cloud read-only app, Meta app + testers, optional Telegram). Guide: `docs/OWNER-SETUP.md`. **Also needed operationally: install `yt-dlp` + `ffmpeg` on the worker host** (Phase 2/3 use them; neither is on this machine).
- **#8 Phase 1a + 1b — DONE.**
- **#9 Phase 2 — DONE** (all 6 layers 2.1–2.6 committed + verified). Operational prereqs for it to actually run: install `yt-dlp` + `ffmpeg` on the worker host, and set `STORAGE_ROOT` in root `.env`.
- **#10 Phase 3 — IN PROGRESS.** 3.1 db + 3.2 ai-providers landed (see below). #11–14 Phases 4–7 pending. #1–6, #15 done.

## Phase 3 progress — AI layer & repurposing pipeline (MVP milestone)

### Committed
- **3.1 db** (`f66bc6f`): AI cache + usage log + prompt versions + key window counters (docs/05 §4–5, §7). AiKey gained `{minute,day}WindowStartAt` + counters + `lastUsedAt` for LRU. New `AiOutput` (unique `cacheKey`, hitCount/lastHitAt), `AiUsageLog` (immutable per-call log, `Decimal(10,6)` cost, keyId SetNull on key delete), `PromptVersion` (unique `(accountId,task,name,version)`; null accountId = global default, app-layer `isActive`). Migration `phase3_ai_cache_usage_prompts` **live**. Live schema smoke 9/9 (defaults, unique constraints, Decimal, SetNull), all rows cleaned up.
- **3.2 packages/ai-providers** (`431c776`): the core abstraction (docs/05 §2, §4–5). Storage-agnostic behind small ports (`KeyStore`/`CacheStore`/`UsageLogger`/`ProviderRegistry`) so the same code path runs in the worker (Prisma-backed) and the API playground (in-memory). Files:
  - `cache-key.ts` — deterministic sha256(task|model|promptVersion|styleVersion|inputContentHash)
  - `key-pool.ts` — `KeyPool` w/ LRU selection, `rollWindows`/`hasHeadroom`, `recordError` mapping AIErrorClass → status transitions (RATE_LIMITED→COOLDOWN[retry-after|60s], QUOTA_EXHAUSTED→EXHAUSTED, INVALID_KEY→DISABLED; TRANSIENT/FATAL/CONTENT_BLOCKED leave status untouched)
  - `router.ts` — `AIRouter` end-to-end: cache lookup → chain iteration → key checkout → provider call → log usage/cost → save to cache; rotates on key errors, retries TRANSIENT same-key
  - `gemini.ts` — real fetch-based AI Studio v1beta adapter (no SDK). Structured JSON via `responseMimeType` + zod parse w/ one repair-retry; classifyError matrix; multimodal `fileData` + inline audio (TTS). Kokoro/OpenAI/Whisper stubs unchanged (real impls in 3.5).
  - Package gained `@types/node` + vitest + `"default"` export condition; 30 tests (cache-key determinism, KeyPool selection under every status, recordError transitions, router cache/chain/counter, Gemini classifyError + JSON path + repair-retry).

### Remaining layers (my design decisions, follow these)
- **3.3 API ai module** (`apps/api/src/modules/ai/`): providers listing (`GET /ai/providers`), keys CRUD (encrypted at rest via existing CryptoService; only `keyLast4` returned — never `keyEnc`), kill switches via `system_settings.ai.kill_switches.*`, playground endpoint that dry-runs a task against a channel profile using the router with **in-memory** cache/logger ports (no persistence). RBAC OWNER/ADMIN, `@Audit` on mutations. Also implement `PrismaKeyStore`/`PrismaCacheStore`/`PrismaUsageLogger` as thin adapters — probably in `apps/api/src/modules/ai/store/` (or a tiny `@scp/ai-store` package if the worker needs to import them too; worker + api sharing them is the deciding factor). If worker needs them → make a package; else keep in api and dupe when worker lands.
- **3.4 worker AI processor** (`apps/worker/src/ai.ts` + wire in `processors.ts`): consume the `ai` queue with discriminated jobs `{kind:'analyze',contentItemId}` / `{kind:'narration',contentItemId}` / `{kind:'metadata',contentItemId}` — router-driven. Advances the state machine: REVIEW_PENDING↛APPROVED (user) → ANALYZING → SCRIPT_READY → SCRIPT_APPROVED (auto if channel policy=auto, else manual gate) → enqueue TTS. All content-item state transitions must go through the existing content-state service. Use the same `boss` handle pattern.
- **3.5 TTS** (`tts` queue): Kokoro (self-hosted default, POST to KOKORO_URL) → Gemini TTS → OpenAI TTS chain via the router. Chunk long scripts at sentence boundaries, synth in parallel, concat WAVs + silence padding, EBU R128 normalize (worker already has ffmpeg wrapper — reuse). Voiceover archived as VOICEOVER asset; TTS_DONE.
- **3.6 render/merge** (extend media pipeline): Demucs split (NOT installed → graceful path = keep original audio muted + VO overlay only), overlay VO, loudness normalize, mux → FINAL asset. Then auto-metadata (router METADATA task) → METADATA_READY.
- **3.7 web**: AI keys page (per provider, add/remove w/ last-4 display + `revealOnce`-style write-only inputs), Prompt playground page (task picker + channel profile picker + input + streamed output), cost dashboard on account details (from `ai_usage_log` aggregations, joined with `AiOutput.hitCount` for cache-serve counts).

### Phase 3 type/shape decisions (don't re-litigate)
- **Router is the single entry point** — feature code never calls a provider directly. It only names a `TaskType`. Adding a provider = one adapter file + registry chain entry.
- **PromptVersion.accountId=NULL** rows are the platform defaults; account-scoped rows override. Postgres NULLS DISTINCT means the unique constraint doesn't police NULLs — the app layer's `isActive` flag polices "one default per (task, name)".
- **AIUsageLog is append-only** (no updatedAt). Every provider call OR cache hit writes a row (cache hits = zero tokens/cost). Cost aggregation lives in SQL (SUM over date ranges), not in-memory.
- **Cache-miss & save races**: not yet handled. When 3.3/3.4 land, add a Postgres advisory lock keyed on cacheKey (`pg_advisory_xact_lock(hashtext(cacheKey))`) around the router's lookup→call→save so identical concurrent requests coalesce to one provider call (docs/05 §5 in-flight dedupe). Test this with a real Postgres in the 3.4 smoke.
- **`STORAGE_ROOT` still not in root `.env`** (called out in the Phase 2 section) — Phase 3 TTS/render will also need it.

---

## Environment & gotchas (hard-won — read before debugging)
- Windows 11, Node 24, pnpm 11, git, **NO Docker/Redis**. Dev: `pnpm dev` (turbo) or the Browser-pane launch config "dev".
- Root `.env`: DATABASE_URL / MASTER_KEY / SESSION_SECRET / SEED_OWNER_PASSWORD / STORAGE_ROOT. api loads via `envFilePath ['.env','../../.env']`, worker via dotenv — **cwd differs turbo vs pm2**, don't regress.
- Prisma CLI needs `DATABASE_URL` **exported** (read it from root `.env` first). **`prisma generate` EPERM** on Windows = a node process holds `query_engine-windows.dll.node` → kill lingering node procs first (this bit me twice).
- `nest build` incremental disabled (stale-tsbuildinfo → empty dist); don't re-enable. Next.js `output:'standalone'` removed (Windows symlink EPERM); pm2 runs `next start`.
- **Browser-pane screenshots time out on this machine** — verify with `read_page` / curl of SSR HTML.
- **Multipart upload: test with `fetch`+`FormData` (the real browser path), NOT curl `-F`** — curl `-F` on Windows/MSYS gives a misleading HTTP 000. My upload code was correct; curl was the problem.
- `pnpm -r test` batches output — a package showing "tests 1" may really be 7 (run `node --test --test-reporter=tap` directly to confirm). Don't chase phantom failures.
- Lint shows pre-existing "Unused eslint-disable directive" warnings (no-console) across worker/api — **0 errors**; these predate this work and are accepted in committed history.
- Login test pattern: read creds from `.env` programmatically, POST `/api/v1/auth/login` with `Origin: http://localhost:3000` (CSRF), cookie jar; **never echo secrets**.
- **Background Opus agents die on session usage limits** — this happened to BOTH the worker and API agents mid-Phase-1b; they wrote nothing. I finished those layers **inline in the main session**. Expect this: prefer inline work for large layers, or resume via SendMessage. Partial agent work lands on disk.
- Pre-install deps for parallel agents (edit package.json + one `pnpm install`) so concurrent agents never race on `pnpm-lock.yaml`.
