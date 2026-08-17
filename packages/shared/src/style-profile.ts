import { z } from 'zod';
import {
  formatIdeaTitleLanguageRules,
  formatOutputLanguagePolicy,
  languageDisplayName,
  OUTPUT_LANGUAGE_POLICY_REV,
} from './content-languages.js';
import {
  formatNarrationEmotionBlock,
  SPEECH_EMOTION_RULES_REV,
  TTS_EMOTIONS,
  type TtsEmotion,
} from './voice-settings.js';

/**
 * Channel brand / style questionnaire (account settings → Master prompt & styles).
 * Answers are stored on ChannelProfile.styleProfile and composed into
 * masterPrompt / writingStyle / narrationStyle for AI injection.
 */

export const STYLE_PROFILE_VERSION = 1 as const;

export type QuestionType = 'single' | 'multi' | 'text';

export interface StyleQuestionOption {
  value: string;
  label: string;
}

export interface StyleQuestion {
  id: keyof StyleProfileAnswers;
  label: string;
  help?: string;
  type: QuestionType;
  required?: boolean;
  placeholder?: string;
  options?: StyleQuestionOption[];
}

/** Flat answer bag keyed by question id. */
export const styleProfileAnswersSchema = z.object({
  niche: z.string().default(''),
  nicheTags: z.array(z.string()).default([]),
  audience: z.string().default(''),
  formats: z.array(z.string()).default([]),
  presentation: z.string().default(''),
  visualStyles: z.array(z.string()).default([]),
  animationStyle: z.string().default(''),
  tones: z.array(z.string()).default([]),
  pacing: z.string().default(''),
  hookStyle: z.string().default(''),
  captionStyle: z.string().default(''),
  avoid: z.string().default(''),
  extraNotes: z.string().default(''),
});
export type StyleProfileAnswers = z.infer<typeof styleProfileAnswersSchema>;

export const styleProfileSchema = z.object({
  version: z.literal(STYLE_PROFILE_VERSION).default(STYLE_PROFILE_VERSION),
  answers: styleProfileAnswersSchema.default({}),
  /** When true, freeform masterPrompt (and style fields) are owner-authored. */
  masterPromptOverridden: z.boolean().default(false),
});
export type StyleProfile = z.infer<typeof styleProfileSchema>;

export const emptyStyleProfileAnswers = (): StyleProfileAnswers =>
  styleProfileAnswersSchema.parse({});

export const emptyStyleProfile = (): StyleProfile =>
  styleProfileSchema.parse({ version: STYLE_PROFILE_VERSION });

export function parseStyleProfile(raw: unknown): StyleProfile {
  if (!raw || typeof raw !== 'object') return emptyStyleProfile();
  const parsed = styleProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : emptyStyleProfile();
}

