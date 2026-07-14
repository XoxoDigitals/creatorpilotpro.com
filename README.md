# SocialCreatorPilot

Self-hosted bulk social media management platform for multi-account publishing, AI-assisted content production, and deep analytics — built for cost efficiency first.

**Platforms:** YouTube (publish via PostQued; analytics/revenue/thumbnails via read-only Google APIs) · Facebook Reels (Meta Graph API) · TikTok (via PostQued) — all pluggable adapters
**Pipelines:** ① Reviewed public-content repurposing (Kuaishou source → review → AI rewrite → TTS → merge → publish) · ② AI content research & production for human video teams · ③ AI short-drama series for TikTok

## Documentation Index

| Doc | Contents |
|---|---|
| [01-PRD.md](docs/01-PRD.md) | Product requirements, personas, functional & non-functional requirements |
| [02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | System architecture, tech stack, folder structure, API design, queues, storage (Google Drive tiering), deployment |
| [03-DATABASE.md](docs/03-DATABASE.md) | Full database schema by domain, indexes, encryption |
| [04-WORKFLOWS.md](docs/04-WORKFLOWS.md) | End-to-end workflow diagrams & state machines for all three pipelines |
| [05-AI-LAYER.md](docs/05-AI-LAYER.md) | AI provider abstraction, API key pool & rotation, task routing, TTS, caching |
| [06-PUBLISHING-SCHEDULING.md](docs/06-PUBLISHING-SCHEDULING.md) | Publishing engine, platform adapters, scheduling engine, failure & copyright handling |
| [07-ANALYTICS.md](docs/07-ANALYTICS.md) | Analytics architecture: account/post metrics, revenue, AI usage, worker productivity, system health |
| [08-SECURITY-COMPLIANCE.md](docs/08-SECURITY-COMPLIANCE.md) | Roles & permissions, token security, audit, backups, content-rights & platform-policy compliance |
| [09-COST-OPTIMIZATION.md](docs/09-COST-OPTIMIZATION.md) | Cost strategy: infra sizing, AI cost controls, self-hosted alternatives, estimated monthly budget |
| [10-ROADMAP.md](docs/10-ROADMAP.md) | Phased development roadmap, risk register, recommended extra features |

## Headline Architecture Decisions

- **Modular monolith** in a TypeScript monorepo: Next.js web app + NestJS API + pg-boss worker processes. One VPS to start (native services, pm2 — **no Docker**, Owner decision), splits cleanly later.
- **PostgreSQL only** for data **and** job queues (pg-boss — no Redis). **ffmpeg / yt-dlp / Demucs / faster-whisper / Kokoro TTS** self-hosted for zero-cost media processing.
- **Tiered storage:** local NVMe working area (processing) → **Google Drive (10 TB)** as the media library/archive via Drive API. DB stores Drive file IDs.
- **Provider adapter pattern everywhere:** publishing (YouTube / Facebook / PostQued), AI text (Gemini / OpenAI / future), TTS (Kokoro self-hosted / Gemini TTS / OpenAI TTS), video sources (Kuaishou / bulk URL). Everything swappable.
- **AI key pool** with rotation, per-key quota metering, fallback chains, and per-task provider routing.
- **Human review gates** before AI processing and before production; nothing publishes without passing a channel's configured approval policy.
- **Every AI feature optional** and per-channel configurable via Channel Profiles (master prompt, styles, providers, scheduling, publish defaults).

## Status

Planning complete · all open questions resolved (docs/01-PRD.md §8) · PostQued API validated against its OpenAPI spec ([docs/specs/postqued-openapi.json](docs/specs/postqued-openapi.json)) → **ready to start Phase 0** (see [10-ROADMAP.md](docs/10-ROADMAP.md)).

Decisions on file: Facebook = Reels only · Drive = Owner's Google Workspace account · Team = 1 Owner, 1 Reviewer (Content Manager), 3 Workers · source content licensed.
