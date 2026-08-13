/**
 * In-code system prompts + Zod schemas for the REPURPOSED content AI pipeline
 * (analyze → narrate → metadata). Docs/05 §7: task templates ship versioned
 * in-code; channel style is injected separately via withChannelStyle.
 *
 * Bump REPURPOSE_PROMPT_REV whenever these templates change so cache keys move
 * even when the DB PromptVersion row is unchanged / absent.
 */
import { z } from 'zod';
import { TaskType, languageDisplayName } from '@scp/shared';

/** Folded into cache promptVersion for VIDEO_ANALYSIS / NARRATION_REWRITE / METADATA. */
export const REPURPOSE_PROMPT_REV = 3;

export const videoAnalysisSegmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  whatHappens: z.string().min(1),
  visuals: z.string().nullish().transform((v) => v ?? ''),
  speechOrAudio: z.string().nullish().transform((v) => v ?? ''),
  mood: z.string().nullish().transform((v) => v ?? ''),
});

export const videoAnalysisOutputSchema = z.object({
  summary: z.string().min(1),
  overallWhatHappens: z.string().min(1),
  durationSec: z.number().nullish(),
  setting: z.string().nullish().transform((v) => v ?? ''),
  characters: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  segments: z.array(videoAnalysisSegmentSchema).min(1),
  hookMoments: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  pacingNotes: z.string().nullish().transform((v) => v ?? ''),
});

export type VideoAnalysisOutput = z.infer<typeof videoAnalysisOutputSchema>;

export const narrationRewriteOutputSchema = z.object({
  /** Full voiceover script ready for TTS (plain prose, no stage directions). */
  script: z.string().min(1),
  /** First-line hook called out for reviewers. */
  hook: z.string().nullish().transform((v) => v ?? ''),
  estimatedSpokenSec: z.number().nullish(),
});

export type NarrationRewriteOutput = z.infer<typeof narrationRewriteOutputSchema>;

export const metadataOutputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  keywords: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  category: z.string().nullish(),
});

export type MetadataOutput = z.infer<typeof metadataOutputSchema>;

export const DEFAULT_VIDEO_ANALYSIS_PROMPT = `You are a sharp video analyst for a social-content repurposing pipeline.

Watch / study the ENTIRE video from start to finish (or every frame/sample provided). Your job is to report WHAT IS HAPPENING — clear beat-by-beat / segment understanding across the full timeline — not a vague one-line blurb.

Return ONLY JSON matching this shape:
{
  "summary": string,                 // 2-4 sentence overview of the whole clip
  "overallWhatHappens": string,      // plain-language arc: beginning → middle → end
  "durationSec": number | null,      // best estimate of total length in seconds
  "setting": string,                 // where / when / vibe
  "characters": string[],            // people, animals, or key subjects (short labels)
  "segments": [                      // REQUIRED: cover the FULL timeline with contiguous beats
    {
      "startSec": number,
      "endSec": number,
      "whatHappens": string,         // concrete action/events in this beat (who does what)
      "visuals": string,             // framing, text on screen, cuts, notable props
      "speechOrAudio": string,       // dialogue, VO, SFX, music if audible
      "mood": string                 // energy / emotion of this beat
    }
  ],
  "hookMoments": string[],           // timestamps/moments that would grab a scroll-stopping viewer
  "pacingNotes": string              // how the clip moves; denseness; dead air
}

Rules:
- Segments must span the full video with little/no gap. Prefer ~2–6s beats for short clips; longer clips may use ~4–10s beats. Never collapse the whole video into one segment unless it is under ~3 seconds.
- Describe observable action and events — not marketing copy.
- If only frames/samples are attached (not the full video file), infer the timeline from their timestamps and still produce contiguous segments covering 0 → durationSec.
- If no media is attached, say so in summary and produce best-effort segments from metadata only.
- Do not invent brands, products, or plot that are not supported by the media/metadata.`;

export function defaultNarrationRewritePrompt(language?: string | null): string {
  const lang = languageDisplayName(language);
  return `You are an elite short-form storytelling narrator for social video.

Given a structured beat-by-beat video analysis, write an engaging VOICEOVER SCRIPT that a host would speak over the clip.

Return ONLY JSON:
{
  "script": string,              // the full narration to speak (TTS input) — plain text only
  "hook": string,                // the opening hook line (also included at the start of script)
  "estimatedSpokenSec": number   // rough spoken duration at conversational pace
}

Storytelling voice (critical):
- Open with a HOOK in the first 1–2 seconds of speech — curiosity, stakes, or a bold "let's…" invitation. Do not start with dry scene-setting.
- Guide the viewer through the video like a friend on the journey: "let's do this / now this / then this / watch what happens…" — conversational, energetic, present-tense when it fits.
- Match the on-screen beats and timing from the analysis segments. The script should feel timed to the video length (roughly 2.3–2.8 spoken words per second of video). Prefer covering the full arc rather than stopping early.
- Sensory and vivid when appropriate (what we see/feel/hear) — still natural spoken language, not purple prose.
- Follow the channel writing / narration style block when provided. Write the script in ${lang}.
- No stage directions, timestamps, speaker labels, brackets, or markdown — ONLY words meant to be spoken aloud.
- Do not invent facts contradicted by the analysis. You may heighten energy and framing, not the plot.`;
}