/** Questionnaire definition shown in account settings. */
export const STYLE_QUESTIONS: StyleQuestion[] = [
  {
    id: 'nicheTags',
    label: 'What is your channel about?',
    help: 'Pick the closest topics — add detail in the next field.',
    type: 'multi',
    options: [
      { value: 'true_crime', label: 'True crime / mysteries' },
      { value: 'history', label: 'History' },
      { value: 'science', label: 'Science / space' },
      { value: 'tech', label: 'Tech / AI explainers' },
      { value: 'finance', label: 'Finance / money' },
      { value: 'self_improvement', label: 'Self-improvement' },
      { value: 'psychology', label: 'Psychology / mind' },
      { value: 'drama_stories', label: 'Drama / story channels' },
      { value: 'entertainment', label: 'Entertainment / celebrity' },
      { value: 'gaming', label: 'Gaming' },
      { value: 'fitness', label: 'Fitness / health' },
      { value: 'food', label: 'Food / cooking' },
      { value: 'news_commentary', label: 'News / commentary' },
      { value: 'motivation', label: 'Motivation' },
      { value: 'howto', label: 'How-to / tutorials' },
    ],
  },
  {
    id: 'niche',
    label: 'Describe your niche in your own words',
    help: 'One or two sentences the AI should treat as ground truth.',
    type: 'text',
    required: true,
    placeholder: 'e.g. Short documentaries about forgotten inventors and weird patents',
  },
  {
    id: 'audience',
    label: 'Who is your target audience? (optional)',
    type: 'text',
    placeholder: 'e.g. Curious 18–34s who like bingeable facts',
  },
  {
    id: 'formats',
    label: 'What content formats do you make?',
    type: 'multi',
    required: true,
    options: [
      { value: 'documentary', label: 'Documentary' },
      { value: 'explainer', label: 'Explainer' },
      { value: 'storytime', label: 'Storytime / narrative' },
      { value: 'listicle', label: 'Listicle / top-N' },
      { value: 'drama', label: 'Drama / skit' },
      { value: 'commentary', label: 'Commentary / opinion' },
      { value: 'tutorial', label: 'Tutorial / how-to' },
      { value: 'mythbusting', label: 'Myth-busting' },
      { value: 'news_roundup', label: 'News roundup' },
      { value: 'reaction', label: 'Reaction' },
    ],
  },
  {
    id: 'presentation',
    label: 'How is the video presented?',
    type: 'single',
    required: true,
    options: [
      { value: 'voiceover', label: 'Voiceover narration' },
      { value: 'dialogue', label: 'Dialogue / characters talking' },
      { value: 'on_camera', label: 'On-camera host' },
      { value: 'mixed', label: 'Mixed (VO + dialogue or host)' },
      { value: 'text_only', label: 'Text-on-screen only (no VO)' },
    ],
  },
  {
    id: 'visualStyles',
    label: 'Visual / editing style',
    type: 'multi',
    required: true,
    options: [
      { value: 'fast_cuts', label: 'Fast cuts' },
      { value: 'cinematic', label: 'Cinematic / slow' },
      { value: 'motion_graphics', label: 'Motion graphics' },
      { value: 'stock_collage', label: 'Stock footage collage' },
      { value: 'broll_doc', label: 'Documentary B-roll' },
      { value: 'ai_visuals', label: 'AI-generated visuals' },
      { value: 'screen_recording', label: 'Screen recording' },
      { value: 'minimal_stills', label: 'Minimal / static images' },
      { value: 'green_screen', label: 'Green screen' },
    ],
  },
  {
    id: 'animationStyle',
    label: 'Animation style (if any)',
    type: 'single',
    options: [
      { value: 'none', label: 'None / live footage' },
      { value: '2d_motion', label: '2D motion graphics' },
      { value: 'kinetic_type', label: 'Kinetic typography' },
      { value: 'whiteboard', label: 'Whiteboard / sketch' },
      { value: '3d', label: '3D / CGI look' },
      { value: 'stop_motion', label: 'Stop-motion feel' },
    ],
  },
  {
    id: 'tones',
    label: 'Tone & writing style',
    type: 'multi',
    required: true,
    options: [
      { value: 'casual', label: 'Casual' },
      { value: 'conversational', label: 'Conversational' },
      { value: 'witty', label: 'Witty / humorous' },
      { value: 'dramatic', label: 'Dramatic' },
      { value: 'educational', label: 'Educational' },
      { value: 'formal', label: 'Formal / authoritative' },
      { value: 'urgent', label: 'Urgent / newsy' },
      { value: 'storytelling', label: 'Storytelling' },
      { value: 'empathetic', label: 'Warm / empathetic' },
    ],
  },
  {
    id: 'pacing',
    label: 'Pacing & energy',
    type: 'single',
    required: true,
    options: [
      { value: 'calm', label: 'Calm & measured' },
      { value: 'moderate', label: 'Moderate' },
      { value: 'high', label: 'High-energy / fast' },
      { value: 'builds', label: 'Variable (builds tension)' },
    ],
  },
  {
    id: 'hookStyle',
    label: 'Preferred hook style',
    type: 'single',
    options: [
      { value: 'question', label: 'Cold-open question' },
      { value: 'bold_claim', label: 'Bold claim' },
      { value: 'story', label: 'Story cold open' },
      { value: 'list_tease', label: 'List tease (#3 will…)' },
      { value: 'shock_fact', label: 'Shocking fact' },
      { value: 'relatable', label: 'Relatable scenario' },
    ],
  },
  {
    id: 'captionStyle',
    label: 'Captions / on-screen text',
    type: 'single',
    options: [
      { value: 'heavy', label: 'Heavy captions (word-by-word)' },
      { value: 'moderate', label: 'Moderate captions' },
      { value: 'keywords', label: 'Keywords / emphasis only' },
      { value: 'minimal', label: 'Minimal / none' },
      { value: 'platform', label: 'Match platform defaults' },
    ],
  },
  {
    id: 'avoid',
    label: 'What should the AI avoid? (optional)',
    type: 'text',
    placeholder: 'e.g. No clickbait, no slang, no medical advice',
  },
  {
    id: 'extraNotes',
    label: 'Anything else about your style? (optional)',
    type: 'text',
    placeholder: 'Signature phrases, recurring segments, brand rules…',
  },
];

/**
 * True when the style questionnaire indicates drama/skit format and/or
 * dialogue presentation — used to tighten creative-package prompt rules.
 */
export function isDramaOrDialoguePackage(styleProfile: unknown): boolean {
  const answers = parseStyleProfile(styleProfile).answers;
  const dramaFormat = answers.formats.some((value) => {
    const v = value.toLowerCase().trim();
    return v === 'drama' || v.includes('skit');
  });
  return dramaFormat || answers.presentation === 'dialogue';
}

export interface CharacterReferenceInput {
  name?: string | null;
  appearance?: string | null;
  wardrobe?: string | null;
  age?: string | null;
  consistencyDetails?: string | null;
}

/**
 * Expand a character sheet into a paste-ready reference form, e.g.
 * `Hina (A girl in Cozy knit sweater with a denim apron for painting tasks)`.
 */
