# 06 — Publishing Engine & Scheduling Engine

## 1. Publisher Adapter Interface

```ts
interface PublishAdapter {
  platform: 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';
  publish(target: PublishTarget, media: LocalFile, meta: ResolvedMetadata): Promise<{ platformPostId: string }>;
  verify(platformPostId): Promise<{ live: boolean; issues: PlatformIssue[] }>;   // claims, blocks, processing failures
  updateMetadata?(postId, meta): Promise<void>;
  delete?(postId): Promise<void>;
  getConstraints(): PlatformConstraints;   // max duration, size, title length, tags, formats
}
```

Metadata is validated against `getConstraints()` **before** upload (fail fast in UI, not at publish time).

## 2. Platform Adapters — Reality Notes (important)

### YouTube (`youtube` adapter) — **publishes via PostQued** (Owner decision 2026-07-14)
- **Publishing path:** PostQued `POST /v2/publish` with `platform:'youtube'` targets — options confirmed in their spec: `{visibility, title, description, categoryId, tags, madeForKids, containsSyntheticMedia}` (the AI-label flag is right there). Same upload/idempotency/draft machinery as TikTok — one publishing integration for both platforms.
- **This eliminates the two biggest risks of the direct-API plan:** the 1,600-unit upload cost against the 10,000/day quota (~6 uploads/day) and Google's OAuth app verification for public uploads. Both formerly-High risks are gone.
- **Google OAuth is still connected per channel, but read-only**, for what PostQued cannot provide:
  - **Analytics & revenue/RPM** — YouTube Analytics API (`yt-analytics.readonly`, `yt-analytics-monetary.readonly`); a hard PRD requirement (FR-I1).
  - **Custom thumbnails** — `thumbnails.set` via Data API (≈50 units/call → hundreds/day possible within default quota) using the video ID returned by PostQued's publish status. Runs as a post-publish step in the verify job.
  - **Copyright/claim detection** — `videos.list(status, contentDetails)` (1 unit) on the verify job: `uploadStatus/rejectionReason` covers blocks/rejections.
- Read-only scopes + tiny quota usage = no audit form, no verification pressure (Internal-type Workspace consent screen skips verification entirely).
- The direct-upload adapter path stays documented as a fallback if PostQued ever degrades (adapter interface unchanged).

### Facebook (`facebook` adapter)
- Page access tokens (from user token or Business Manager **system user** — preferred: non-expiring, survives password changes).
- **Scope decision (Owner, 2026-07-14): Reels only.** Adapter implements the Reels Publishing API path (`/{page-id}/video_reels`: start → upload → finish w/ description). Feed-video upload deferred to backlog — the adapter interface already accommodates it.
- ⚠️ **App Review required** for `pages_manage_posts`, `pages_read_engagement`, `business_management` etc. before non-admin accounts can be connected. While the app is in dev mode, only accounts with app roles work — fine for your own team, but plan review submission in Phase 1.
- ⚠️ Personal timelines are not postable via API — Pages only (already reflected in PRD).
- Webhooks subscription for page video status → faster copyright/violation detection than polling.