/** Platform keys match Prisma `Platform` (YOUTUBE / TIKTOK / FACEBOOK). */
export type MetadataPlatform = 'YOUTUBE' | 'TIKTOK' | 'FACEBOOK' | string;

function platformMetadataGuidance(platform?: string | null): string {
  switch ((platform ?? '').toUpperCase()) {
    case 'YOUTUBE':
      return `Target platform: YouTube (Shorts / upload).
- title: SEO-aware, searchable, ~40–70 chars preferred (hard max ~100). Front-load keywords; avoid ALL CAPS spam.
- description: 1–3 short paragraphs, then a blank line, then 3–8 relevant hashtags on the last lines. Include a light CTA (subscribe / watch next) when natural.
- tags: 8–15 YouTube search tags (plain words/phrases, NOT #hashtags). Mix broad + specific.
- keywords: optional extra search phrases.
- category: optional YouTube-style category label (e.g. Entertainment, Education).`;
    case 'TIKTOK':
      return `Target platform: TikTok.
- title: scroll-stopping hook in ~5–12 words (what the viewer gets in the first seconds). No SEO essay titles.
- description: 1–2 punchy lines + a CTA. End with 3–5 strong hashtags inline or at the end.
- tags: 5–10 hashtag-style labels WITHOUT the # prefix (TikTok discover tags). Prefer trending-relevant + niche, not spam piles.
- keywords: optional.
- category: optional.`;
    case 'FACEBOOK':
      return `Target platform: Facebook (Reels / Page video).
- title: clear, conversational, share-friendly; ~40–80 chars.
- description: 1–3 short paragraphs for the feed caption; soft CTA (like / share / follow). Light hashtag use (0–5) at the end if helpful — Facebook is not hashtag-first.
- tags: 5–12 topical labels (plain words). Avoid stuffing.
- keywords: optional.
- category: optional.`;
    default:
      return `Target platform: ${platform?.trim() || 'social video'} (generic short-form).
- title: catchy, not clickbait-spam; match channel language/style.
- description: 1–3 short paragraphs + soft CTA if natural.
- tags: 8–15 relevant tags (plain words; no # prefix required).
- keywords / category: optional.`;
  }
}

/**
 * Publish-ready metadata prompt tailored to the SocialAccount platform.
 * Channel style is appended separately via withChannelStyle.
 */
export function defaultMetadataPrompt(platform?: string | null): string {
  return `You write publish-ready metadata for a repurposed short-form video.

${platformMetadataGuidance(platform)}

Given the narration script (and analysis when present), plus the platform field in the user JSON, return ONLY JSON:
{
  "title": string,
  "description": string,
  "tags": string[],
  "keywords": string[],
  "category": string
}

Optimize title, description, and tags specifically for the target platform above.
Follow the channel style block when provided. Match the channel language. No markdown fences.`;
}

/** @deprecated Prefer defaultMetadataPrompt(platform) — kept for callers without platform. */
export const DEFAULT_METADATA_PROMPT = defaultMetadataPrompt(null);

export function builtinSystemPrompt(
  task: string,
  language?: string | null,
  platform?: string | null,
): string {
  switch (task) {
    case TaskType.VIDEO_ANALYSIS:
      return DEFAULT_VIDEO_ANALYSIS_PROMPT;
    case TaskType.NARRATION_REWRITE:
      return defaultNarrationRewritePrompt(language);
    case TaskType.METADATA:
      return defaultMetadataPrompt(platform);
    default:
      return `You are a video content processing AI. Task: ${task}`;
  }
}

export function schemaForRepurposeTask(task: string) {
  switch (task) {
    case TaskType.VIDEO_ANALYSIS:
      return videoAnalysisOutputSchema;
    case TaskType.NARRATION_REWRITE:
      return narrationRewriteOutputSchema;
    case TaskType.METADATA:
      return metadataOutputSchema;
    default:
      return undefined;
  }
}

/** Extract TTS-ready plain script from narration model output (object or string). */
export function extractNarrationScript(output: unknown): string {
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as { script?: unknown };
        if (typeof parsed.script === 'string' && parsed.script.trim()) {
          return parsed.script.trim();
        }
      } catch {
        /* fall through */
      }
    }
    return trimmed;
  }
  if (output && typeof output === 'object') {
    const script = (output as { script?: unknown }).script;
    if (typeof script === 'string' && script.trim()) return script.trim();
  }
  return String(output ?? '').trim();
}

/** Cache promptVersion: DB version when present, else builtin rev; always fold pipeline rev. */
export function repurposePromptVersion(dbVersion: number | null | undefined): number {
  const base = dbVersion && dbVersion > 0 ? dbVersion : 1;
  // Encode pipeline rev in the low digits so bumping REPURPOSE_PROMPT_REV always
  // invalidates cache without colliding with ordinary DB version bumps.
  return base * 100 + REPURPOSE_PROMPT_REV;
}
