# 03 — Database Design (PostgreSQL + Prisma)

Notation: `PK` primary key (uuid/cuid), `FK→` foreign key, `enc` = AES-256-GCM encrypted at rest, `jsonb` = flexible column. All tables get `createdAt/updatedAt`. Soft-delete (`deletedAt`) on user-facing entities.

## Domain 1 — Identity & Access

**users** — id PK · email uniq · passwordHash · name · role (OWNER/ADMIN/REVIEWER/WORKER/ANALYST) · status · telegramChatId? · lastLoginAt
**sessions** — Auth.js session store
**api_tokens** — id · userId FK→users · name · tokenHash · scopes[] · expiresAt · lastUsedAt
**audit_log** — id · userId? · action · entityType · entityId · before/after jsonb · ip · at *(append-only)*

## Domain 2 — Connections & Channel Profiles

**social_accounts** — id PK · platform (YOUTUBE/FACEBOOK/TIKTOK) · externalId · name · avatarUrl · kind (YT_CHANNEL/FB_PAGE/FB_BM_PAGE/TIKTOK_ACCOUNT) · authPayload `enc jsonb` (OAuth tokens / PostQued ref) · tokenExpiresAt · connectionStatus (HEALTHY/EXPIRING/BROKEN) · monetized bool · timezone · addedBy FK→users
**channel_profiles** — id · accountId FK→social_accounts uniq · masterPrompt text · writingStyle text · narrationStyle text · language · aiRouting jsonb (taskType→provider chain override) · voiceSettings jsonb (provider, voiceId, speed) · thumbnailStyle text · titleTemplate · descriptionTemplate · defaultTags[] · defaultKeywords[] · aiLabelDefault bool · visibilityDefault · categoryDefault · approvalPolicy jsonb (which gates manual/auto) · schedulingPrefs jsonb (slots, maxPerDay, minGapMin, randomWindows, blackoutDates)
**prompt_versions** — id · profileId FK · field (MASTER/WRITING/NARRATION) · content · version · createdBy *(history; AI cache keys include prompt version)*

## Domain 3 — Sources & Ingestion

**watched_sources** — id · type (KUAISHOU_PROFILE) · url · label · checkIntervalMin · trimStartMs default 500 · lastCheckedAt · status (ACTIVE/PAUSED/ERROR) · targetAccountId? FK→social_accounts · errorNote
**source_videos** — id · watchedSourceId? FK · sourceUrl · sourcePlatformId uniq-per-source · uploaderName · title · durationSec · publishedAt · perceptualHash · md5 · downloadStatus (PENDING/DOWNLOADING/DONE/FAILED/SKIPPED_DUPLICATE) · rightsNote · rightsConfirmedBy? FK→users
  *Index:* (watchedSourceId, sourcePlatformId) uniq; perceptualHash for near-dup lookups.

## Domain 4 — Content Core

**content_items** — the central entity; one video project. 
id PK · type (REPURPOSED/WORKER_PRODUCED/DRAMA_EPISODE) · sourceVideoId? FK · ideaId? FK · episodeId? FK · title · status **state machine**: `INGESTED → REVIEW_PENDING → APPROVED → ANALYZING → SCRIPT_READY → SCRIPT_APPROVED → TTS_DONE → RENDERED → METADATA_READY → SCHEDULED → PUBLISHING → PUBLISHED / DRAFT / REJECTED / FAILED` · statusReason · reviewedBy? · currentStep jsonb
**assets** — id · contentItemId FK · kind (ORIGINAL/PROCESSED/VOICEOVER/BG_AUDIO/FINAL/THUMBNAIL/SUBTITLE) · localPath? · driveFileId? · md5 · bytes · durationSec? · width/height? · storageState (LOCAL/UPLOADING/DRIVE/BOTH/EVICTED)
**ai_outputs** — id · contentItemId FK · taskType (ANALYSIS/NARRATION/METADATA/IDEA/BRIEF/EPISODE) · providerId · model · promptVersion · inputHash · output jsonb · tokensIn/out · costEstimate · cached bool
  *Index:* (inputHash, taskType, model) → the AI cache.
**publish_targets** — id · contentItemId FK · accountId FK→social_accounts · metadataOverride jsonb (final title/desc/tags per account) · scheduledAt? · scheduleMode (NOW/FIXED/QUEUE_SLOT/RANDOM_WINDOW) · status (PENDING/SCHEDULED/PUBLISHING/PUBLISHED/FAILED/DRAFT) · platformPostId? · publishedAt? · lastError jsonb
  *(one content item → many targets = cross-posting)*

## Domain 5 — Research, Ideas, Tasks, Dramas