export function formatCharacterReference(character: CharacterReferenceInput): string {
  const name = (character.name ?? '').trim() || 'Character';
  const appearance = (character.appearance ?? '').trim();
  const wardrobe = (character.wardrobe ?? '').trim();
  const consistency = (character.consistencyDetails ?? '').trim();
  const age = (character.age ?? '').trim();

  const parts: string[] = [];
  if (appearance) parts.push(appearance);
  if (wardrobe) {
    const wardrobeNeedle = wardrobe.slice(0, Math.min(24, wardrobe.length)).toLowerCase();
    const alreadyInAppearance =
      wardrobeNeedle.length > 0 && appearance.toLowerCase().includes(wardrobeNeedle);
    if (!alreadyInAppearance) {
      if (appearance) {
        // Join appearance + wardrobe with " with "; drop a leading in/wearing/with on wardrobe.
        parts.push(wardrobe.replace(/^(in|wearing|with)\s+/i, '').trim() || wardrobe);
      } else {
        parts.push(/^(in|wearing|with)\b/i.test(wardrobe) ? wardrobe : `in ${wardrobe}`);
      }
    }
  }
  if (age) {
    const ageNeedle = age.toLowerCase();
    const alreadyMentioned =
      appearance.toLowerCase().includes(ageNeedle) ||
      parts.some((part) => part.toLowerCase().includes(ageNeedle));
    if (!alreadyMentioned) {
      parts.unshift(/\b(year|yo|yrs?)\b/i.test(age) ? age : `${age}-year-old`);
    }
  }

  let descriptor = parts.join(' with ').replace(/\s+/g, ' ').trim();
  if (!descriptor) descriptor = consistency;
  if (!descriptor) return name;
  // Avoid `Name (Name (...))` when the sheet already stored an expanded string.
  if (descriptor.startsWith(`${name} (`)) return descriptor;
  return `${name} (${descriptor})`;
}

/** Still-image artifacts for drama/dialogue (spoken dialogue allowed). */
export const DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT =
  'blurry, low quality, deformed face, extra limbs, bad hands, watermark, logo, burned-in subtitles, text overlay, cartoon, anime, plastic skin, oversmoothed, duplicate character, inconsistent wardrobe, unnatural proportions';

/** Video/animation motion & temporal artifacts for drama (dialogue allowed). */
export const DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT =
  'blurry, low quality, deformed face, extra limbs, bad hands, watermark, logo, burned-in subtitles, text overlay, cartoon, anime, plastic skin, morphing faces, identity flicker, jittery motion, unnatural warping, frame stutter, duplicate character, inconsistent wardrobe';

/**
 * Still-image negatives for narration / voiceover packages (external VO).
 * Forbids on-screen talking; focuses on still-image artifacts (not motion/audio).
 */
export const DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT =
  'dialogue, talking characters, spoken character lines, characters mouthing words, talking heads delivering lines, blurry, low quality, deformed face, extra limbs, bad hands, watermark, logo, burned-in subtitles, text overlay, plastic skin, oversmoothed';

/**
 * Video/animation negatives for narration / voiceover packages.
 * Forbids dialogue/talking plus motion and video-track audio avoids (VO is external).
 */
export const DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT =
  'dialogue, talking characters, spoken character lines, lip-sync speech, on-screen conversation, characters mouthing words, invented voiceover speech, talking heads delivering lines, sung vocals, speech on the video track, blurry, low quality, watermark, logo, burned-in subtitles, text overlay, morphing faces, identity flicker, jittery motion, unnatural warping';

/** @deprecated Prefer DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT — alias for back-compat. */
export const DEFAULT_DRAMA_NEGATIVE_PROMPT = DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT;

/** @deprecated Prefer DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT — alias for back-compat. */
export const DEFAULT_NARRATION_NEGATIVE_PROMPT = DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT;

/** Inline marker used when baking negatives into image/animation prompt strings. */
export const NEGATIVE_PROMPT_INLINE_PREFIX = 'Negative:';

/**
 * Append full negative guidance so imagePrompt / animationPrompt are self-contained
 * when copied. No-ops when negatives are empty or already present.
 */
export function embedNegativeGuidanceInPrompt(
  prompt: string,
  negativePrompt: string,
): string {
  const base = (prompt ?? '').trim();
  const neg = (negativePrompt ?? '').trim();
  if (!neg) return base;
  if (!base) return `${NEGATIVE_PROMPT_INLINE_PREFIX} ${neg}`;
  if (base.includes(neg)) return base;
  return `${base}\n\n${NEGATIVE_PROMPT_INLINE_PREFIX} ${neg}`;
}

/**
 * True when presentation is pure voiceover narration and the package is not
 * drama/dialogue. Documentary collage callers should OR this with
 * `isDocumentaryVoiceoverPackage` (handled in the worker).
 */
export function isNarrationVoiceoverPackage(styleProfile: unknown): boolean {
  if (isDramaOrDialoguePackage(styleProfile)) return false;
  const presentation = parseStyleProfile(styleProfile).answers.presentation;
  return presentation === 'voiceover';
}

/** Replace bare character names in prompt text with expanded references. */
export function expandCharacterReferencesInText(
  prompt: string,
  characters: CharacterReferenceInput[],
): string {
  let result = prompt;
  const sorted = [...characters]
    .map((character) => ({
      name: (character.name ?? '').trim(),
      reference: formatCharacterReference(character),
    }))
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => b.name.length - a.name.length);

  for (const { name, reference } of sorted) {
    if (name === reference) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replace bare `Name` but not `Name (` already-expanded forms.
    const bareName = new RegExp(`\\b${escaped}\\b(?!\\s*\\()`, 'g');
    result = result.replace(bareName, reference);
  }
  return result;
}

/**
 * Extra creative-package rules when drama/skit format or dialogue presentation is set.
 */
