# 04 — Workflow Diagrams & State Machines

## 1. Pipeline 1 — Public Content Repurposing (Kuaishou → Publish)

```mermaid
flowchart TD
    A[Watched source poll\nevery N hours] -->|new video IDs| B{Already known?\nsource ID + perceptual hash}
    A2[Bulk URL import] --> B
    B -->|duplicate| SKIP[Mark SKIPPED_DUPLICATE]
    B -->|new| C[Download original\nyt-dlp → local hot storage]
    C --> D[Ingest processing:\ntrim first 0.5s · normalize MP4\nthumbnails · perceptual hash · md5]
    D --> E[REVIEW QUEUE\nin-app preview + rights note required]
    E -->|reject| REJ[REJECTED\noriginal archived or purged per setting]
    E -->|approve + pick target channels| F[AI ANALYSIS\nGemini video understanding via key pool]
    F --> G[Generate rewritten narration\n+ title/desc/tags/keywords\nper channel master prompt]
    G --> H{Script gate\nchannel approvalPolicy}
    H -->|manual| H2[Owner edits/approves script] --> I
    H -->|auto| I[TTS voiceover\nKokoro default / Gemini / OpenAI]
    I --> J[Audio merge - ffmpeg:\nDemucs split vocals vs background\nmute dialogue · keep music optional\noverlay VO · loudness normalize]
    J --> K[Final render + archive\noriginal & final → Google Drive]
    K --> L[Metadata applied per target account\nfrom Channel Profile templates]
    L --> M[SCHEDULE\nslot / fixed / random window / now]
    M --> N[PUBLISH ENGINE\nsee doc 06]
    N -->|success| O[PUBLISHED\n+ verify-live follow-up job]
    N -->|copyright / error| P[→ DRAFT + INCIDENT\nnotify team · one-click retry]
```

**Content item state machine:** `INGESTED → REVIEW_PENDING → APPROVED → ANALYZING → SCRIPT_READY → SCRIPT_APPROVED → TTS_DONE → RENDERED → METADATA_READY → SCHEDULED → PUBLISHING → PUBLISHED` with side exits to `REJECTED` (review), `DRAFT` (publish failure/copyright), `FAILED` (unrecoverable processing error, retryable). Every transition timestamps + records actor (user or job).

## 2. Pipeline 2 — AI Content Research & Worker Production

```mermaid
flowchart TD
    A[Competitor channel poll] --> B[Fetch recent uploads:\ntitle · views · date · duration\ntranscript: captions → Whisper fallback]
    B --> C[AI: generate ORIGINAL ideas\ncompetitor data + channel master prompt\nangle · hook · rationale]
    C --> D[IDEA BOARD\nSuggested column]
    D -->|owner rejects| X[REJECTED - logged for\nnegative examples in future prompts]
    D -->|owner approves| E[AI: full production brief\nresearch summary · script · scenes\nimage/video/character prompts · editing notes]
    E --> F[TASK POOL]
    F --> G[Auto-assign to worker\n1 active task each]
    G --> H[Worker portal: view brief\nupload finished video]
    H --> I{Reviewer check}
    I -->|revision| G2[REVISION_REQUESTED\nback to same worker] --> H
    I -->|accept| J[Content item created\n→ metadata → schedule → publish\nsame machinery as Pipeline 1]
    J --> K[Worker auto-receives\nnext approved task]
```

## 3. Pipeline 3 — AI Drama Series (TikTok)

```mermaid
flowchart TD
    A[Wizard: genre · theme · audience\nepisode count · episode duration] --> B[AI: series bible\noutline · world · tone\n+ character sheets with locked\nvisual descriptors]
    B --> C[Owner reviews/edits bible & characters]
    C --> D[Generate Episode N on demand:\nscript · scene breakdown · scene image prompts\nscene video prompts · narration · production notes\nContext injected: bible + characters + prev episode recaps]
    D --> E[Episode task → worker\nsame task loop as Pipeline 2]
    E --> F[Upload → review → schedule\nepisodes auto-sequenced with\nconfigurable gap e.g. 1/day]
    F --> G[Next episode prompts unlocked\nafter previous upload]
```

Consistency mechanics: character sheets are immutable per series (edits create a new version, flagged on affected episodes); every episode generation includes bible + sheets + auto-generated recap of episodes 1..N-1 (recaps cached, cheap).

## 4. Publish Failure / Copyright Protocol (all pipelines)

```mermaid
flowchart TD
    A[Publish attempt] --> B{Outcome}
    B -->|success| C[Verify-live job +15min:\nprocessing OK? claim? restriction?]
    C -->|clean| D[PUBLISHED · metrics sync begins]
    C -->|copyright claim / block| E
    B -->|auth error| E[HALT workflow for item]
    B -->|rate limit| R[Retryable: exp backoff\nrespect platform Retry-After]
    B -->|platform reject / policy| E
    R -->|retries exhausted| E
    E --> F[Target → DRAFT\nfull error payload stored]
    F --> G[INCIDENT created\nkind + severity]
    G --> H[Notify: in-app + Telegram/email]
    H --> I[Incident center: inspect →\nfix cause → one-click retry\nor discard]
    E -.->|auth error| J[Also: mark account BROKEN\npause its whole queue until re-auth]
```

## 5. Ingest Watcher Detail (dedupe correctness)

1. Poll source → list latest video entries (ID, title, publish date).
2. `source_videos` upsert by (source, platformId) — existing = stop.
3. New → enqueue download. After download compute md5 + perceptual hash (pHash of sampled frames).
4. pHash within Hamming distance threshold of an existing item → flag `NEAR_DUPLICATE`, still enters review queue with a "possible duplicate of X" banner (reviewer decides).
5. Watcher errors (layout change, blocked, geo) → source `status=ERROR` + incident; watcher auto-pauses after 3 consecutive failures instead of hammering.

## 6. Review Queue UX Contract

- Video player with speed controls + trim preview (shows exactly what the 0.5 s trim removed; adjustable per item).
- Required before approve: target channel(s) + rights note (prefilled from source default).
- Batch actions: approve/reject multiple; keyboard shortcuts (space=play, A=approve, R=reject).
- Approve triggers Pipeline 1 automatically; queue shows live downstream status per item.
