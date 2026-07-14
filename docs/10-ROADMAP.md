# 10 — Phased Roadmap, Risks & Recommendations

## 1. Phases

Sequenced so **something useful ships every phase** and long external approvals (Google verification, Meta review) start on day one.

### Phase 0 — Foundation (Week 1–2)
Monorepo scaffold (web/api/worker/packages) · deploy/ (pm2 config, VPS setup script, Caddyfile — no Docker) · Postgres/Prisma base schema · Auth + RBAC + user management · settings framework · encrypted secrets vault · audit log · notification skeleton (in-app + Telegram) · CI (lint, typecheck, test, build).
**Also start immediately (external clocks):** Google Cloud project + OAuth consent + **YouTube API audit/verification application**; Meta app creation + **App Review submission** (Reels-only scopes). ~~PostQued API spike~~ ✅ done 2026-07-14 (doc 06 §2).
**Exit:** deployable authenticated shell with roles.

### Phase 1 — Connections & Manual Publishing (Week 3–5)
YouTube OAuth connect + channel profiles · Facebook Pages/BM connect · PostQued adapter · manual upload → metadata editor → publish now/fixed-time → publish engine with failure protocol + incidents + verify jobs · content calendar v1 · tiered storage (local + Drive archive).
**Exit:** the team can publish & schedule to all three platforms from one dashboard. *(Already replaces PostQued-style tools for daily work.)*

### Phase 2 — Ingestion & Review (Week 6–7)
Kuaishou source adapter (yt-dlp) + watcher scheduling + bulk URL import · dedupe (source-ID + pHash) · 0.5 s trim + normalize pipeline · review queue UI (player, batch actions, rights note) · scheduling engine full (slots, random windows, per-account rules).
**Exit:** Pipeline 1 up to human approval works end-to-end.

### Phase 3 — AI Layer & Repurposing Pipeline (Week 8–10)
Provider adapters (Gemini, OpenAI, Kokoro, Whisper) · key pool + rotation + metering + routing table + cache · video analysis → narration → script gate → TTS → Demucs merge → final render → auto-metadata · per-video cost log · AI usage dashboard · prompt playground.
**Exit:** approved video → published video with zero manual steps besides configured gates. **This is the MVP milestone.**

### Phase 4 — Research, Ideas & Worker Loop (Week 11–12)
Competitor channel tracking + transcript fetch · idea generation + Idea Board · production brief generation · worker portal (tasks, brief view, upload) · auto-assignment loop · revision workflow · worker productivity metrics.

### Phase 5 — Drama Workflow (Week 13)
Series wizard · bible + character sheets · on-demand episode packs · episode sequencing into scheduler · consistency recap system.

### Phase 6 — Analytics Deep Dive (Week 14–15)
YouTube Analytics (incl. revenue/RPM) + Meta Insights + PostQued metrics sync jobs · snapshot tables + rollups · all dashboard pages (accounts, posts, funnel, workers, system health) · incident center polish.

### Phase 7 — Hardening & Scale Prep (Week 16)
Backup/restore drill · load test at 2× target volume · security pass (2FA, rate limits, dependency audit) · runbooks · optional: 2nd worker node playbook.

Timeline assumes focused solo development with Claude (Opus writing code, Haiku reading); phases 4–6 can partially parallelize.

## 2. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | ~~YouTube upload quota~~ **CLOSED 2026-07-14:** YouTube publishes via PostQued (Owner decision); remaining Google API use is read-only analytics + thumbnails (~50 units) — default quota is ample | — | — | Direct-upload adapter documented as fallback |
| R2 | ~~Google OAuth verification delays uploads~~ **DOWNGRADED:** only read-only analytics scopes needed; Internal-type Workspace consent screen skips verification entirely | Low | Low | Use Internal consent screen (channels under Workspace org) |
| R3 | Meta App Review rejection/delay | Medium | Medium | Own-team accounts work in dev mode meanwhile; scope-minimal first submission |
| R4 | Kuaishou scraping breaks / blocked | High | Medium | Bulk-URL fallback is first-class; watcher auto-pause; source adapter isolated for quick fixes |
| R5 | ~~PostQued API insufficient~~ **CLOSED 2026-07-14:** OpenAPI spec validated — API keys, presigned upload, idempotent publish, draft intent, scheduling, per-target cancel/reschedule, post+video analytics, TikTok creator-info all confirmed (doc 06 §2) | — | — | Residual: third-party service availability → adapter swap path to official TikTok API remains documented |
| R6 | Copyright strikes on repurposed content → channel terminations | Medium | High | Rights gate, incident center, strike counters, auto-pause rules (doc 08 §5); business-level: licenses |
| R7 | Free-tier AI key stacking → Google account bans | Medium | Medium | Recommend paid Flash (≈$0.01/video); pool works identically with paid keys |
| R8 | Drive as storage: 750 GB/day cap, API changes | Low | Medium | Rate-limited storage queue, multi-account support, md5 verification, local retention until verified |
| R9 | Single-VPS failure | Low | Medium | Nightly tested backups to Drive; 4 h rebuild runbook; media already off-box |
| R10 | Scope creep before MVP | High | Medium | This roadmap; nothing outside current phase without explicit re-plan |

## 3. Recommended Additions (beyond your spec — my PM suggestions)

**Included in the plan above (no extra cost):**
1. **Perceptual-hash dedupe** — prevents accidental republishing (strike protection).
2. **Verify-live follow-up jobs** — catches silent post-upload copyright claims within minutes, not days.
3. **Auto-hold sibling posts** on first copyright strike of a cross-posted item.
4. **Prompt playground + prompt versioning** — safe iteration on master prompts; cache stays correct.
5. **Idea-rejection feedback loop** — the idea generator learns your taste.
6. **Telegram notifications** — free, instant, team-friendly.
7. **Per-video AI cost display** — cost awareness built into the UI.
8. **Account strike counter + auto-pause rules** — channel survival insurance.

**Worth adding soon after MVP (backlog):**
9. **Auto-subtitles** on finals (faster-whisper on our own voiceover → burned or sidecar SRT; boosts retention, free).
10. **A/B title/thumbnail suggestions** — generate 3 variants, YouTube's own Test & Compare where available.
11. **Best-time-to-post learner** — mine snapshot data to auto-tune schedule slots per channel.
12. **Thumbnail generator integration** (image model via same provider layer) using channel thumbnailStyle.
13. **Watermark/branding overlay** per channel (one ffmpeg filter away).
14. **PWA approvals** — review queue + incident actions from a phone.
15. **Multi-language expansion** — same pipeline, per-channel language already in profiles; one channel's content re-voiced into N languages.
16. **Content library search** — full-text over analyses/scripts ("find that video about X") via Postgres FTS.
17. **Instagram Reels adapter** — Meta review scopes already obtained make this cheap to add later.

## 4. Immediate Next Steps

1. ~~Owner answers the 5 open questions~~ ✅ answered 2026-07-14 — recorded in doc 01 §8.
2. On Owner's "go": scaffold Phase 0 (Opus subagents writing, Haiku reading) and set up the task board so every phase above becomes tracked tasks.
3. In parallel, Owner creates the Google Cloud + Meta developer apps (exact click-by-click instructions provided at Phase 0 start — both need Owner's accounts). Owner also creates a PostQued API key (`Settings → API Keys` in their dashboard) when Phase 1 starts.
