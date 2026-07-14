# 01 — Product Requirements Document (PRD)

## 1. Vision

One self-hosted dashboard from which a small team manages the entire lifecycle of short/long-form video content across many YouTube channels, Facebook Pages/Business Manager assets, and TikTok accounts: sourcing → AI-assisted production → review → scheduling → publishing → analytics → incident handling. Optimized aggressively for low operating cost.

## 2. Goals

1. Connect and manage **unlimited** social accounts per platform from one place.
2. Automate the repetitive 80% of content operations (sourcing, rewriting, voiceover, metadata, scheduling, publishing) while keeping a **human approval gate** at every irreversible step.
3. Give workers ready-to-execute production briefs so weak research/prompting skills stop being a bottleneck.
4. Provide per-account and per-post analytics, revenue (where the platform exposes it), and operational health in one dashboard.
5. Keep monthly running costs near server-cost-only by self-hosting processing and using free AI tiers with disciplined caching.

## 3. Non-Goals (v1)

- No multi-tenant SaaS (single team/org; architecture keeps the door open).
- No native mobile apps (responsive web + PWA is enough).
- No AI **video generation** in-system (workers generate video externally; system generates prompts/scripts/ideas).
- No Instagram/X/Snapchat in v1 (adapter pattern makes them Phase-later additions).
- No direct TikTok API integration in v1 (PostQued is the publishing bridge; adapter is replaceable).

## 4. Personas & Roles

| Role | Who | Can do |
|---|---|---|
| **Owner** | You | Everything: connections, keys, prompts, approvals, publishing, billing-sensitive settings |
| **Admin** | Trusted lead | Everything except managing owners, deleting accounts, viewing raw API keys |
| **Reviewer** | You / senior staff | Approve/reject videos and ideas, edit metadata, manage schedule |
| **Worker** | Video creators | See only their assigned tasks, download briefs, upload finished videos, see own productivity |
| **Analyst** (optional) | Anyone | Read-only dashboards |

## 5. Functional Requirements

### FR-A. Account Connections
- A1. Connect YouTube channels via Google OAuth (per-channel tokens, auto-refresh, re-auth alerts).
- A2. Connect Facebook Pages via Facebook Login incl. Business Manager assets (system-user tokens supported). ⚠️ Meta's API only allows posting to **Pages** — personal profile timelines are not API-postable; personal accounts are used only to grant access to Pages they manage.
- A3. Connect TikTok accounts via PostQued (API key/workspace link); adapter interface so official TikTok Content Posting API can replace it later.
- A4. Connection health monitor: token expiry countdown, failed-refresh alerts, one-click re-auth.
- A5. Each connected account gets a **Channel Profile** (see FR-G).

### FR-B. Public-Content Ingestion (Pipeline 1 sources)
- B1. Add a **watched source**: Kuaishou profile URL + check interval (e.g. every 6h). System lists newly available videos and downloads only new ones (dedupe by source video ID **and** perceptual hash).
- B2. **Bulk URL import** fallback: paste N video URLs; system downloads each. (Primary path if profile monitoring proves unreliable — Kuaishou has no official API; scraping is fragile and may violate their ToS. Both modes ship; monitoring is best-effort.)
- B3. Every download stores: original file, source URL, source ID, uploader, duration, resolution, download date, **rights/license note** (required field before a video can leave review).
- B4. Default processing on ingest: trim first 0.5 s (per-source configurable), normalize container to MP4/H.264, generate thumbnail sprite + preview.
- B5. Duplicate handling: skip exact source-ID repeats; flag perceptual-hash near-duplicates for reviewer decision.
- B6. All ingested videos land in the **Review Queue** with In-app preview. Nothing proceeds without explicit approval.

### FR-C. AI Repurposing (Pipeline 1 processing)
- C1. On approval, send video to the configured AI provider (default Gemini via AI Studio) for content analysis.
- C2. Generate: rewritten narration script (per-channel voiceover style), title, description, tags, keywords, category, AI-label flag — all driven by the channel's master prompt.
- C3. Owner can review/edit the script and metadata before TTS (per-channel toggle: auto-continue vs. gate).
- C4. TTS via selectable provider: self-hosted Kokoro (default, free) / Gemini TTS / OpenAI TTS. Voice, speed, language per channel.
- C5. Audio merge: mute or duck original dialogue while preserving background music/ambience where possible (Demucs vocal separation, per-video toggle: full-mute vs. separate-and-keep-background), overlay generated voiceover, loudness-normalize to platform spec.
- C6. Output final render + keep original; both archived to Google Drive.
- C7. Full cost/usage log per video (which provider, which key, tokens, seconds of TTS).

### FR-D. AI Content Research & Production (Pipeline 2)
- D1. Add competitor YouTube channels per own-channel. System periodically pulls their recent uploads: title, views, publish date, duration, and transcript when available (YouTube captions first; optional self-hosted Whisper fallback).
- D2. Idea generation: from competitor data + channel master prompt → original (not copied) content ideas with predicted angle, hook, and reasoning.
- D3. Owner approves/rejects/edits ideas in an **Idea Board** (kanban: Suggested → Approved → In Production → Uploaded → Published).
- D4. Approved idea → system generates the full **Production Brief**: research summary, script/narration, scene breakdown, per-scene image prompts, per-scene video prompts, character prompts (with consistency descriptors), editing instructions, target duration.
- D5. Task dispatch: workers get one active task at a time (configurable); uploading the finished video auto-assigns their next approved task.
- D6. Uploaded videos go to the review queue → metadata generation → scheduling like any other content.
- D7. Worker productivity tracked per task (assigned→uploaded time, revisions requested).

