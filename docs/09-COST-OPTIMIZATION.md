# 09 — Cost Optimization Strategy

## 1. Philosophy

Pay for exactly two things: **one VPS** and **electricity-cheap AI text calls**. Everything else — media processing, TTS, transcription, storage, notifications, monitoring — is self-hosted or already owned (your 10 TB Drive).

## 2. Estimated Monthly Budget (v1, ~200 videos/day)

| Item | Choice | Est. cost |
|---|---|---|
| VPS 8 vCPU / 16 GB / 360 GB NVMe | Hetzner/Netcup class | €25–40 |
| Storage | Google Drive 10 TB (already owned) + local NVMe (included) | $0 |
| TTS | Kokoro self-hosted default | $0 |
| Transcription | YT captions + faster-whisper | $0 |
| Vocal separation / render | Demucs + ffmpeg (CPU) | $0 |
| Notifications | Telegram bot + SMTP | $0 |
| Domain + TLS | 1 domain, Caddy/Let's Encrypt | ~$1 |
| AI text/multimodal | Gemini free tier **or** paid Flash (see §3) | $0–15 |
| **Total** | | **≈ $30–60/mo** |

## 3. AI Cost Reality Check (why this stays near zero)

Per repurposed video, typical: video analysis (~10–25k tokens multimodal in, 1k out) + narration rewrite (~3k in / 1k out) + metadata (~2k in / 0.5k out). On **paid Gemini 2.5 Flash** pricing that is roughly **$0.005–0.01 per video** → 200 videos/day ≈ **$30–60/month at absolute worst**, usually far less with caching. Ideas/briefs are token-light by comparison. Conclusion: even fully paid, AI is a rounding error next to the VPS — which is why I recommend paid keys over ToS-risky free-tier stacking, while the key-pool supports both.

## 4. Cost Levers Built Into the Architecture

1. **Cache-first AI** (doc 05 §5): content-hash caching means a video analyzed once is never re-analyzed; cross-posting reuses analysis; prompt-version keys prevent needless invalidation. Target ≥ 30% cache-hit on text tasks.
2. **Right-sized models per task** (routing table): metadata on Flash-Lite-class, only briefs/drama on Pro-class. Never Pro for tag generation.
3. **Frame-sampling fallback:** if multimodal video analysis is expensive/unavailable, degrade to sampled frames + audio transcript (whisper, free) into a text model — 10× cheaper, quality usually sufficient for narration rewriting. Per-channel toggle.
4. **Self-hosted TTS default** (Kokoro): voiceover is the highest-volume generation; making it $0 removes the biggest potential bill. Cloud TTS only where a channel's voice demands it.
5. **On-demand generation:** drama episodes and briefs generate only when approved/requested — no tokens on unapproved ideas.
6. **Media efficiency:** single-pass ffmpeg filter graphs (trim+mux+loudnorm in one encode), H.264 veryfast at source resolution (no unnecessary upscaling), thumbnails from keyframes.
7. **Storage lifecycle:** hot-tier eviction after Drive verification; no paid object storage, no egress fees (Drive API download for restores is free).
8. **Quota as a resource:** YouTube upload quota, Drive daily caps, Meta rate limits all modeled as budgeted resources in the queues — prevents costly failure-retry storms.
9. **SSE not polling** for dashboard live-updates; nightly (not hourly) full metric syncs with a small 6 h "hot posts" window.
10. **Budget alarms:** daily AI token/$ ceiling with auto-pause; storage and quota alerts at 80%.

## 5. Scaling Costs Predictably

Each increment is a conscious spend: +1 worker VPS when media queue saturates (~€25), GPU box only if you want Demucs/Whisper 10× faster (~€80/mo dedicated or on-demand), managed Postgres only past ~50 GB DB. No step function surprises; the dashboard's system-health page shows exactly which resource is nearing its limit before money is needed.