export function formatDramaDialoguePackageRules(options: {
  clipDurationSec: number;
  language?: string | null;
  includeNegativePrompts?: boolean;
}): string {
  const lang = languageDisplayName(options.language);
  const clip = Math.max(1, Math.round(options.clipDurationSec));
  const minWords = Math.max(12, Math.round(clip * 2.0));
  const maxWords = Math.max(minWords + 4, Math.round(clip * 2.8));
  const negatives = options.includeNegativePrompts !== false;

  return `DRAMA / DIALOGUE package rules (mandatory):
- Spoken dialogue language: write EVERY spoken line in ${lang}. Do not use English dialogue unless the channel language is English. Character names and visual/scene descriptions stay in English; only the spoken words must match ${lang}.
- imagePrompt and animationPrompt bodies stay in English. Quote any on-screen overlay text and spoken lines in ${lang} inside those English prompts.
- Clip density: each scene is ~${clip}s. Fill that duration with enough dialogue exchanges and physical action beats — never one short line plus silence. Target roughly ${minWords}-${maxWords} spoken words of dialogue per ${clip}s scene (conversational pace), with clear action/blocking timed across the full clip in animationPrompt.
- Dialogue emotion: every dialogue[] item MUST be { "speaker", "line", "emotion" }. emotion is one of: ${TTS_EMOTIONS.join(', ')}. Pick it from THAT line's situation (argument → angry, loss → sad, reveal → excited, joke → cheerful, comfort → empathetic, waiting → calm, facts → newscast, else default). Different speakers can feel different things in the same scene. Do not print the emotion inside the spoken line.
- animationPrompt must label each spoken line with its emotion: "Dialogue (angry): Name: line".
- Character references: never use a bare character name alone in imagePrompt or animationPrompt. Always expand to "Name (appearance + wardrobe / consistency)" using the character sheets, e.g. Hina (A girl in Cozy knit sweater with a denim apron for painting tasks). Use the same expanded form for dialogue speaker labels inside animationPrompt where practical.
- Quality keyword: include the exact phrase "ultra realistic" in every imagePrompt and animationPrompt (and thumbnailPrompt when writing one).
${
  negatives
    ? `- negativePrompt: for every scene return a comma-separated still-image avoid list. Start from: ${DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT}. Adapt per scene when useful. Optionally also return thumbnailNegativePrompt for the thumbnail.
- animationNegativePrompt (alias videoNegativePrompt): for every scene return a SEPARATE comma-separated video/animation avoid list focused on motion/temporal artifacts. Start from: ${DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT}. Do not reuse the image list verbatim.
- Self-contained prompts: embed negativePrompt at the end of imagePrompt as "${NEGATIVE_PROMPT_INLINE_PREFIX} …", and embed animationNegativePrompt at the end of animationPrompt as "${NEGATIVE_PROMPT_INLINE_PREFIX} …". Image and video negatives must differ. Dialogue is allowed — do NOT add "no dialogue" / "no talking" negatives.`
    : ''
}`.trim();
}

function labelsFor(questionId: keyof StyleProfileAnswers, values: string[]): string[] {
  const q = STYLE_QUESTIONS.find((x) => x.id === questionId);
  if (!q?.options) return values;
  const map = new Map(q.options.map((o) => [o.value, o.label]));
  return values.map((v) => map.get(v) ?? v).filter(Boolean);
}

function labelFor(questionId: keyof StyleProfileAnswers, value: string): string {
  if (!value) return '';
  return labelsFor(questionId, [value])[0] ?? value;
}

function joinList(items: string[]): string {
  return items.filter(Boolean).join(', ');
}

export interface ComposedChannelStyles {
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  /** Suggested default hashtags / discovery tags for the channel. */
  tags: string[];
}

export interface ComposeChannelStylesOptions {
  /** Owner-pasted animation / video-generation guidelines to fold into the master prompt. */
  animationReferencePrompt?: string | null;
  /** Owner thumbnail style / composition reference. */
  thumbnailReferencePrompt?: string | null;
  /** Publish title template (e.g. `{{hook}} — {{topic}}`). */
  titleTemplate?: string | null;
  /** Publish description template (supports placeholders like `{{description}}`). */
  descriptionTemplate?: string | null;
  /** Existing writing style notes to preserve / expand. */
  writingStyle?: string | null;
  /** Existing narration style notes to preserve / expand. */
  narrationStyle?: string | null;
  /** Account content type: AI | REPURPOSED | MIXED. */
  contentType?: string | null;
  /** Voice / TTS notes (provider, voice id, locale) when relevant to narration. */
  voiceNotes?: string | null;
}

function slugTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .slice(0, 40);
}

/** Deterministic default tags from questionnaire + optional niche text. */
export function composeDefaultTags(
  answers: StyleProfileAnswers,
  options?: { language?: string; max?: number },
): string[] {
  const a = styleProfileAnswersSchema.parse(answers);
  const max = options?.max ?? 12;
  const out: string[] = [];
  const push = (raw: string) => {
    const t = slugTag(raw);
    if (t && !out.includes(t)) out.push(t);
  };

  for (const label of labelsFor('nicheTags', a.nicheTags)) push(label);
  for (const label of labelsFor('formats', a.formats)) push(label);
  for (const label of labelsFor('tones', a.tones).slice(0, 2)) push(label);
  if (a.niche.trim()) {
    for (const word of a.niche.trim().split(/[\s,/|]+/).slice(0, 4)) {
      if (word.length >= 3) push(word);
    }
  }
  push('shorts');
  push('viral');
  const lang = (options?.language ?? 'en').toLowerCase();
  if (lang !== 'en') push(lang);

  return out.slice(0, max);
}

