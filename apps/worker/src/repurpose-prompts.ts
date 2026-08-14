/**
 * In-code system prompts + Zod schemas for the REPURPOSED content AI pipeline
 * (analyze → narrate → metadata). Docs/05 §7: task templates ship versioned
 * in-code; channel style is injected separately via withChannelStyle.
 *
 * Bump REPURPOSE_PROMPT_REV whenever these templates change so cache keys move
 * even when the DB PromptVersion row is unchanged / absent.
 */
import { z } from 'zod';
import { TaskType, formatOutputLanguagePolicy, languageDisplayName } from '@scp/shared';

/** Folded into cache promptVersion for VIDEO_ANALYSIS / NARRATION_REWRITE / METADATA. */
export const REPURPOSE_PROMPT_REV = 8;

export const videoAnalysisSegmentSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  whatHappens: z.string().min(1),
  visuals: z.string().nullish().transform((v) => v ?? ''),
  speechOrAudio: z.string().nullish().transform((v) => v ?? ''),
  mood: z.string().nullish().transform((v) => v ?? ''),
});

export const dialogueRangeSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
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
  hasDialogue: z.boolean().nullish(),
  hasNaturalSound: z.boolean().nullish(),
  /** Precise windows where spoken dialogue occurs (for render mute). */
  dialogueRanges: z
    .array(dialogueRangeSchema)
    .nullish()
    .transform((v) => v ?? []),
  people: z
    .array(
      z.union([
        z.string(),
        z.object({
          label: z.string(),
          originOrContext: z.string().nullish().transform((v) => v ?? ''),
          whyNotable: z.string().nullish().transform((v) => v ?? ''),
        }),
      ]),
    )
    .nullish()
    .transform((v) => v ?? []),
});

export type VideoAnalysisOutput = z.infer<typeof videoAnalysisOutputSchema>;

export const NARRATION_VARIANT_IDS = ['explainer', 'styleB', 'styleC'] as const;
export type NarrationVariantId = (typeof NARRATION_VARIANT_IDS)[number];

export const NARRATION_VARIANT_LABELS: Record<NarrationVariantId, string> = {
  explainer: 'Explainer',
  styleB: 'Hooky / hype',
  styleC: 'Documentary',
};

export const narrationLineSchema = z.object({
  startSec: z.number(),
  endSec: z.number(),
  text: z.string().min(1),
});

export const narrationVariantSchema = z.object({
  id: z.string().min(1),
  style: z.string().nullish().transform((v) => v ?? ''),
  hook: z.string().nullish().transform((v) => v ?? ''),
  script: z.string().min(1),
  estimatedSpokenSec: z.number().nullish(),
  lines: z
    .array(narrationLineSchema)
    .nullish()
    .transform((v) => v ?? []),
});

const narrationRewriteRawSchema = z.object({
  variants: z.array(narrationVariantSchema).min(1).nullish(),
  /** Legacy single-script shape (pre-variant). */
  script: z.string().nullish(),
  hook: z.string().nullish().transform((v) => v ?? ''),
  estimatedSpokenSec: z.number().nullish(),
  lines: z
    .array(narrationLineSchema)
    .nullish()
    .transform((v) => v ?? []),
});

export const narrationRewriteOutputSchema = narrationRewriteRawSchema.superRefine((val, ctx) => {
  if ((val.variants?.length ?? 0) > 0) return;
  if (typeof val.script === 'string' && val.script.trim()) return;
  ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'script or variants required' });
});

export type NarrationRewriteOutput = z.infer<typeof narrationRewriteOutputSchema>;

export interface NarrationScriptVariant {
  id: string;
  label: string;
  style: string;
  hook: string;
  script: string;
  /** Owner-facing English summary when spoken script is non-English. */
  englishSummary?: string;
  estimatedSpokenSec: number | null;
  lines: { startSec: number; endSec: number; text: string }[];
}

function variantLabel(id: string, style: string): string {
  if (id in NARRATION_VARIANT_LABELS) {
    return NARRATION_VARIANT_LABELS[id as NarrationVariantId];
  }
  const trimmed = style.trim();
  return trimmed || id;
}