**competitor_channels** — id · ownAccountId FK→social_accounts · youtubeChannelId · name · checkIntervalMin · lastCheckedAt · status
**competitor_videos** — id · competitorChannelId FK · videoId uniq · title · views bigint · publishedAt · durationSec · transcript? text · transcriptSource (CAPTIONS/WHISPER/NONE) · fetchedAt
**ideas** — id · accountId FK · sourceCompetitorVideoIds[] · title · angle · hook · rationale · status (SUGGESTED/APPROVED/REJECTED/IN_PRODUCTION/UPLOADED/PUBLISHED) · decidedBy? · decidedAt?
**production_briefs** — id · ideaId FK uniq · researchSummary · script · sceneBreakdown jsonb[] (scene#, description, imagePrompt, videoPrompt, durationSec) · characterPrompts jsonb[] · editingInstructions · targetDurationSec · version
**worker_tasks** — id · briefId FK · workerId FK→users · status (ASSIGNED/IN_PROGRESS/UPLOADED/REVISION_REQUESTED/DONE) · assignedAt · uploadedAt · contentItemId? FK · revisionNotes[]
**drama_series** — id · accountId FK · title · genre · theme · audience · episodeCount · episodeDurationSec · seriesBible jsonb (outline, world, tone) · characterSheets jsonb[] · status
**drama_episodes** — id · seriesId FK · number · summary · script? · scenePrompts jsonb[] · narration? · productionNotes? · generatedAt? · contentItemId? FK · status
  *Uniq:* (seriesId, number)

## Domain 6 — AI Providers & Keys

**ai_providers** — id · name (GEMINI/OPENAI/…) · kind (TEXT/TTS/MULTIMODAL) · baseConfig jsonb · enabled
**ai_keys** — id · providerId FK · label · key `enc` · priority int · status (ACTIVE/COOLDOWN/EXHAUSTED/DISABLED) · cooldownUntil? · limits jsonb (rpm/rpd/tpm budgets) 
**ai_usage_log** — id · keyId FK · taskType · model · tokensIn/out · ttsSeconds? · latencyMs · outcome (OK/RATE_LIMITED/ERROR) · contentItemId? · at
  *(daily rollups materialized into **ai_usage_daily** for dashboards)*
**ai_task_routing** — id · taskType · chain jsonb (ordered [{providerId, model}]) · scope (GLOBAL or accountId override)

## Domain 7 — Scheduling, Publishing, Incidents

**schedule_slots** — id · accountId FK · rule jsonb (rrule-style: daily/weekly/monthly/custom dates) · timeWindows jsonb ([{start,end,randomize}]) · active
**publish_attempts** — id · publishTargetId FK · attemptNo · startedAt · finishedAt? · outcome (SUCCESS/RETRYABLE_ERROR/TERMINAL_ERROR) · errorCode · errorPayload jsonb
**incidents** — id · kind (COPYRIGHT/AUTH/RATE_LIMIT/PLATFORM_REJECT/WATCHER/STORAGE/SYSTEM) · severity · accountId? · contentItemId? · publishTargetId? · title · detail jsonb · status (OPEN/ACKED/RESOLVED) · resolvedBy? · resolvedAt?
**notifications** — id · userId FK · incidentId? · type · payload jsonb · channels[] (INAPP/TELEGRAM/EMAIL) · readAt?

## Domain 8 — Analytics & System

**metric_snapshots_account** — id · accountId FK · date · followers · views · watchTimeMin · ctr · avgViewDurationSec · revenueMicros? · rpmMicros? · raw jsonb 
  *Uniq:* (accountId, date)
**metric_snapshots_post** — id · publishTargetId FK · date · views · likes · comments · shares · watchTimeMin? · ctr? · retention jsonb? · revenueMicros? · raw jsonb 
  *Uniq:* (publishTargetId, date)
**system_settings** — key PK · value jsonb (Drive accounts, storage thresholds, notification config, feature flags, TTS default, global kill-switches)
**job_runs** — id · queue · jobName · entityId? · status · startedAt/finishedAt · error? *(mirror of pg-boss job history kept 30 days for the ops dashboard)*

## Cross-Cutting Rules

- **Encryption:** `authPayload`, `ai_keys.key`, SMTP/Telegram secrets → AES-256-GCM with `MASTER_KEY` from env (never in DB/repo). Decrypt only in API/worker memory.
- **State machines enforced in service layer** (illegal transitions rejected + audited), not by triggers.
- **Retention:** `ai_usage_log` 90 d (rollups forever) · `job_runs` 30 d · `publish_attempts` forever (small) · snapshots forever (they're the analytics history).
- **Migrations:** Prisma Migrate, forward-only, run on deploy.