/** Compose freeform style fields from questionnaire answers. */
export function composeChannelStyles(
  answers: StyleProfileAnswers,
  language = 'en',
  options?: ComposeChannelStylesOptions,
): ComposedChannelStyles {
  const a = styleProfileAnswersSchema.parse(answers);
  const lang = languageDisplayName(language);
  const nicheTags = labelsFor('nicheTags', a.nicheTags);
  const formats = labelsFor('formats', a.formats);
  const visuals = labelsFor('visualStyles', a.visualStyles);
  const tones = labelsFor('tones', a.tones);
  const presentation = labelFor('presentation', a.presentation);
  const animation = labelFor('animationStyle', a.animationStyle);
  const pacing = labelFor('pacing', a.pacing);
  const hook = labelFor('hookStyle', a.hookStyle);
  const captions = labelFor('captionStyle', a.captionStyle);
  const animationGuidelines = options?.animationReferencePrompt?.trim() ?? '';
  const thumbnailGuidelines = options?.thumbnailReferencePrompt?.trim() ?? '';
  const titleTemplate = options?.titleTemplate?.trim() ?? '';
  const descriptionTemplate = options?.descriptionTemplate?.trim() ?? '';
  const contentType = options?.contentType?.trim() ?? '';
  const voiceNotes = options?.voiceNotes?.trim() ?? '';
  const existingWriting = options?.writingStyle?.trim() ?? '';
  const existingNarration = options?.narrationStyle?.trim() ?? '';

  const sections: string[] = [];

  sections.push(
    [
      '## Role',
      'You are the creative system for this short-form social video channel.',
      'Inject this master brief into EVERY AI task: idea generation, scripts, narration, captions, titles, descriptions, tags, thumbnails, and scene animation prompts.',
      'Obey brand voice, presentation rules, do/don\'t constraints, and visual guidelines without inventing an unrelated niche.',
    ].join('\n'),
  );

  const identity: string[] = ['## Channel identity'];
  if (contentType) identity.push(`Content pipeline: ${contentType}`);
  identity.push(formatOutputLanguagePolicy(language));
  if (a.niche.trim() || nicheTags.length) {
    const topic = a.niche.trim() || joinList(nicheTags);
    identity.push(`Channel topic / niche: ${topic}`);
    if (a.niche.trim() && nicheTags.length) {
      identity.push(`Topic tags: ${joinList(nicheTags)}`);
    }
  }
  if (a.audience.trim()) identity.push(`Target audience: ${a.audience.trim()}`);
  if (formats.length) identity.push(`Preferred content formats: ${joinList(formats)}`);
  sections.push(identity.join('\n'));

  const voice: string[] = ['## Brand voice & writing'];
  if (tones.length) voice.push(`Tone: ${joinList(tones)}`);
  if (hook) {
    voice.push(`Hook style: ${hook}`);
    voice.push(
      'Open every script with a strong hook in the first 1–2 seconds that matches the preferred hook style.',
    );
  }
  if (existingWriting) voice.push(`Writing style notes: ${existingWriting}`);
  voice.push(
    `Write crisp, scroll-stopping copy. Prefer concrete specifics over vague claims. Keep publish descriptions, tags, and on-screen captions in ${lang}. Publish titles follow the LANGUAGE POLICY title-language rules.`,
  );
  if (titleTemplate) {
    voice.push(`Default title template pattern: ${titleTemplate}`);
    voice.push('When generating titles, respect this template structure and placeholders when present.');
  }
  if (descriptionTemplate) {
    voice.push(`Default description template: ${descriptionTemplate}`);
    voice.push(
      'When generating descriptions, use this template; expand {{description}} / {{default-content}} style placeholders with on-brief copy.',
    );
  }
  sections.push(voice.join('\n'));

  const delivery: string[] = ['## Presentation, pacing & narration'];
  if (presentation) delivery.push(`Presentation mode: ${presentation}`);
  if (pacing) delivery.push(`Pacing & energy: ${pacing}`);
  if (captions) delivery.push(`Captions / on-screen text: ${captions}`);
  if (existingNarration) delivery.push(`Narration style notes: ${existingNarration}`);
  if (voiceNotes) delivery.push(`Voice / TTS notes: ${voiceNotes}`);
  delivery.push(
    `Match pacing to the energy profile. Keep narration natural for the chosen presentation mode, spoken in ${lang}. Align on-screen text with caption rules and write overlay lettering in ${lang}.`,
  );
  sections.push(delivery.join('\n'));

  const visualsSec: string[] = ['## Visual & editing style'];
  if (visuals.length) visualsSec.push(`Visual / editing style: ${joinList(visuals)}`);
  if (animation && animation !== 'None / live footage') {
    visualsSec.push(`Animation style preference: ${animation}`);
  }
  if (thumbnailGuidelines) {
    visualsSec.push('Thumbnail style reference (match composition, typography, lighting, and mood):');
    visualsSec.push(thumbnailGuidelines);
  }
  visualsSec.push(
    'Keep thumbnails, cuts, and scene framing consistent with the visual style above across the whole package.',
  );
  sections.push(visualsSec.join('\n'));

  if (animationGuidelines) {
    sections.push(
      [
        '## Animation / video generation guidelines',
        'Apply these rules to every scene animationPrompt and motion brief:',
        animationGuidelines,
      ].join('\n'),
    );
  }

  const rules: string[] = ['## Hard rules'];
  if (a.avoid.trim()) rules.push(`Do NOT: ${a.avoid.trim()}`);
  rules.push('Stay strictly on-niche and on-audience.');
  rules.push('Do not invent conflicting brand rules or unrelated topics.');
  rules.push('Prefer reusable patterns that match tone, pacing, hooks, and presentation above.');
  sections.push(rules.join('\n'));

  if (a.extraNotes.trim()) {
    sections.push(['## Additional owner notes', a.extraNotes.trim()].join('\n'));
  }

  sections.push(
    [
      '## Operating checklist',
      '- Idea titles follow the title-language rules; idea angle/hook/rationale and story drafts stay English, on-niche, format-fit, hook-first.',
      `- Scripts / narration / dialogue: match presentation, pacing, and tone; speak ${lang}.`,
      `- On-screen text, publish descriptions, and tags: ${lang}; publish titles follow the title-language rules; follow templates and caption style when set.`,
      '- Image / video / animation prompts: English bodies; quoted overlay/spoken text in the output language.',
      '- Tags: discoverable, niche-relevant, no spam stuffing.',
      '- Thumbnails & animationPrompts: obey visual + animation guideline sections.',
    ].join('\n'),
  );

  const writingBits = [
    tones.length ? `Tone: ${joinList(tones)}` : '',
    formats.length ? `Formats: ${joinList(formats)}` : '',
    hook ? `Hooks: ${hook}` : '',
    existingWriting || '',
    a.avoid.trim() ? `Avoid: ${a.avoid.trim()}` : '',
  ].filter(Boolean);

  const narrationBits = [
    presentation ? `Presentation: ${presentation}` : '',
    pacing ? `Pacing: ${pacing}` : '',
    captions ? `Captions: ${captions}` : '',
    tones.length ? `Voice tone: ${joinList(tones)}` : '',
    existingNarration || '',
    voiceNotes ? `TTS: ${voiceNotes}` : '',
  ].filter(Boolean);

  return {
    masterPrompt: sections.join('\n\n'),
    writingStyle: writingBits.join('. ') || '',
    narrationStyle: narrationBits.join('. ') || '',
    tags: composeDefaultTags(a, { language }),
  };
}

