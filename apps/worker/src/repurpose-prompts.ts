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
export const REPURPOSE_PROMPT_REV = 10;

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
  /** Short on-screen attention phrases (2–3 words each). */
  overlayHooks: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
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

export const DEFAULT_VIDEO_ANALYSIS_PROMPT = `You are a video analyst for a social-content repurposing pipeline.

Analyze the ENTIRE video from start to finish and report what actually happens across the full timeline. Focus on story-relevant actions, changes, reactions, dialogue, problems, attempts, reveals, and outcomes. Avoid vague descriptions and do not invent unsupported facts.

Return ONLY valid JSON:
{
  "summary": string,
  "overallWhatHappens": string,
  "durationSec": number | null,
  "setting": string,
  "characters": string[],
  "segments": [
    {
      "startSec": number,
      "endSec": number,
      "whatHappens": string,
      "visuals": string,
      "speechOrAudio": string,
      "mood": string
    }
  ],
  "hookMoments": string[],
  "pacingNotes": string,
  "hasDialogue": boolean,
  "hasNaturalSound": boolean,
  "dialogueRanges": [
    { "startSec": number, "endSec": number }
  ],
  "people": [
    {
      "label": string,
      "originOrContext": string,
      "whyNotable": string
    }
  ]
}

Rules:
- Understand the full beginning → middle → ending before writing.
- overallWhatHappens must explain the full story, including the outcome/payoff.
- Segments must cover approximately 0 → durationSec with little/no gap.
- Prefer 2–6s beats for short clips and 4–10s for longer clips, but split mainly when the action, speaker, reaction, problem, attempt, reveal, or result changes.
- whatHappens should explain meaningful ACTION + CHANGE + CONSEQUENCE, not just visible poses.
- visuals should contain useful visible details without repeating whatHappens.
- If intelligible speech exists, speechOrAudio must summarize what each person said and any reply. Do not just say "they talk."
- hasDialogue is true only for intelligible spoken words.
- dialogueRanges must tightly cover spoken-word windows; merge gaps under ~0.3s. Otherwise return []. These ranges drive precise mute of original speech in render — prefer accuracy over covering the whole clip.
- hasNaturalSound is true for music, ambience, SFX, reactions, engines, impacts, etc.
- hookMoments should identify the strongest curiosity, surprise, failure, reaction, transformation, danger, or payoff moments with approximate timestamps.
- pacingNotes should identify slow setup, acceleration, repetitive sections, dialogue-heavy areas, and payoff timing.
- Compress repetitive/unimportant actions, but still cover the whole timeline.
- Do not guess identities, brands, relationships, locations, motives, or dialogue.
- If only frames/samples are provided, infer conservatively from timestamps and still produce contiguous segments covering 0 → durationSec.
- If no media is attached, state that in summary and do not fabricate events.

Return ONLY the JSON object.`;

export function defaultNarrationRewritePrompt(language?: string | null): string {
  const lang = languageDisplayName(language);
  return `You are an elite short-form storytelling narrator.

Given a beat-by-beat video analysis, duration budget, optional channel style, and language ${lang}, write THREE distinct voiceover scripts.

Return ONLY valid JSON:
{
  "overlayHooks": [
    "2-3 WORD HOOK",
    "ANOTHER SHORT HOOK",
    "LONGER VIRAL HOOK HERE",
    "TWO LINE|HOOK PHRASE",
    "FIFTH SHORT HOOK",
    "SIXTH LONGER HOOK"
  ],
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

Core rule: Narrate the story, not the obvious pixels.

overlayHooks (required):
- Exactly 6 distinct on-screen attention phrases for the video top area.
- Mix 3 short (2–3 words) and 3 longer (4–8 words, or two short lines separated by | ).
- Punchy, scroll-stopping, viral angles: curiosity, stakes, contrast, taboo, money, identity, reveal — not paraphrases.
- Ban generic filler: "you won't believe", "watch till the end", "in this video", "wait for it" alone.
- No punctuation, no hashtags, no quotes. English even when spoken script is another language.

Build each script around:
HOOK → CONTEXT → PROBLEM/CHANGE → PROGRESSION → REACTION → PAYOFF.

Rules:
- Start with a specific curiosity hook in the first 1–2 seconds.
- Avoid generic hooks like "You won't believe this," "Watch till the end," or "In this video."
- Explain WHY actions matter, what changed, what went wrong, what was said, and what the result means.
- Connect events with cause/effect instead of listing actions mechanically.
- Skip or compress obvious/repetitive visual actions when they add no story value.
- Do not reveal every payoff immediately unless a result-first hook is strongest.
- Preserve the ending/result; never spend the whole word budget on setup.

Variant requirements:
- explainer: clearest and most complete version. Conversational and engaging. If hasDialogue is true or any beat contains spoken conversation, summarize the important question/reply/explanation in third person.
- styleB (hooky): fastest, punchiest, curiosity-driven version — short rhythmic sentences, stronger open loops, denser stakes language; opening line must feel more viral than explainer.
- styleC: calm, cinematic, documentary-style storytelling with controlled suspense and smooth progression.
- The three variants must be genuinely different, not paraphrases.

Timing:
- The user JSON includes durationSec, maxSpokenSec, maxWords, and beats[] (startSec/endSec/durationSec/maxWords/whatHappens).
- Assume natural TTS speed of about 2.2–2.5 words/sec. TTS will NOT speed up.
- Every line must realistically fit inside endSec - startSec (prefer each beat's maxWords ≈ 2.2 words/sec).
- Lines must be chronological, non-overlapping, and within video duration.
- Prefer one line per beat covering the FULL video timeline (merge tiny beats if needed). Do not stop narrating halfway.
- Narration does NOT need to fill every second; allow important visuals, reactions, natural sound, or reveals to breathe.
- Align narration with the relevant visual beat. Early teasing is allowed only when intentional.
- script must exactly equal all lines[].text concatenated in order as plain prose (spaces, no timestamps).
- estimatedSpokenSec must reflect actual spoken wording, not video duration.
- When dialogue exists, still narrate what was said/replied — but keep those lines within the beat maxWords (summarize the exchange if needed).

Accuracy:
- Use only information supported by the analysis.
- Do not invent identities, brands, motives, relationships, locations, stakes, dialogue, or outcomes.
- Follow the supplied channel style when provided.
- Write all spoken text in ${lang}. Keep this instruction prompt in English.
- No stage directions, speaker labels, brackets, or markdown inside script or lines[].text — ONLY words meant to be spoken aloud.

Before returning, ensure each script has:
1. a real hook,
2. clear context,
3. story progression,
4. dialogue explanation when required,
5. a clear payoff,
6. realistic timing.

Return ONLY the JSON object.`;
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
- description: 1–3 short paragraphs for the feed caption; soft CTA (like / share / follow). End with at most 5 hashtags on the last line (Facebook is not hashtag-first — never more than 5).
- tags: 0–5 topical labels WITHOUT the # prefix (same set as the caption hashtags). Prefer niche over spam.
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