### FR-E. AI Drama Workflow (TikTok series)
- E1. Wizard: genre, theme, audience, number of episodes, episode duration, style references.
- E2. System generates: series bible (story outline, world, tone), character profiles with locked visual descriptors for consistency, per-episode summaries.
- E3. Per episode: script, scene breakdown, scene image prompts, scene video prompts, narration, production notes — each generated on demand ("give me episode N") so tokens aren't wasted on unproduced episodes.
- E4. Episode consistency: every generation call injects the series bible + character sheets + previous-episode recaps.
- E5. Episodes flow into the same task-dispatch, review, scheduling, and publishing machinery.

### FR-F. Scheduling & Publishing
- F1. Modes: publish now · fixed datetime · queue slots (channel-defined recurring slots: daily/weekly/monthly/custom calendar) · randomized window (e.g. "between 18:00–21:00").
- F2. Per-channel throughput rules: max N posts/day, min gap between posts, blackout dates.
- F3. Content calendar view (month/week/day) across all accounts with drag-to-reschedule.
- F4. Cross-posting: one content item → multiple accounts, each applying its own Channel Profile metadata.
- F5. Publish engine executes via platform adapters with retry/backoff; every attempt logged.
- F6. **Failure protocol:** on auth error, rate limit, restriction, copyright claim, or any publish error → halt that item's workflow, revert to Draft, store full error payload, create an Incident, notify team (in-app + Telegram/email), enable one-click retry after fix.
- F7. Post-publish verification: confirm the post is live and its processing status (e.g. YouTube processing/claim check) on a follow-up job.

### FR-G. Channel Profiles (per connected account)
Master prompt · writing style · narration/voiceover style · preferred AI provider per task (analysis/writing/metadata/TTS) · voice settings · thumbnail style guide · default title/description templates with variables · default keywords/tags · AI-content label default · category/visibility defaults · scheduling preferences · approval policy (which gates are manual vs. auto) · language.

### FR-H. AI Provider & Key Management
- H1. Unlimited API keys per provider; add/disable/delete from settings UI (keys encrypted at rest, never shown again after save).
- H2. Rotation: round-robin among healthy keys; on 429/quota error mark key cooling-down and fail over to next key, then next provider in the priority chain.
- H3. Per-key metering: requests, tokens, TTS seconds, errors, estimated cost; daily/minute budgets per key.
- H4. Per-task routing table: each AI task type (video analysis, narration rewrite, idea generation, brief generation, metadata, TTS) → ordered provider/model chain.
- H5. Response caching: identical (content-hash + prompt-version + model) requests return cached results; never re-analyze an unchanged video.
- H6. Kill switch per provider and per pipeline.

### FR-I. Analytics & Dashboard
- I1. Account level: subscribers/followers growth, views, watch time, CTR, retention, revenue + RPM (YouTube Analytics API where channel is monetized; others where exposed).
- I2. Post level: per-video metrics timeline, publish status history, incidents.
- I3. Ops level: AI usage per provider/key/task, storage usage (local + Drive), queue depths & job failures, worker productivity, publishing success rate, connection health.
- I4. Incident center: all copyright/policy/publish failures with status (open/resolved), filterable.
- I5. Daily metric snapshots retained for trend charts; configurable sync frequency to respect API quotas.

### FR-J. Notifications
In-app notification center + Telegram bot (free) and/or email (SMTP) for: publish success/failure, incidents, review queue additions, token expiry, key exhaustion, watcher errors, worker task events.

## 6. Non-Functional Requirements

- **Cost:** target < $50/mo infra at v1 volumes (see doc 09). All heavy processing self-hosted.
- **Scale (v1 targets):** 100+ connected accounts, ~200 videos/day ingested/processed, 500+ scheduled posts/week, 10 team members. Architecture scales by adding worker containers.
- **Reliability:** jobs idempotent & resumable; no data loss on crash (queue + DB transactional state); nightly DB backups to Drive.
- **Security:** RBAC, encrypted tokens/keys, audit log, no secrets in frontend (doc 08).
- **Maintainability:** adapter interfaces for every external service; typed end-to-end (TypeScript + OpenAPI); seedable dev environment (native Postgres + `pnpm dev`, no Docker per Owner decision).

## 7. Success Metrics

- Time from video ingest → scheduled: < 15 min of human attention.
- ≥ 95% publish success rate (excluding platform-side rejections).
- AI cost per processed video: ≈ $0 on free tiers / < $0.02 on paid Flash-class models.
- Worker throughput visible and improving (briefs remove research time).

## 8. Resolved Decisions (Owner answers, 2026-07-14)

1. **PostQued:** API v2 validated against the official OpenAPI spec (`https://api.postqued.com/v2/docs/openapi.json`, saved copy in repo when Phase 1 starts). Full capability summary in doc 06 §2. Verdict: fully sufficient for TikTok publishing, scheduling, drafts, per-target cancel/reschedule, and post/video analytics. Risk R5 closed.
2. **Storage:** Owner's own Google Workspace account hosts the 10 TB Drive; single-account upload strategy (750 GB/day cap applies to it — fine at our volumes).
3. **Facebook:** **Reels only.** The `facebook` adapter implements the Reels Publishing API path only; feed-video support deferred to backlog.
4. **Team (4–5 people):** 1 Super Admin → `OWNER` role · 1 Content Manager → `REVIEWER` role (approvals, scheduling, sources; Owner can promote to `ADMIN` later if they should manage connections) · 3 Content Generators → `WORKER` role.
5. **Rights:** Owner confirms all repurposed source content is licensed. Rights-note gate stays (it records *which* license covers each video — the paper trail).