/** True when the questionnaire has enough signal to be useful. */
export function styleProfileHasAnswers(answers: StyleProfileAnswers): boolean {
  const a = styleProfileAnswersSchema.parse(answers);
  return Boolean(
    a.niche.trim() ||
      a.nicheTags.length ||
      a.formats.length ||
      a.presentation ||
      a.visualStyles.length ||
      a.tones.length ||
      a.pacing ||
      a.extraNotes.trim(),
  );
}

/**
 * Whether this channel's presentation should produce a downloadable voiceover
 * for AI-owner creative packages (`voiceover` or `mixed`).
 */
export function presentationNeedsVoiceover(styleProfile: unknown): boolean {
  const presentation = parseStyleProfile(styleProfile).answers.presentation;
  return presentation === 'voiceover' || presentation === 'mixed';
}

export interface ChannelStyleFields {
  masterPrompt?: string | null;
  writingStyle?: string | null;
  narrationStyle?: string | null;
  language?: string | null;
  styleProfile?: unknown;
  /** Owner thumbnail style/template for generated thumbnail prompts. */
  thumbnailReferencePrompt?: string | null;
  /** Owner animation / video-generation guidelines for scene animationPrompts. */
  animationReferencePrompt?: string | null;
  /** Channel Voice-tab fallback emotion when a spoken line has no situation tag. */
  ttsEmotion?: TtsEmotion | null;
}

/**
 * Instructions for thumbnailPrompt fields in package / visuals generation.
 * When a channel reference is set, the model must match that style/structure.
 */
export function formatThumbnailPromptInstructions(
  profile: ChannelStyleFields | null | undefined,
): string {
  const ref = profile?.thumbnailReferencePrompt?.trim();
  const overlayLang = languageDisplayName(profile?.language);
  const overlayRule = ` If the thumbnail includes on-image lettering, quote that text in ${overlayLang}; keep the rest of the prompt in English.`;
  if (ref) {
    return `thumbnailPrompt: Write one detailed, ready-to-paste thumbnail image generation prompt for this specific video. Match the structure, composition language, lighting cues, color grade, text-overlay style, and overall look of the channel thumbnail reference below — adapt subject, title, and story beats to this video only.${overlayRule}

Channel thumbnail reference (follow closely):
${ref}`;
  }
  return `thumbnailPrompt: Write one highly detailed, ready-to-paste thumbnail image generation prompt covering subject, framing/composition, expression, lighting, contrast, color grade, background, mood, and any on-image text guidance — tailored to this video's title and story.${overlayRule}`;
}