### TikTok via PostQued (`postqued` adapter) — ✅ validated against OpenAPI spec 2026-07-14
PostQued API v2 (base `https://api.postqued.com`) confirmed to provide everything we need:
- **Auth:** API keys (`pq_…` prefix), created once via `POST /v2/api-keys` from a dashboard session; stored encrypted in our `social_accounts.authPayload`. (Header name to confirm with a `GET /v2/ping` test on first key — spec documents cookie sessions for the docs UI; API keys are the programmatic path.)
- **Account discovery:** `GET /v2/integrations` lists connected TikTok accounts per workspace (`workspaceId` param; org+workspace scoping). Account linking itself is done inside PostQued's dashboard — our connect flow just imports the integration IDs.
- **Publish flow (3 steps):** `POST /v2/content/upload` (filename/contentType/fileSize, ≤ 4 GB video) → returns presigned **PUT** URL + storage key → we PUT the file → `POST /v2/content/upload/complete` (contentId, key, dimensions, durationMs) → `POST /v2/publish` with **`Idempotency-Key` header** (matches our idempotency design 1:1) and targets: `{platform:'tiktok', accountId, intent:'draft'|'publish', caption, dispatchAt (ISO future = scheduled, null = now), options:{privacyLevel, disableComment, disableDuet, disableStitch, autoAddMusic, videoCoverTimestampMs, brandContentToggle, …}}`.
- **`intent:'draft'`** maps perfectly to our failure-protocol Draft state and to pre-approval staging.
- **Scheduling control:** `PATCH /v2/publish/target/{targetId}` (reschedule) and `POST …/cancel` per target — our dispatcher can either pass `dispatchAt` or keep `dispatchAt:null` and own all timing (chosen: **we own timing**, `dispatchAt:null` at dispatch, consistent with YT/FB).
- **Status/verify:** `GET /v2/publish/{publishId}` for publish status polling (our verify job).
- **Analytics:** `GET /v2/analytics/posts` (per account, range week/month/all) and `GET /v2/analytics/videos` (cursor-paginated per account) — feeds `metric_snapshots_*`.
- **TikTok compliance:** `GET /v2/integrations/{id}/creator-info` exposes TikTok's required creator-info check (privacy options, duet/stitch availability) — surfaced in our publish preflight.
- **Bonus:** PostQued also supports YouTube/Facebook/Instagram/9 other platforms through the same `PublishTarget` schema — a ready-made fallback publisher if a direct adapter is ever broken, and a cheap path to platforms we don't build direct adapters for.

## 3. Scheduling Engine

Two layers:

**Layer 1 — Slot planner (per account).** From `channel_profiles.schedulingPrefs` + `schedule_slots`: generates concrete upcoming publish slots (daily/weekly/monthly rules, custom calendar dates, preferred times, randomized windows → slot time = `random(start,end)` fixed at assignment so it doesn't drift). Respects `maxPerDay`, `minGapMin`, blackout dates, account timezone (DST-safe via IANA tz).

**Layer 2 — Dispatcher.** Every minute (pg-boss cron job): find `publish_targets` with `scheduledAt <= now` and status `SCHEDULED` → enqueue `publish` job with `singletonKey = publishTargetId` (double-dispatch impossible). Per-account rate limiter prevents bursts (platform spam signals).

Queue modes map to the planner: `NOW` bypasses (immediate dispatch) · `FIXED` uses given datetime · `QUEUE_SLOT` takes next free generated slot · `RANDOM_WINDOW` takes next slot from a randomized window rule.

Calendar UI = read/write view over `publish_targets.scheduledAt` (drag = reschedule, validated against slot rules with override option).

## 4. Publish Job Lifecycle

1. Preflight: media file present locally (restore from Drive if evicted) · metadata valid vs constraints · account `HEALTHY` (else instant DRAFT+incident) · token fresh (refresh if < 10 min).
2. Upload via adapter (resumable where supported; progress → SSE to dashboard).
3. Record `publish_attempts` row; success → target `PUBLISHED`, store `platformPostId`, schedule **verify job** at +15 min and +24 h.
4. Verify job: adapter `verify()` → copyright claim/block/processing failure ⇒ **failure protocol** (doc 04 §4): target → `DRAFT`, incident, notify. Clean ⇒ begin metric syncing for the post.
5. Error handling matrix:

| Error class | Action |
|---|---|
| Auth/token invalid | Account → `BROKEN`, pause account queue, incident, notify re-auth link |
| Rate limit | Backoff per Retry-After, up to 5 attempts across ≥ 1 h |
| Transient (5xx/network) | Exp backoff ×5 |
| Media invalid / policy reject | Terminal → DRAFT + incident (no auto-retry) |
| Copyright claim (verify) | DRAFT + incident kind COPYRIGHT; original stays archived for dispute evidence |

6. Manual retry from Incident center re-enqueues with attempt history preserved.

## 5. Cross-Posting Semantics

One `content_item` → N `publish_targets`. Each target independently resolves metadata (channel templates + per-target overrides), schedules on its own account's rules, fails/retries independently. A copyright strike on one platform automatically flags sibling targets still `SCHEDULED` for review (setting: auto-hold siblings on first strike — default ON).