function coerceVariant(raw: z.infer<typeof narrationVariantSchema>): NarrationScriptVariant {
  const id = raw.id.trim() || 'explainer';
  const style = raw.style.trim() || id;
  return {
    id,
    label: variantLabel(id, style),
    style,
    hook: raw.hook,
    script: raw.script.trim(),
    estimatedSpokenSec:
      typeof raw.estimatedSpokenSec === 'number' && Number.isFinite(raw.estimatedSpokenSec)
        ? raw.estimatedSpokenSec
        : null,
    lines: raw.lines
      .filter((l) => l.text.trim())
      .map((l) => ({
        startSec: l.startSec,
        endSec: l.endSec > l.startSec ? l.endSec : l.startSec,
        text: l.text.trim(),
      })),
  };
}

/** Normalize model output to 1–3 persisted script variants (legacy single script → one variant). */
export function normalizeNarrationVariants(output: unknown): NarrationScriptVariant[] {
  const parsed = narrationRewriteRawSchema.safeParse(output);
  if (parsed.success) {
    if (parsed.data.variants && parsed.data.variants.length > 0) {
      return parsed.data.variants
        .map(coerceVariant)
        .filter((v) => v.script);
    }
    if (parsed.data.script?.trim()) {
      return [
        coerceVariant({
          id: 'explainer',
          style: 'explainer',
          hook: parsed.data.hook,
          script: parsed.data.script,
          estimatedSpokenSec: parsed.data.estimatedSpokenSec,
          lines: parsed.data.lines,
        }),
      ];
    }
  }
  const fallback = extractNarrationScript(output);
  if (!fallback) return [];
  return [
    {
      id: 'explainer',
      label: NARRATION_VARIANT_LABELS.explainer,
      style: 'explainer',
      hook: '',
      script: fallback,
      estimatedSpokenSec: null,
      lines: [],
    },
  ];
}

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
      "speechOrAudio": string,       // quote or paraphrase audible dialogue (who said what / replies), VO, SFX, music
      "mood": string                 // energy / emotion of this beat
    }
  ],
  "hookMoments": string[],           // timestamps/moments that would grab a scroll-stopping viewer
  "pacingNotes": string,             // how the clip moves; denseness; dead air
  "hasDialogue": boolean,            // true if people are talking / there is spoken dialogue or on-screen VO
  "hasNaturalSound": boolean,        // true if ambience/SFX/music is audible even without dialogue
  "dialogueRanges": [                // REQUIRED when hasDialogue: precise time windows of spoken dialogue
    { "startSec": number, "endSec": number }
  ],
  "people": [                        // notable on-screen people/subjects (empty if none)
    {
      "label": string,               // who (name if known, else short descriptor)
      "originOrContext": string,     // place, role, or scene context (e.g. "China", "street magician")
      "whyNotable": string           // why a narrator would hook on them
    }
  ]
}

Rules:
- Segments must span the full video with little/no gap. Prefer ~2–6s beats for short clips; longer clips may use ~4–10s beats. Never collapse the whole video into one segment unless it is under ~3 seconds.
- Describe observable action and events — not marketing copy.
- Set hasDialogue true only when spoken words/talking are actually audible. Background crowd murmur without intelligible speech is NOT dialogue.
- When people speak, put the substance of what was said (and any reply) into that beat's speechOrAudio — approximate quotes are fine — so the Explainer narrator can describe the conversation later.
- When hasDialogue is true, fill dialogueRanges with every contiguous window where spoken words are audible (tight start/end, merge gaps under ~0.3s). These ranges drive precise mute of original speech in render — prefer accuracy over covering the whole clip. If hasDialogue is false, return dialogueRanges: [].
- Set hasNaturalSound true when there is audible ambience, SFX, or music (even if hasDialogue is false).
- If a person (or a few key people) is clearly the subject, fill people[] with the best label + origin/context + why they stand out. Do not invent celebrity identities you cannot support.
- If only frames/samples are attached (not the full video file), infer the timeline from their timestamps and still produce contiguous segments covering 0 → durationSec.
- If no media is attached, say so in summary and produce best-effort segments from metadata only.
- Do not invent brands, products, or plot that are not supported by the media/metadata.`;

export function defaultNarrationRewritePrompt(language?: string | null): string {
  const lang = languageDisplayName(language);
  return `You are an elite short-form storytelling narrator for social video.

Given a structured beat-by-beat video analysis PLUS a duration budget, write THREE different VOICEOVER SCRIPTS. The reviewer will pick one. TTS speaks only the approved script.