/**
 * Extra animationPrompt rules when the channel has owner-pasted guidelines.
 */
export function formatAnimationPromptInstructions(
  profile: ChannelStyleFields | null | undefined,
): string {
  const ref = profile?.animationReferencePrompt?.trim();
  if (!ref) return '';
  return `Channel animation / video guidelines (apply to every scene animationPrompt — follow closely):
${ref}`;
}

export interface SceneVisualPromptRuleOptions {
  dramaOrDialogue?: boolean;
  clipDurationSec?: number;
  /**
   * Pure narration / voiceover (or documentary VO) — external VO track.
   * Adds no-dialogue negatives + scene sound-design requirements.
   * Must be false for drama/dialogue packages.
   */
  narrationVoiceover?: boolean;
}

/**
 * Shared rules for per-scene still + video prompts (dialogue one-shot and visuals stage).
 */
export function formatSceneVisualPromptRules(
  sceneCount: number,
  options?: SceneVisualPromptRuleOptions,
): string {
  const drama = options?.dramaOrDialogue === true;
  const narration = options?.narrationVoiceover === true && !drama;
  const clip =
    typeof options?.clipDurationSec === 'number' && options.clipDurationSec > 0
      ? Math.round(options.clipDurationSec)
      : null;

  const base = `Scene image & video prompt quality (required for every scene):
- Return scenes ordered Scene 1 through Scene ${sceneCount} (sceneIndex 1..${sceneCount}). Each prompt string must be human-readable prose ready to copy-paste — never dump nested JSON inside the prompt text.
- imagePrompt: a long, detailed, standalone still-image generation prompt. Include subject(s) and what they are doing; character appearance/wardrobe consistency from the character sheets when people appear; framing and composition (shot type, camera angle, lens feel); lighting; environment and background; time of day / era; art style and medium; mood/atmosphere; and key props. Tie the still only to that scene's narration segment, dialogue, and time range.
- animationPrompt: a long, detailed, standalone video/animation generation prompt covering the full clip duration. Include what happens over time; camera move (pan, tilt, dolly, zoom, or locked-off); subject motion; environmental motion; pacing; transition into/out of the shot; and sync with narration or dialogue (quote or clearly time the spoken lines). Maintain continuity with adjacent scenes when relevant.
- Self-contained negatives (mandatory): for every scene return BOTH negativePrompt (still-image avoid list) AND animationNegativePrompt / videoNegativePrompt (video/motion avoid list). Embed negativePrompt only at the end of imagePrompt, and animationNegativePrompt only at the end of animationPrompt, each as "${NEGATIVE_PROMPT_INLINE_PREFIX} …". The two lists MUST differ — do not copy the same string into both prompts.`;

  const narrationBlock = narration
    ? `
- Narration / voiceover mode (external VO is the real audio track — the video model must NOT generate spoken narration or character speech):
  - negativePrompt (image): forbid dialogue/talking characters for stills, plus still-image artifacts. Start from: ${DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT}. Embed only in imagePrompt.
  - animationNegativePrompt (video): forbid dialogue/talking AND cover motion/audio-related avoids (lip-sync speech, invented VO on the video track, sung vocals, morphing/flicker/jitter). Start from: ${DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT}. Embed only in animationPrompt.
  - animationPrompt MUST include scene-based sound design / audio layer directions synced to the beat: music mood/genre/energy, dramatic SFX (impact hits, whooshes, tension risers, stingers), and ambient bed cues appropriate to the scene and narration beat. VO stays external — describe music/SFX/ambience only, never ask for spoken dialogue or VO on the video track.`
    : '';

  if (drama) {
    return `${base}
- Drama/dialogue detail: imagePrompt and animationPrompt must be especially specific about faces, wardrobe continuity, blocking, emotional beats, and prop interaction${clip ? ` across the full ~${clip}s clip` : ''}.
- Always use expanded character references (never bare names alone) and include the quality phrase "ultra realistic" in imagePrompt and animationPrompt.
- Include distinct negativePrompt (image) and animationNegativePrompt (video) per scene; embed each into its own prompt only. Dialogue is allowed — do NOT add "no dialogue" negatives.
- Where appropriate, animationPrompt should also call for dramatic production audio under/around dialogue (impact hits, whooshes, tension risers, ambient beds) without replacing spoken lines.`;
  }

  return `${base}${narrationBlock}`;
}

/**
 * Combine base scene visual rules with optional channel animation guidelines.
 */
export function formatSceneVisualPromptRulesWithChannel(
  sceneCount: number,
  profile: ChannelStyleFields | null | undefined,
  options?: SceneVisualPromptRuleOptions,
): string {
  const base = formatSceneVisualPromptRules(sceneCount, options);
  const anim = formatAnimationPromptInstructions(profile);
  return anim ? `${base}\n\n${anim}` : base;
}

/**
 * Compact identity block for idea generation: what OUR channel is about
 * (name / niche / audience / formats), kept distinct from reference-channel
 * inspiration so the model does not treat competitor patterns as our niche.
 */
