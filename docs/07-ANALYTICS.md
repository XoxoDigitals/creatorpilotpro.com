# 07 — Analytics Architecture

## 1. Principle

Analytics is **snapshot-based**: scheduled sync jobs pull platform metrics into daily snapshot tables; dashboards read only our DB (fast, quota-friendly, keeps history even if platform APIs change or accounts disconnect).

## 2. Data Sources & Sync Jobs

| Source | Metrics | Cadence | Quota notes |
|---|---|---|---|
| YouTube Analytics API | views, watch time, CTR (impressions), avg view duration, retention curves, subs, **revenue/RPM** (monetized channels, `yt-analytics-monetary.readonly` scope) | nightly per channel; hot posts (< 7 days old) every 6 h | Analytics API quota is separate from Data API and generous |
| YouTube Data API | video status, comments/likes counts | with verify + nightly | cheap calls (1 unit) |
| Meta Graph Insights | page fans, reach, video views, watch time, Reels metrics; monetization where exposed | nightly + 6 h hot window | rate-limited per token; batched requests |
| PostQued / TikTok | whatever the bridge exposes (views, likes, shares, followers) | nightly | validate in Phase 1 spike |
| Internal | AI usage, storage, queues, publish success, worker productivity | real-time / hourly rollups | — |

Sync jobs are per-account, quota-aware (spread across the night, jittered), idempotent upserts on `(accountId|postId, date)`.

## 3. Dashboard Pages

1. **Overview:** today's publishes, failures, review-queue depth, follower/view deltas across all accounts, open incidents, AI spend today, storage headroom.
2. **Accounts:** table + per-account drill-down — growth charts, revenue & RPM trend (monetized badge), publishing history, health (token, quota, strikes).
3. **Posts:** per-post metric timelines, retention curve (YT), status history, incident links; sortable "best performers" view feeding idea generation.
4. **Content pipeline:** funnel (ingested → reviewed → processed → published) with stage timings; bottleneck highlighting.
5. **AI usage:** per provider/key/task-type: requests, tokens, TTS seconds, cache-hit rate, estimated cost, key health board.
6. **Workers:** tasks completed, avg turnaround, revision rate, current assignment, leaderboard (optional visibility to workers).
7. **Incidents:** filterable center (kind/severity/account/status) with resolution workflow.
8. **System health:** queue depths & failure rates (from pg-boss tables + `job_runs`), disk usage, Drive upload backlog, watcher statuses, DB health, last backup age.

## 4. Metric Semantics

- Money stored as micros + currency; RPM computed = revenue / (views/1000) over the same window.
- CTR only where impressions exist (YouTube); dashboards hide metrics a platform doesn't expose rather than showing zeros.
- Retention stored as raw curve JSON (YT `elapsedVideoTimeRatio` buckets), rendered as sparkline.
- Cross-platform rollups use platform-neutral base metrics only (views, posts, followers) to avoid apples-to-oranges.

## 5. Worker Productivity Definition

Per worker per week: tasks assigned/completed, median assign→upload hours, revision-request rate, published-video performance of their tasks (median views at 7 days). Purpose: coaching signal, not surveillance — visible to Owner/Admin; each worker sees own stats.

## 6. Performance

Snapshot tables are append-only and indexed by (entity, date) — years of data stay queryable; nightly rollup materialized views (`ai_usage_daily`, account monthly aggregates) keep dashboard queries < 100 ms without a separate analytics DB. If volume ever demands it, snapshots migrate cleanly to TimescaleDB (same Postgres).