Return ONLY JSON:
{
  "variants": [
    {
      "id": "explainer",
      "style": "explainer",
      "hook": string,
      "script": string,
      "estimatedSpokenSec": number,
      "lines": [{ "startSec": number, "endSec": number, "text": string }]
    },
    {
      "id": "styleB",
      "style": "hooky",
      "hook": string,
      "script": string,
      "estimatedSpokenSec": number,
      "lines": [{ "startSec": number, "endSec": number, "text": string }]
    },
    {
      "id": "styleC",
      "style": "documentary",
      "hook": string,
      "script": string,
      "estimatedSpokenSec": number,
      "lines": [{ "startSec": number, "endSec": number, "text": string }]
    }
  ]
}

Three distinct tones (required — do not duplicate copy):
1. explainer — clear how-to / what's-happening narration. Guide the viewer through the clip plainly.
   CRITICAL — character dialogue: when analysis hasDialogue is true OR any beat's speechOrAudio contains spoken lines / conversation, the Explainer MUST narrate what was said and replied in third-person explainer style (e.g. "She asks…", "He replies…", "The vendor explains…"). Cover the conversation so viewers understand the spoken content without hearing original audio. Do not ignore dialogue beats or leave them as silent visuals-only lines when speech was present.
2. styleB — hooky / hype / curiosity. Energetic, scroll-stopping, still accurate to the analysis. May paraphrase dialogue more loosely than Explainer.
3. styleC — calm storytelling / documentary. Measured, vivid, present-tense when it fits. May summarize spoken moments without beat-by-beat quotes.

Timing (critical — VO must sync to the picture at natural pace):
- The user JSON includes durationSec, maxSpokenSec, maxWords, and beats[] (startSec/endSec/durationSec/maxWords/whatHappens).
- Each variant MUST include lines[] aligned to those beats: one line per beat covering the FULL video timeline (merge tiny beats if needed). Do not stop narrating halfway — every major beat gets a line so speech is spread across the whole clip.
- Prefer short lines that fit each beat's maxWords (≈2.2 words/sec). TTS plays at NATURAL pace and will NOT speed up; if a line is a bit long it may spill into the next gap — that is OK. Never write a dense paragraph for a 2s beat.
- script is the full TTS string: concatenate lines[] in order as plain prose (spaces, no timestamps).
- estimatedSpokenSec should be near the video length (spread across beats with natural gaps), not a single early block that ends at ~half the video.
- If a beat is visual-only, a short line is fine; do not pad with filler that overruns the next scene.
- When dialogue exists, still narrate what was said/replied — but keep those lines within the beat maxWords (summarize the exchange if needed).

Storytelling:
- Open with a HOOK in the first 1–2 seconds of speech — curiosity, stakes, or a bold invitation. Do not start with dry scene-setting.
- If the analysis identifies a person (people[] / characters), write a compelling narrator hook ABOUT THEM in that opening using only facts the analysis supports.
- Follow the channel writing / narration style block when provided. Write the spoken scripts in ${lang}.
- Keep this instruction prompt in English. The spoken voiceover scripts themselves must be ${lang}.
- No stage directions, speaker labels, brackets, or markdown inside script or lines[].text — ONLY words meant to be spoken aloud.
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
export function defaultMetadataPrompt(platform?: string | null, language?: string | null): string {
  const lang = languageDisplayName(language);
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
Follow the channel style block when provided.
${formatOutputLanguagePolicy(language)}
Write title, description, tags, and keywords in ${lang}. Keep this instruction prompt in English. No markdown fences.`;
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
      return defaultMetadataPrompt(platform, language);
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
export function extractNarrationScript(output: unknown, selectedId?: string | null): string {
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        const nested = extractNarrationScript(parsed, selectedId);
        if (nested) return nested;
      } catch {
        /* fall through */
      }
    }
    return trimmed;
  }
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (Array.isArray(obj.variants) && obj.variants.length > 0) {
      const picked =
        (selectedId
          ? obj.variants.find(
              (v) =>
                v &&
                typeof v === 'object' &&
                !Array.isArray(v) &&
                (v as { id?: unknown }).id === selectedId,
            )
          : null) ??
        obj.variants.find(
          (v) =>
            v &&
            typeof v === 'object' &&
            !Array.isArray(v) &&
            (v as { id?: unknown }).id === 'explainer',
        ) ??
        obj.variants[0];
      if (picked && typeof picked === 'object' && !Array.isArray(picked)) {
        const script = (picked as { script?: unknown }).script;
        if (typeof script === 'string' && script.trim()) return script.trim();
      }
    }
    const script = obj.script;
    if (typeof script === 'string' && script.trim()) return script.trim();
    return '';
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