export function formatOurChannelAboutBlock(
  profile: ChannelStyleFields | null | undefined,
  accountName?: string | null,
): string {
  const lines: string[] = [];
  const name = accountName?.trim();
  if (name) lines.push(`Channel name: ${name}`);

  const answers = parseStyleProfile(profile?.styleProfile).answers;
  const nicheTags = labelsFor('nicheTags', answers.nicheTags);
  const formats = labelsFor('formats', answers.formats);
  const presentation = labelFor('presentation', answers.presentation);
  const hasAbout = Boolean(
    answers.niche.trim() ||
      nicheTags.length ||
      answers.audience.trim() ||
      formats.length ||
      presentation ||
      answers.avoid.trim() ||
      answers.extraNotes.trim(),
  );

  if (answers.niche.trim()) {
    lines.push(`What this channel is about: ${answers.niche.trim()}`);
  }
  if (nicheTags.length) {
    lines.push(`Topic tags: ${joinList(nicheTags)}`);
  }
  if (answers.audience.trim()) {
    lines.push(`Target audience: ${answers.audience.trim()}`);
  }
  if (formats.length) {
    lines.push(`Preferred content formats: ${joinList(formats)}`);
  }
  if (presentation) {
    lines.push(`Presentation: ${presentation}`);
  }
  if (profile?.language?.trim()) {
    const lang = languageDisplayName(profile.language);
    lines.push(formatIdeaTitleLanguageRules(profile.language));
    lines.push(
      `Audience language for later voiceover, dialogue, on-screen text, and publish metadata: ${lang}.`,
    );
  }
  if (answers.avoid.trim()) {
    lines.push(`Do not cover: ${answers.avoid.trim()}`);
  }
  if (answers.extraNotes.trim()) {
    lines.push(`Owner notes: ${answers.extraNotes.trim()}`);
  }

  if (!hasAbout && (profile?.masterPrompt?.trim() || profile?.writingStyle?.trim())) {
    lines.push(
      'Niche/about details are in the channel brand & style block below — treat that brief as ground truth for what this channel is about.',
    );
  }

  if (!lines.length) return '';
  return `---\nOUR CHANNEL (generate ideas FOR this account — stay on this niche and brand; do not become a copy of the reference channels):\n${lines.join('\n')}`;
}

/**
 * Block appended to AI system prompts so channel brand settings influence
 * idea generation, briefs, narration, etc.
 */
export function formatChannelStyleBlock(profile: ChannelStyleFields | null | undefined): string {
  if (!profile) return '';
  const parts: string[] = [];
  if (profile.masterPrompt?.trim()) {
    parts.push(profile.masterPrompt.trim());
  } else {
    const parsed = parseStyleProfile(profile.styleProfile);
    if (styleProfileHasAnswers(parsed.answers)) {
      const composed = composeChannelStyles(parsed.answers, profile.language ?? 'en', {
        animationReferencePrompt: profile.animationReferencePrompt,
      });
      if (composed.masterPrompt.trim()) parts.push(composed.masterPrompt.trim());
    }
  }
  if (profile.writingStyle?.trim()) {
    parts.push(`Writing style: ${profile.writingStyle.trim()}`);
  }
  if (profile.narrationStyle?.trim()) {
    parts.push(`Narration / voiceover style: ${profile.narrationStyle.trim()}`);
  }
  parts.push(formatNarrationEmotionBlock(profile.ttsEmotion));
  if (profile.thumbnailReferencePrompt?.trim()) {
    parts.push(
      `Thumbnail reference style (match when writing thumbnail prompts):\n${profile.thumbnailReferencePrompt.trim()}`,
    );
  }
  if (profile.animationReferencePrompt?.trim()) {
    parts.push(
      `Animation / video generation guidelines (match when writing animationPrompts):\n${profile.animationReferencePrompt.trim()}`,
    );
  }
  parts.push(formatOutputLanguagePolicy(profile.language));
  if (!parts.length) return '';
  return `---\nChannel brand & style (follow for this account):\n${parts.join('\n\n')}`;
}

/** Merge a base system prompt with the channel style block. */
export function withChannelStyle(
  systemPrompt: string,
  profile: ChannelStyleFields | null | undefined,
): string {
  const block = formatChannelStyleBlock(profile);
  if (block) return `${systemPrompt.trim()}\n\n${block}`;
  return `${systemPrompt.trim()}\n\n---\n${formatNarrationEmotionBlock()}`;
}

/** Stable-ish integer for AI cache styleVersion from style-related fields. */
export function styleVersionFromProfile(profile: ChannelStyleFields | null | undefined): number {
  const emotionRev = `speechEmotion:${SPEECH_EMOTION_RULES_REV}`;
  if (!profile) {
    return (Math.abs(SPEECH_EMOTION_RULES_REV) % 2_000_000_000) + 2;
  }
  const raw = [
    profile.masterPrompt ?? '',
    profile.writingStyle ?? '',
    profile.narrationStyle ?? '',
    profile.language ?? '',
    profile.ttsEmotion ?? '',
    `langPolicy:${OUTPUT_LANGUAGE_POLICY_REV}`,
    emotionRev,
    formatOutputLanguagePolicy(profile.language),
    profile.thumbnailReferencePrompt ?? '',
    profile.animationReferencePrompt ?? '',
    JSON.stringify(profile.styleProfile ?? {}),
  ].join('|');
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  // Keep positive and away from 0 so cache keys stay distinct from "no style".
  return (Math.abs(h) % 2_000_000_000) + 2;
}
