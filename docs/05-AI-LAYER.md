# 05 — AI Provider Abstraction Layer

## 1. Design Goals

Any AI capability = a **task type** routed through a **provider chain** executed over a **key pool**, with caching in front. No feature code ever names "Gemini" directly.

## 2. Task Types

| Task | Input | Output | Default chain |
|---|---|---|---|
| `VIDEO_ANALYSIS` | video file (or frames+audio transcript for non-multimodal fallback) | structured content summary | Gemini 2.5 Flash (multimodal) |
| `NARRATION_REWRITE` | analysis + channel master prompt + narration style | voiceover script | Gemini 2.5 Flash → Gemini 2.5 Pro (long/complex) |
| `METADATA` | script/analysis + channel templates | title, description, tags, keywords, category | Gemini Flash-Lite class |
| `IDEA_GENERATION` | competitor data + master prompt | ideas[] | Gemini 2.5 Flash |
| `BRIEF_GENERATION` | approved idea + master prompt | production brief (scenes, prompts, characters) | Gemini 2.5 Pro-class (quality matters) |
| `DRAMA_BIBLE` / `DRAMA_EPISODE` | wizard inputs / bible+recaps | series bible / episode pack | Pro-class |
| `TTS` | script + voice settings | audio file | **Kokoro (self-hosted)** → Gemini TTS → OpenAI TTS |
| `TRANSCRIBE` | audio | transcript | YouTube captions (free) → faster-whisper (self-hosted) |

All text outputs requested as **structured JSON** (schema-validated with zod; one repair-retry on invalid JSON before failing over).

## 3. Provider Adapter Interface

```ts
interface AIProvider {
  id: string;                      // "gemini", "openai", ...
  supports: TaskType[];
  generate(req: {
    task: TaskType; model: string;
    system: string; input: AIInput;     // text | fileRef | multimodal parts
    schema?: ZodSchema; maxTokens?: number;
  }, key: PooledKey): Promise<AIResult>; // output + usage {tokensIn/out, ttsSeconds}
  classifyError(e): 'RATE_LIMITED' | 'QUOTA_EXHAUSTED' | 'INVALID_KEY' | 'CONTENT_BLOCKED' | 'TRANSIENT' | 'FATAL';
}
```

Adapters v1: `gemini` (AI Studio API, incl. Files API for video upload + TTS models), `openai` (text + TTS), `kokoro` (local HTTP micro-service), `whisper` (local). Adding a provider = one package, zero feature-code changes.

## 4. Key Pool & Rotation

State per key: `ACTIVE | COOLDOWN(until) | EXHAUSTED(until daily reset) | DISABLED`, plus rolling usage counters (requests/min, requests/day, tokens/min) kept in a small Postgres counters table with in-process rate windows, persisted to `ai_usage_log`.

**Selection algorithm** for a request:
1. Filter keys of the routed provider: `ACTIVE`, with headroom in all configured budgets (rpm/rpd/tpm — set from the provider's published free-tier limits, editable per key).
2. Pick least-recently-used (spreads load evenly).
3. On response: record usage. On error via `classifyError`:
   - `RATE_LIMITED` → key `COOLDOWN` (Retry-After or 60 s), retry immediately with next key.
   - `QUOTA_EXHAUSTED` → key `EXHAUSTED` until provider's daily reset, next key.
   - `INVALID_KEY` → `DISABLED` + incident (owner notified).
   - `CONTENT_BLOCKED` → do **not** rotate (same content will block everywhere); mark item for human review.
   - `TRANSIENT` → same key retry ×2 w/ backoff, then next key.
4. All keys of provider exhausted → next provider in the task's chain. Whole chain exhausted → job delays until earliest key reset, incident raised if delay > threshold.

⚠️ **Honest compliance note (flagged as PM):** Google's AI Studio terms are per-account/project on free-tier limits; running many keys specifically to multiply free quota risks account bans and violates ToS. The pool architecture is identical for **paid** keys (where it's a legitimate throughput/redundancy tool). My recommendation in doc 09: Gemini Flash paid tier is so cheap (~fractions of a cent per video) that paying is the safer plan; the free-tier pool remains your call and the system supports both.

## 5. Caching & Dedupe (biggest cost lever)

- Cache key: `hash(inputContentHash + taskType + model + promptVersion + channelStyleVersion)` → `ai_outputs` lookup before any provider call.
- Video analysis cached by **video content hash** — cross-posting one video to 5 channels analyzes once; only per-channel rewrite/metadata run per channel.
- Prompt/style edits bump `prompt_versions.version`, naturally invalidating only affected cache entries.
- Competitor transcripts fetched once, stored forever.
- Drama recaps cached per episode.
- In-flight dedupe: identical concurrent requests coalesce to one provider call (Postgres advisory lock on the cache key).

## 6. TTS Subsystem

| Provider | Cost | Quality | Notes |
|---|---|---|---|
| **Kokoro-82M (self-hosted)** | $0 | very good, multiple voices | runs CPU, ~faster-than-realtime; default |
| Gemini TTS (Flash TTS) | free tier / cheap paid | very good, controllable style | via same AI Studio keys/pool |
| OpenAI TTS | paid per char | very good | fallback / specific voices |

- Per-channel voice config (provider, voiceId, speed, language); global default in settings; switchable anytime — the merge step just consumes a WAV.
- Long scripts chunked at sentence boundaries, synthesized parallel, concatenated with silence padding, loudness-normalized (EBU R128) before merge.
- Generated voiceovers are assets → archived → reused on re-render (no re-synthesis unless script changed — hash check).

## 7. Prompt Management

- Channel **master prompt** + writing/narration styles versioned (`prompt_versions`).
- A small library of **system prompt templates** per task type ships in-code, versioned; channel master prompt is injected as a section, so improvements to task templates roll out platform-wide without touching channel prompts.
- Idea rejections stored and optionally injected as negative examples ("avoid ideas like…") — feedback loop that improves suggestions over time.
- Prompt playground page (Owner/Admin): dry-run any task against any channel profile with live output, before saving prompt changes.

## 8. Governance

- Per-provider and per-pipeline **kill switches** (system_settings).
- Daily AI budget alarm (tokens and estimated $) with auto-pause option.
- Every AI call logged with content item linkage → per-video cost visible in UI (FR-C7).
