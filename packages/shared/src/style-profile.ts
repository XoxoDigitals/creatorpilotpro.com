import { z } from 'zod';
import {
  dialogueWordsTargetForClip,
  formatDialogueClipDensityRules,
  formatIdeaTitleLanguageRules,
  formatOnScreenTextLanguageRules,
  formatOutputLanguagePolicy,
  formatPublishCopyLanguageRules,
  formatSpokenLanguageRules,
  languageDisplayName,
  nearestDialogueClipDuration,
  OUTPUT_LANGUAGE_POLICY_REV,
  thumbnailOverlayLanguageLabel,
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
  /** Short definition shown under the chip label. */
  hint?: string;
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
  /** Retention cadence: rehook_8s | two_twists | slow_burn. Empty = recommended re-hooks. */
  retentionStyle: z.string().default(''),
  captionStyle: z.string().default(''),
  avoid: z.string().default(''),
  extraNotes: z.string().default(''),
  /** Owner-written or AI-analyzed visual/editing DNA. */
  customVisualStyle: z.string().default(''),
  /**
   * Optional owner targets for spoken dialogue words per clip length.
   * Keys: "8" | "10" | "15" | "30". Empty/0 = use language default density.
   */
  dialogueWordsByClipSec: z.preprocess((val) => {
    if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(val as Record<string, unknown>)) {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n) || n <= 0) continue;
      out[String(key)] = Math.max(0, Math.min(800, Math.round(n)));
    }
    return out;
  }, z.record(z.string(), z.number().int().min(0).max(800)).default({})),
});
export type StyleProfileAnswers = z.infer<typeof styleProfileAnswersSchema>;

export const LOCKED_CHARACTER_LOOKS = ['cartoon_2d', 'cartoon_3d', 'ultra_realistic'] as const;
export type LockedCharacterLook = (typeof LOCKED_CHARACTER_LOOKS)[number];

export const LOCKED_CHARACTER_LOOK_LABELS: Record<LockedCharacterLook, string> = {
  cartoon_2d: '2D cartoon',
  cartoon_3d: '3D cartoon',
  ultra_realistic: 'Ultra realistic',
};

export const lockedCharacterSchema = z.object({
  name: z.string().default(''),
  appearance: z.string().default(''),
  wardrobe: z.string().default(''),
  age: z.string().default(''),
  personality: z.string().default(''),
  consistencyDetails: z.string().default(''),
  look: z.enum(LOCKED_CHARACTER_LOOKS).default('ultra_realistic'),
  /** Relative path under STORAGE_ROOT for an owner-uploaded reference image. */
  imagePath: z.string().default(''),
  imageFileName: z.string().default(''),
  imageMimeType: z.string().default(''),
});
export type LockedCharacter = z.infer<typeof lockedCharacterSchema>;

export const emptyLockedCharacter = (): LockedCharacter => lockedCharacterSchema.parse({});

export const styleProfileSchema = z.object({
  version: z.literal(STYLE_PROFILE_VERSION).default(STYLE_PROFILE_VERSION),
  answers: styleProfileAnswersSchema.default({}),
  /** When true, freeform masterPrompt (and style fields) are owner-authored. */
  masterPromptOverridden: z.boolean().default(false),
  /** Recurring cast reused in every video (cartoon or ultra-realistic). */
  lockedCharacters: z.array(lockedCharacterSchema).default([]),
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

/** Questionnaire definition shown in account settings. Presentation is always first. */
export const STYLE_QUESTIONS: StyleQuestion[] = [
  {
    id: 'presentation',
    label: 'Audio mode',
    help: 'First production decision. Narration: the system generates TTS voiceover; visual prompts must not invent spoken speech. Dialogues only: no TTS — spoken lines live in image/animation prompts and scene.dialogue[] (no tone words in prompts; require lip-sync). Background Audio: no TTS or dialogue — kids-channel cheering / crowd beds in prompts. Narration + Dialogues: TTS only on narrator time windows; talking clips keep speech in prompts. After Generate, mixed packages include a VO LAYUP TIMELINE with exact mm:ss windows.',
    type: 'single',
    required: true,
    options: [
      { value: 'voiceover', label: 'Narration — AI generates voiceover' },
      { value: 'dialogue', label: 'Dialogues only — speech in video prompts, no TTS' },
      {
        value: 'mixed',
        label: 'Narration + Dialogues — VO on narrator windows, speech in prompts for talking scenes',
      },
      {
        value: 'background_audio',
        label: 'Background Audio — cheering / kids bed SFX in prompts, no TTS or dialogue',
      },
      { value: 'on_camera', label: 'On-camera host' },
      { value: 'text_only', label: 'Text-on-screen only (no VO)' },
    ],
  },
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
      { value: 'kids_rhymes', label: 'Kids rhymes / nursery' },
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
    help: 'Documentary is the story/VO format. It does not lock the 10s paper-collage assembly animation — pick AI paper collage under Visuals for that.',
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
      { value: 'nursery_rhyme', label: 'Kids nursery rhyme' },
    ],
  },
  {
    id: 'visualStyles',
    label: 'AI scene look',
    help: 'How each generated still should look. Everything is AI — no stock, screen recordings, or live B-roll. Pick one or two that match the channel.',
    type: 'multi',
    required: true,
    options: [
      {
        value: 'fast_motion_graphics',
        label: 'Fast AI graphics (recommended)',
        hint: 'Icons, maps, charts, and infographic hits generated as AI scenes — rapid, punchy, not live footage.',
      },
      {
        value: '2d_cartoon',
        label: '2D cartoon scenes',
        hint: 'Illustrated / cel characters and worlds. Flat or painterly, consistent cast, not photoreal.',
      },
      {
        value: '3d_cartoon',
        label: '3D cartoon scenes',
        hint: 'Stylized CGI characters and sets. Toy-like or Pixar-ish, not live-action skin.',
      },
      {
        value: 'ultra_realistic',
        label: 'Ultra realistic',
        hint: 'Photoreal people and places: skin texture, real-world lighting, camera grain — still 100% AI, not stock.',
      },
      {
        value: 'cinematic',
        label: 'Photoreal cinematic AI',
        hint: 'Generated live-action look: film lighting, depth, camera language — still 100% AI frames.',
      },
      {
        value: 'paper_collage',
        label: 'AI paper collage',
        hint: 'Locks every clip to the 10s assemble-on-table stop-motion prompt (paper slides in, then holds). Do not pick this if you want 3D camera, fast cuts, or cartoon motion.',
      },
      {
        value: 'motion_graphics',
        label: 'Clean AI explainer graphics',
        hint: 'Smoother infographic scenes — diagrams and lower-thirds, less frantic than fast graphics.',
      },
      {
        value: 'fast_cuts',
        label: 'Rapid AI shot changes',
        hint: 'New generated shot every 1–2 seconds. Energy comes from cutting, not from stock montage.',
      },
    ],
  },
  {
    id: 'animationStyle',
    label: 'AI animation / motion',
    help: 'How the video model should move each generated still. One house motion language for every clip.',
    type: 'single',
    options: [
      {
        value: 'ai_scene',
        label: 'AI scene motion (recommended)',
        hint: 'Camera + subject motion on generated frames: punch-ins, motivated pans, environment life.',
      },
      {
        value: '2d_cartoon',
        label: '2D cartoon animation',
        hint: 'Pose-to-pose illustrated motion, smear frames, snappy holds. Same 2D cast every scene.',
      },
      {
        value: '3d_cartoon',
        label: '3D cartoon animation',
        hint: 'Rigged CGI character motion, squash/stretch on impacts, kinetic camera. Not photoreal.',
      },
      {
        value: '2d_motion',
        label: '2D motion graphics',
        hint: 'Shapes, maps, and icons fly in, stamp, and whoosh. Graphic, not character-acted.',
      },
      {
        value: 'kinetic_type',
        label: 'Kinetic type',
        hint: 'Words slam on, track the beat, and punch with the VO. Typography is the motion.',
      },
      {
        value: '3d',
        label: 'Photoreal 3D camera',
        hint: 'Dolly / orbit / push through a generated 3D space. Cinematic camera, AI environment.',
      },
      {
        value: 'whiteboard',
        label: 'AI whiteboard',
        hint: 'Sketch lines draw themselves; diagrams assemble on a board. Generated, not a real classroom.',
      },
      {
        value: 'stop_motion',
        label: 'Stop-motion AI',
        hint: 'Stepped holds and handmade cadence on whatever scene look you picked. Does not by itself lock the 10s paper-collage assembly — that needs AI paper collage.',
      },
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
    help: 'Fast-paced graphics is the house default recommendation. High energy = snappy cuts, graphic punches, no sleepy holds.',
    type: 'single',
    required: true,
    options: [
      { value: 'high', label: 'High-energy / fast (recommended)' },
      { value: 'builds', label: 'Variable (builds tension)' },
      { value: 'moderate', label: 'Moderate' },
      { value: 'calm', label: 'Calm & measured' },
    ],
  },
  {
    id: 'hookStyle',
    label: 'Preferred hook style',
    help: 'Cold-open formula for the first 1–3 seconds. Re-hooks later in the video still apply.',
    type: 'single',
    options: [
      { value: 'shock_fact', label: 'Shocking fact' },
      { value: 'question', label: 'Cold-open question' },
      { value: 'bold_claim', label: 'Bold claim' },
      { value: 'story', label: 'Story cold open' },
      { value: 'how_its_made', label: 'How-it’s-made / process' },
      { value: 'secret_reveal', label: 'Secret reveal' },
      { value: 'comparison', label: 'Comparison / vs' },
      { value: 'list_tease', label: 'List tease (#3 will…)' },
      { value: 'relatable', label: 'Relatable scenario' },
    ],
  },
  {
    id: 'retentionStyle',
    label: 'Hook & twist cadence',
    help: 'Where re-hooks and twists land after the opening. Recommended: re-hook about every 8 seconds plus a mid-video twist.',
    type: 'single',
    options: [
      { value: 'rehook_8s', label: 'Re-hook every ~8s + mid-video twist (recommended)' },
      { value: 'two_twists', label: 'Opening hook + two twist points + cliffhanger' },
      { value: 'slow_burn', label: 'Slow build, one late twist' },
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

export interface StyleQuestionSection {
  id: string;
  title: string;
  help?: string;
  questionIds: (keyof StyleProfileAnswers)[];
}

/** UI grouping for the brand questionnaire. */
export const STYLE_QUESTION_SECTIONS: StyleQuestionSection[] = [
  {
    id: 'audio',
    title: 'Audio mode',
    help: 'Choose how speech/audio is produced before anything else. This drives TTS vs prompt-speech vs background beds vs mixed VO layup.',
    questionIds: ['presentation'],
  },
  {
    id: 'niche',
    title: 'Niche & audience',
    help: 'What the channel is about and who it is for.',
    questionIds: ['nicheTags', 'niche', 'audience', 'formats'],
  },
  {
    id: 'visuals',
    title: 'Visuals & animation',
    help: 'AI stills + AI motion only. Pick chips, write your own style, or analyze a reference video. No stock, screen recordings, or live B-roll.',
    questionIds: ['visualStyles', 'animationStyle'],
  },
  {
    id: 'story',
    title: 'Story, hooks & pacing',
    help: 'Tone plus the retention engine: opening hook, re-hooks, twists, captions.',
    questionIds: ['tones', 'pacing', 'hookStyle', 'retentionStyle', 'captionStyle'],
  },
  {
    id: 'guardrails',
    title: 'Guardrails',
    help: 'Hard avoids and extra owner notes folded into the master prompt.',
    questionIds: ['avoid', 'extraNotes'],
  },
];

const CARTOONISH_VALUES = new Set(['2d_cartoon', '3d_cartoon', '2d_motion']);

function answersUseCartoon(answers: StyleProfileAnswers): boolean {
  if (CARTOONISH_VALUES.has(answers.animationStyle)) return true;
  return answers.visualStyles.some((value) => CARTOONISH_VALUES.has(value));
}

function lockedCastUsesCartoon(characters: LockedCharacter[]): boolean {
  return characters.some(
    (character) =>
      character.name.trim() && (character.look === 'cartoon_2d' || character.look === 'cartoon_3d'),
  );
}

/** True when the brand package is 2D/3D cartoon (or cartoon-ish 2D motion). */
export function isCartoonPackage(styleProfile: unknown): boolean {
  const parsed = parseStyleProfile(styleProfile);
  return answersUseCartoon(parsed.answers) || lockedCastUsesCartoon(parsed.lockedCharacters);
}

/** Photoreal "ultra realistic" look when the channel is not a cartoon package. */
export function isUltraRealisticPackage(styleProfile: unknown): boolean {
  if (isCartoonPackage(styleProfile)) return false;
  const parsed = parseStyleProfile(styleProfile);
  if (parsed.answers.visualStyles.includes('ultra_realistic')) return true;
  return parsed.lockedCharacters.some(
    (character) => character.look === 'ultra_realistic' && character.name.trim(),
  );
}

/** Kids nursery-rhyme channel: generate a rhyme, owner uploads voice, then visual prompts. */
export function isKidsRhymePackage(styleProfile: unknown): boolean {
  const answers = parseStyleProfile(styleProfile).answers;
  return answers.nicheTags.includes('kids_rhymes') || answers.formats.includes('nursery_rhyme');
}

export function formatKidsRhymeScriptRules(videoDurationSec: number, language: string): string {
  const words = Math.round(videoDurationSec * 2.2);
  return `KIDS NURSERY RHYME (mandatory):
- narrationScript is a singable children's rhyme in ${languageDisplayName(language)}, about ${words} spoken words for ~${videoDurationSec}s.
- Real rhyme scheme (AABB or ABAB). Short lines. Concrete images a child can picture (animals, colors, weather, bedtime, counting).
- narrationLines: one sung/spoken line per item with emotion from: playful, whisper, cheerful, excited, calm, empathetic. Never angry or newscast.
- Open with a hooky first couplet. End with a warm closer or giggle beat.
- Safe for ages 2–8. No horror, violence, romance, or sarcasm.
- videoTitle is a catchy kids-rhyme title. topic/storySummary describes the rhyme in English.
- Do not invent scene image/video prompts yet — visuals come after the owner uploads the sung voice.`;
}

export function formatKidsRhymeVisualRules(): string {
  return `KIDS RHYME VISUALS:
- Match the sung lyrics beat-for-beat. Each scene illustrates THAT line of the rhyme, not a different story.
- Bright, friendly, child-safe: 2D/3D cartoon or playful graphics unless Brand lock says otherwise.
- Big readable shapes, happy faces, bounce and squash on rhyming words, sparkle hits on reveals.
- No text-on-screen lyrics unless Brand asks. No scary shadows, weapons, or realistic gore.
- animationPrompt should include timed motion that lands on the rhyme words (hop, spin, peekaboo, twinkle).`;
}

export function formatKidsRhymeIdeaRules(): string {
  return `KIDS NURSERY RHYME IDEAS:
- Each idea is a NEW original children's rhyme topic (animals, counting, bedtime, weather, kindness, vehicles).
- title is a short kids-song title. hook is the opening couplet energy. topicSummary describes the rhyme plot in English.
- Safe for ages 2–8. Never copy a copyrighted nursery rhyme word-for-word as the title.`;
}

/** Drop bare cartoon/anime tokens from a comma-separated negative list. */
export function stripCartoonAnimeNegatives(list: string): string {
  return list
    .split(',')
    .map((token) => token.trim())
    .filter((token) => {
      const lower = token.toLowerCase();
      return lower !== 'cartoon' && lower !== 'anime';
    })
    .join(', ');
}

export function dramaImageNegativePromptFor(styleProfile?: unknown): string {
  const base = DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT;
  return styleProfile && isCartoonPackage(styleProfile) ? stripCartoonAnimeNegatives(base) : base;
}

export function dramaVideoNegativePromptFor(styleProfile?: unknown): string {
  const base = DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT;
  return styleProfile && isCartoonPackage(styleProfile) ? stripCartoonAnimeNegatives(base) : base;
}

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

export function lockedCharacterLookLabel(look: LockedCharacterLook): string {
  return LOCKED_CHARACTER_LOOK_LABELS[look] ?? look;
}

export function namedLockedCharacters(
  characters?: LockedCharacter[] | null,
): LockedCharacter[] {
  return (characters ?? []).filter((character) => character.name.trim());
}

/** Prompt block forcing the same cast in every video. */
export function formatLockedCharactersPrompt(
  characters?: LockedCharacter[] | null,
): string {
  const named = namedLockedCharacters(characters);
  if (!named.length) return '';
  const lines = named.map((character, index) => {
    const ref = formatCharacterReference(character);
    const look = lockedCharacterLookLabel(character.look);
    const personality = character.personality.trim();
    const extra = character.consistencyDetails.trim();
    const hasImage = Boolean(character.imagePath?.trim());
    return `${index + 1}. ${ref} — LOOK: ${look}${personality ? `. Personality: ${personality}` : ''}${extra ? `. Lock: ${extra}` : ''}${hasImage ? '. REFERENCE IMAGE: owner uploaded a locked character still — match that face, body, wardrobe, and look exactly.' : ''}.`;
  });
  return [
    'CHARACTER LOCK (mandatory — same cast in EVERY video on this channel):',
    ...lines,
    'Reuse these exact people/mascots in characters[] and in every imagePrompt/animationPrompt.',
    'Do not rename, recast, age-up, or change face, body, wardrobe, or look unless Brand settings are updated.',
    'When a REFERENCE IMAGE is noted, treat that still as ground truth for identity consistency.',
    'You may add one-off extras only when the story needs a new person; never replace a locked character.',
  ].join('\n');
}

export function mergeLockedCharactersIntoCast(
  generated: CharacterReferenceInput[],
  locked?: LockedCharacter[] | null,
): CharacterReferenceInput[] {
  const named = namedLockedCharacters(locked);
  if (!named.length) return generated;
  const byName = new Map(
    generated.map((character) => [(character.name ?? '').trim().toLowerCase(), character]),
  );
  const merged = named.map((lock) => {
    const existing = byName.get(lock.name.trim().toLowerCase());
    const lookNote = `${lockedCharacterLookLabel(lock.look)} look — identical face, body, and wardrobe in every video`;
    return {
      name: lock.name.trim(),
      appearance: lock.appearance.trim() || existing?.appearance || '',
      wardrobe: lock.wardrobe.trim() || existing?.wardrobe || '',
      age: lock.age.trim() || existing?.age || '',
      consistencyDetails: [lookNote, lock.consistencyDetails.trim(), existing?.consistencyDetails]
        .filter(Boolean)
        .join('. '),
    };
  });
  const lockedNames = new Set(named.map((character) => character.name.trim().toLowerCase()));
  const extras = generated.filter(
    (character) => !lockedNames.has((character.name ?? '').trim().toLowerCase()),
  );
  return [...merged, ...extras];
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
  cartoonPackage?: boolean;
  styleProfile?: unknown;
}): string {
  const lang = languageDisplayName(options.language);
  const clip = Math.max(1, Math.round(options.clipDurationSec));
  const negatives = options.includeNegativePrompts !== false;
  const cartoon =
    options.cartoonPackage === true ||
    (options.styleProfile != null && isCartoonPackage(options.styleProfile));
  const imageNeg = cartoon
    ? stripCartoonAnimeNegatives(DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT)
    : DEFAULT_DRAMA_IMAGE_NEGATIVE_PROMPT;
  const videoNeg = cartoon
    ? stripCartoonAnimeNegatives(DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT)
    : DEFAULT_DRAMA_VIDEO_NEGATIVE_PROMPT;
  const qualityLine = cartoon
    ? '- Quality: keep a consistent 2D or 3D cartoon / CGI look (do NOT require photoreal or "ultra realistic"; do NOT forbid cartoon or anime in negatives).'
    : '- Quality keyword: include the exact phrase "ultra realistic" in every imagePrompt and animationPrompt (and thumbnailPrompt when writing one).';
  const customWords = options.styleProfile != null
    ? parseStyleProfile(options.styleProfile).answers.dialogueWordsByClipSec
    : undefined;
  const targetWords = dialogueWordsTargetForClip(clip, options.language, customWords);
  const ownerRaw = customWords?.[String(nearestDialogueClipDuration(clip))];
  const ownerOverride = typeof ownerRaw === 'number' && ownerRaw > 0;

  return `DRAMA / DIALOGUE package rules (mandatory):
- Spoken dialogue language: write EVERY spoken line in ${lang}. Do not use English dialogue unless the channel language is English. Character names and visual/scene descriptions stay in English; only the spoken words must match ${lang}.
- imagePrompt and animationPrompt bodies stay in English. Quote any on-screen overlay text and spoken lines in ${lang} inside those English prompts.
- ${formatDialogueClipDensityRules(clip, options.language, { targetWords, ownerOverride })}
- Dialogue emotion: every dialogue[] item MUST be { "speaker", "line", "emotion" }. emotion is one of: ${TTS_EMOTIONS.join(', ')}. Pick it from THAT line's situation (argument → angry, loss → sad, reveal → excited, joke → cheerful, comfort → empathetic, waiting → calm, facts → newscast, else default). Emotion is metadata only — NEVER put tone/emotion words (excited, angry, cheerful, calm, sad, whisper, playful, etc.) into imagePrompt or animationPrompt, and do not print the emotion inside the spoken line.
- animationPrompt must embed each spoken line as: "Dialogue: Name: line" (no emotion/tone label in parentheses).
- Lip-sync (mandatory on every talking scene): imagePrompt AND animationPrompt MUST explicitly require accurate mouth lip-sync to the spoken lines — clear mouth shapes matching each word, natural jaw and lip motion, no frozen or mismatched mouths.
- Character references: never use a bare character name alone in imagePrompt or animationPrompt. Always expand to "Name (appearance + wardrobe / consistency)" using the character sheets, e.g. Hina (A girl in Cozy knit sweater with a denim apron for painting tasks). Use the same expanded form for dialogue speaker labels inside animationPrompt where practical.
${qualityLine}
${
  negatives
    ? `- negativePrompt: for every scene return a comma-separated still-image avoid list. Start from: ${imageNeg}. Adapt per scene when useful. Optionally also return thumbnailNegativePrompt for the thumbnail.
- animationNegativePrompt (alias videoNegativePrompt): for every scene return a SEPARATE comma-separated video/animation avoid list focused on motion/temporal artifacts. Start from: ${videoNeg}. Do not reuse the image list verbatim.
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
  /** Recurring cast reused in every video. */
  lockedCharacters?: LockedCharacter[] | null;
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

function hookFormulaLine(hookStyle: string): string {
  switch (hookStyle) {
    case 'shock_fact':
      return 'Hook formula: lead with a concrete shocking fact (number, date, or irreversible action) — not a vague teaser.';
    case 'question':
      return 'Hook formula: open on a specific unanswered question the viewer cannot shrug off.';
    case 'bold_claim':
      return 'Hook formula: a bold, testable claim in the first sentence, then immediately start proving it.';
    case 'story':
      return 'Hook formula: story cold open — name a person, place, and concrete action in the first 3–4 sentences.';
    case 'how_its_made':
      return 'Hook formula: how-it-is-made — show the finished object or outcome first, then rewind into the process.';
    case 'secret_reveal':
      return 'Hook formula: secret reveal — imply hidden information, then start disclosing it immediately.';
    case 'comparison':
      return 'Hook formula: comparison / vs — put two concrete things in tension in the first line.';
    case 'list_tease':
      return 'Hook formula: list tease — promise a ranked payoff (#3 will…) without stalling the story.';
    case 'relatable':
      return 'Hook formula: relatable scenario the audience has lived, then twist it with a specific fact.';
    default:
      return 'Hook formula: cold-open with date/place/concrete action or a sharp question — never a topic title card.';
  }
}

function retentionCadenceLines(retentionStyle: string): string[] {
  const cadence = retentionStyle || 'rehook_8s';
  const lines = [
    'Retention engine (mandatory for EVERY video — not only the first 2 seconds):',
    '- Cold-open hook in the first 1–3 seconds matching the hook style above.',
    '- Re-hooks and curiosity gaps throughout: new question, false conclusion, or "but then" beat so the viewer cannot predict the next second.',
    '- At least one mid-video twist.',
    '- Cliffhanger or payoff on the last line. Never a flat lecture.',
    '- Story map: hook → rising action → twist → payoff → cliffhanger.',
  ];
  if (cadence === 'two_twists') {
    lines.push(
      'Cadence: opening hook + two distinct twist points in the body + a cliffhanger or payoff close.',
    );
  } else if (cadence === 'slow_burn') {
    lines.push(
      'Cadence: slow build with one late twist — still open with a hook and close with a payoff; do not drone.',
    );
  } else {
    lines.push(
      'Cadence: re-hook about every ~8 seconds (one scene of energy) plus a mid-video twist. Treat ~8s as the default scene energy window; scale if clip length differs.',
    );
  }
  return lines;
}

function styleBlockForAnswers(answers: StyleProfileAnswers): string {
  const bits: string[] = [];
  if (answers.customVisualStyle.trim()) {
    bits.unshift(answers.customVisualStyle.trim().slice(0, 400));
  }
  if (answers.visualStyles.includes('2d_cartoon') || answers.animationStyle === '2d_cartoon') {
    bits.push('2D cartoon / illustrated characters and worlds (NOT photoreal)');
  }
  if (answers.visualStyles.includes('3d_cartoon') || answers.animationStyle === '3d_cartoon') {
    bits.push('3D cartoon / CGI characters, stylized (NOT photoreal live-action)');
  }
  if (answers.visualStyles.includes('ultra_realistic')) {
    bits.push('ultra realistic photoreal people and materials, real-world lighting, camera grain');
  }
  if (
    answers.visualStyles.includes('fast_motion_graphics') ||
    answers.visualStyles.includes('fast_cuts') ||
    answers.animationStyle === '2d_motion' ||
    answers.animationStyle === 'kinetic_type' ||
    answers.pacing === 'high'
  ) {
    bits.push('fast-paced motion graphics, snappy cuts, graphic punches, kinetic type');
  }
  if (answers.visualStyles.includes('paper_collage')) {
    bits.push('documentary paper collage, hand-cut editorial layers');
  }
  const labeled = labelsFor('visualStyles', answers.visualStyles);
  const anim = labelFor('animationStyle', answers.animationStyle);
  if (labeled.length) bits.push(joinList(labeled));
  if (anim && answers.animationStyle !== 'none') bits.push(anim);
  return bits.filter(Boolean).join('; ') || 'fast-paced AI motion graphics (house default)';
}

function audioInPromptRule(presentation: string): string {
  if (presentation === 'dialogue') {
    return 'quoted spoken Dialogue lines in the output language (no tone/emotion labels) + accurate mouth lip-sync + SFX/music under them. No TTS voiceover.';
  }
  if (presentation === 'mixed') {
    return 'NARRATION scenes: SFX/music/ambience only (VO is external). DIALOGUE scenes: quoted spoken lines in the output language (no tone/emotion labels) + accurate mouth lip-sync + SFX/music; no VO on those clips.';
  }
  if (presentation === 'background_audio') {
    return 'Background Audio only: kids-channel bed SFX — crowd cheering, applause, playful whoops, soft music beds, reaction beds under the action. NO spoken narration, NO character dialogue, NO lip-sync speech.';
  }
  if (presentation === 'text_only') {
    return 'SFX/music/ambience only. No spoken speech.';
  }
  if (presentation === 'on_camera') {
    return 'host speech only when the host is visibly talking; otherwise SFX/music. Do not invent extra VO.';
  }
  return 'SFX, music, ambience only. Do NOT invent spoken narration, lip-sync, or character dialogue — TTS voiceover is an external track.';
}

/** Owner-editable visual prompt skeleton composed from questionnaire answers. */
export function formatVisualPromptDna(answers: StyleProfileAnswers): string {
  const a = styleProfileAnswersSchema.parse(answers);
  const cartoon = answersUseCartoon(a);
  const fast =
    a.pacing === 'high' ||
    a.visualStyles.includes('fast_motion_graphics') ||
    a.visualStyles.includes('fast_cuts') ||
    a.animationStyle === 'kinetic_type' ||
    a.animationStyle === '2d_motion';
  const closer = cartoon
    ? 'Keep cartoon/CGI look consistent. Do NOT add cartoon or anime to negatives.'
    : a.visualStyles.includes('ultra_realistic')
      ? 'Include the exact phrase "ultra realistic". Avoid cartoon, anime, plastic skin, stock-photo look.'
      : 'Avoid blurry, watermark, burned-in subtitles, extra limbs, deformed face.';
  return [
    'SCENE: one hero subject (~70% visual weight) + 2–3 supporting elements. One visual idea only — never a collage of unrelated beats.',
    `STYLE: ${a.customVisualStyle.trim() || styleBlockForAnswers(a)}`,
    'FRAMING: shot type, camera angle, lens feel.',
    'LIGHTING / MOOD: time of day, contrast, color grade.',
    'MOTION (animationPrompt): timed beats 0-2 / 2-4 / 4-6 / 6-8 for ~8s clips (scale if clip length differs). Universal motion language in the animation guidelines below.',
    `AUDIO-IN-PROMPT: ${audioInPromptRule(a.presentation)}`,
    `CLOSER / NEGATIVES: ${closer}`,
    'SOURCE: every still and clip is AI-generated. Never call for stock footage, screen recordings, live B-roll, phone-camera plates, or green-screen composites.',
    fast
      ? 'Pace: snappy cuts, graphic punches, kinetic type, impact every 1–2s, no sleepy holds.'
      : a.pacing === 'calm'
        ? 'Pace: measured holds are allowed, but still change the frame before attention dies.'
        : 'Pace: keep energy moving; prefer graphic punches over static lectures.',
  ].join('\n');
}

/** Seeded motion language when the owner has not pasted animation guidelines. */
export function composeDefaultAnimationDna(answers: StyleProfileAnswers): string {
  const a = styleProfileAnswersSchema.parse(answers);
  const lines = [
    'Universal MOTION DNA (apply to every clip; owner may edit this once):',
    'Timed action breakdown for ~8s clips (scale proportionally if clip length differs):',
    '0-2s: hook visual / first impact or entrance.',
    '2-4s: develop the hero action; camera or graphic punch.',
    '4-6s: complication, twist cue, or supporting element lands.',
    '6-8s: payoff, sting, or bridge into the next scene.',
  ];
  if (a.customVisualStyle.trim()) {
    lines.push(
      'Owner/analyzed visual style is authoritative for look AND motion. Keep camera, cut rhythm, graphics, and easing consistent with that style.',
    );
  }
  if (a.visualStyles.includes('2d_cartoon') || a.animationStyle === '2d_cartoon') {
    lines.push(
      '2D cartoon animation: pose-to-pose, clear silhouettes, smear frames on fast action, snappy holds. Illustrated AI scenes, not photoreal live-action.',
    );
  } else if (a.visualStyles.includes('3d_cartoon') || a.animationStyle === '3d_cartoon') {
    lines.push(
      '3D cartoon / CGI: stylized characters, squash/stretch on impacts, kinetic camera, not photoreal skin.',
    );
  } else if (a.visualStyles.includes('paper_collage') || a.animationStyle === 'stop_motion') {
    lines.push(
      'Paper-collage / stop-motion AI: elements land as cutouts with paper-drag and stamp settles; no smooth CGI morphs.',
    );
  } else if (a.animationStyle === 'ai_scene' || a.visualStyles.includes('cinematic') || a.visualStyles.includes('ultra_realistic')) {
    lines.push(
      a.visualStyles.includes('ultra_realistic')
        ? 'Ultra realistic AI scene motion: photoreal skin, real-world lighting, motivated camera. Never stock or live plates. Include "ultra realistic" in every prompt.'
        : 'AI scene motion: generated environment + subject; punch-ins, motivated pans, light environmental life. Never stock or live plates.',
    );
  } else {
    lines.push(
      'Fast-paced AI motion graphics (house default): snappy cuts, kinetic type, graphic punches, whooshes and impact hits. No sleepy locked holds. No stock footage.',
    );
  }
  lines.push(
    'Camera: punch-ins, whip pans, or motivated moves — locked-off only when the graphic itself is moving fast.',
  );
  return lines.join('\n');
}

function audioModeSection(
  answers: StyleProfileAnswers,
  language: string,
  extras: { existingNarration: string; voiceNotes: string; pacing: string; captions: string },
): string {
  const lang = languageDisplayName(language);
  const mode = answers.presentation;
  const label = labelFor('presentation', mode) || 'unspecified';
  const lines = [
    '## 1. Audio mode',
    `Presentation: ${label}`,
    formatSpokenLanguageRules(language),
  ];
  if (mode === 'dialogue') {
    const customWords = answers.dialogueWordsByClipSec ?? {};
    const ownerTargetParts = (['8', '10', '15', '30'] as const)
      .map((k) => {
        const n = customWords[k];
        return typeof n === 'number' && n > 0 ? `${k}s→${n} words` : null;
      })
      .filter((part): part is string => Boolean(part));
    lines.push(
      'Dialogues only — NO TTS voiceover. Leave narrationScript empty.',
      'Every spoken line lives in scene.dialogue[] AND as quoted Dialogue lines inside animationPrompt (and in imagePrompt when a talking still is shown).',
      'Label spoken lines as "Dialogue: Speaker: line" — NEVER put tone/emotion words (excited, angry, cheerful, etc.) into imagePrompt or animationPrompt.',
      'Fill each talking clip with enough dialogue for the full duration (multiple exchanges, full sentences) — never one short line then silence. Paste every line into animationPrompt in full.',
      'Hindi/Urdu dialogue: write about 2× English word volume and keep speaking across the whole clip — one ~3–4s line in an 8s scene is a hard fail — unless Content pipeline Dialogue words per clip is set; then obey that exact owner target.',
      ...(ownerTargetParts.length
        ? [
            `OWNER DIALOGUE WORD TARGETS (Content pipeline): ${ownerTargetParts.join(', ')}. Every talking scene MUST hit the target for its clip length (HARD).`,
          ]
        : []),
      'Every talking imagePrompt and animationPrompt MUST require accurate mouth lip-sync to the spoken lines.',
      `Spoken lines in ${lang}. Visual prompt bodies stay English.`,
    );
  } else if (mode === 'mixed') {
    lines.push(
      'Narration + Dialogues in the SAME video.',
      'TTS voiceover is generated ONLY for narrator windows. narrationScript / narrationLines cover those narrator windows only — not dialogue-only clips and not the full runtime as one lecture.',
      `Talking scenes: no VO on those clips; spoken lines go in dialogue[] and quoted in animationPrompt as "Dialogue: Speaker: line" (no tone/emotion labels), in ${lang}.`,
      'Talking scenes: every imagePrompt and animationPrompt MUST require accurate mouth lip-sync to the spoken lines.',
      'See section 5 for the VO LAYUP TIMELINE the editor uses to place generated VO vs dialogue clips.',
    );
  } else if (mode === 'background_audio') {
    lines.push(
      'Background Audio — NO TTS voiceover and NO character dialogue. Leave narrationScript empty and dialogue[] empty.',
      'Visual prompts MUST NOT invent spoken speech, lip-sync talking, or character lines.',
      'animationPrompt (and AUDIO-IN-PROMPT) MUST include kids-channel style background beds: crowd cheering, applause, playful whoops, soft music beds, and reaction SFX synced to the action — not spoken words.',
    );
  } else if (mode === 'on_camera') {
    lines.push(
      'On-camera host. TTS voiceover is not the default. Host speech may appear in prompts only when the host is visibly talking.',
    );
  } else if (mode === 'text_only') {
    lines.push(
      'Text-on-screen only. No TTS. No spoken dialogue. Visual prompts must not invent speech.',
    );
  } else {
    lines.push(
      'Narration — the system generates TTS voiceover from narrationScript / narrationLines.',
      'Visual prompts (imagePrompt + animationPrompt) MUST NOT invent spoken speech, lip-sync, talking heads, or character dialogue.',
      'AUDIO-IN-PROMPT = music, SFX, ambience only. Voiceover is an external audio track laid over the video.',
      `Spoken narration in ${lang}.`,
    );
  }
  if (extras.pacing) lines.push(`Pacing & energy: ${extras.pacing}`);
  if (extras.captions) lines.push(`Captions / on-screen text: ${extras.captions}`);
  if (extras.existingNarration) lines.push(`Narration style notes: ${extras.existingNarration}`);
  if (extras.voiceNotes) lines.push(`Voice / TTS notes: ${extras.voiceNotes}`);
  lines.push(
    `Keep delivery natural for this audio mode. Align on-screen text with caption rules. ${formatOnScreenTextLanguageRules(language)}`,
  );
  return lines.join('\n');
}

function mixedVoTimelineSection(): string {
  return [
    '## 5. Mixed VO timeline',
    'editingInstructions MUST include a VO LAYUP TIMELINE with cumulative timestamps covering the full video:',
    'Scene N  mm:ss–mm:ss  NARRATION (lay generated VO here)',
    'Scene N  mm:ss–mm:ss  DIALOGUE (no VO; speech is in animationPrompt)',
    'Scenes may alternate. Opening scene should usually be NARRATION hook unless the hook is a spoken character line.',
    'narrationScript / narrationLines = narrator windows only.',
    'Dialogue scenes: dialogue[] + quoted lines in animationPrompt; narrationSegment empty for those clips.',
    'After package generation, the editor uses this timeline to place the generated voiceover vs dialogue-only clips.',
  ].join('\n');
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
  const retention = labelFor('retentionStyle', a.retentionStyle);
  const captions = labelFor('captionStyle', a.captionStyle);
  const ownerAnimationGuidelines = options?.animationReferencePrompt?.trim() ?? '';
  const thumbnailGuidelines = options?.thumbnailReferencePrompt?.trim() ?? '';
  const titleTemplate = options?.titleTemplate?.trim() ?? '';
  const descriptionTemplate = options?.descriptionTemplate?.trim() ?? '';
  const contentType = options?.contentType?.trim() ?? '';
  const voiceNotes = options?.voiceNotes?.trim() ?? '';
  const existingWriting = options?.writingStyle?.trim() ?? '';
  const existingNarration = options?.narrationStyle?.trim() ?? '';
  const locked = namedLockedCharacters(options?.lockedCharacters);
  const cartoon = answersUseCartoon(a) || lockedCastUsesCartoon(locked);
  const documentaryFormat = a.formats.some((value) => {
    const v = value.toLowerCase().trim();
    return v === 'documentary' || v.includes('documentary');
  });

  const sections: string[] = [];

  sections.push(
    [
      '## Role',
      'You are the creative system for this short-form social video channel.',
      'Inject this master brief into EVERY AI task: idea generation, scripts, narration, captions, titles, descriptions, tags, thumbnails, and scene animation prompts.',
      'Obey brand voice, audio-mode rules, do/don\'t constraints, and visual prompt DNA without inventing an unrelated niche.',
      'Owners may edit numbered sections below (especially 2 Hook & retention and 3 Visual prompt DNA) after Generate; treat edited text as ground truth.',
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

  sections.push(
    audioModeSection(a, language, {
      existingNarration,
      voiceNotes,
      pacing,
      captions,
    }),
  );

  const hookSec: string[] = ['## 2. Hook & retention engine (mandatory for every video)'];
  if (hook) hookSec.push(`Preferred opening hook: ${hook}`);
  hookSec.push(hookFormulaLine(a.hookStyle));
  if (retention) hookSec.push(`Retention style: ${retention}`);
  hookSec.push(...retentionCadenceLines(a.retentionStyle));
  sections.push(hookSec.join('\n'));

  const dna: string[] = [
    '## 3. Visual prompt DNA',
    'Edit this block — it is the template the model must fill per scene. One idea per beat. Hero ~70% + 2–3 supports. Self-contained image prompt.',
  ];
  if (visuals.length) dna.push(`AI scene look: ${joinList(visuals)}`);
  if (animation && a.animationStyle !== 'none') {
    dna.push(`AI animation / motion: ${animation}`);
  }
  dna.push(
    'Pipeline: AI stills + AI animation only. Never stock footage, screen recordings, live B-roll, or green screen.',
  );
  if (a.customVisualStyle.trim()) {
    dna.push(
      'OWNER / ANALYZED VISUAL STYLE (authoritative — match this look, graphics, editing, and motion in every imagePrompt and animationPrompt; chip labels are secondary when they conflict):',
    );
    dna.push(a.customVisualStyle.trim());
  }
  dna.push(formatVisualPromptDna(a));
  if (cartoon) {
    dna.push(
      'Cartoon package: STYLE must say 2D cartoon or 3D CGI cartoon as selected. MUST NOT forbid cartoon or anime in negatives.',
    );
  }
  if (thumbnailGuidelines) {
    dna.push('Thumbnail style reference (match composition, typography, lighting, and mood):');
    dna.push(thumbnailGuidelines);
  }
  dna.push(
    'Keep thumbnails, cuts, and scene framing consistent with this DNA across the whole package.',
  );
  sections.push(dna.join('\n'));

  const characterSec = ['## 4. Character lock'];
  if (locked.length) {
    characterSec.push(formatLockedCharactersPrompt(locked));
  } else {
    characterSec.push(
      'No locked cast yet. When people or mascots appear, lock name, face, body, age, wardrobe, and signature props across every scene of THIS video.',
    );
  }
  characterSec.push(
    'Never use a bare character name alone in imagePrompt or animationPrompt — expand to "Name (appearance + wardrobe / consistency)" from the character sheets.',
  );
  if (cartoon) {
    characterSec.push(
      '2D/3D cartoon: keep model sheet proportions, palette, and outfit identical shot to shot and video to video.',
    );
  } else if (a.visualStyles.includes('ultra_realistic')) {
    characterSec.push(
      'Ultra realistic: same face geometry, skin, age, and wardrobe every video. Include the phrase "ultra realistic".',
    );
  } else {
    characterSec.push(
      'Wardrobe and appearance stay invariant unless the story explicitly changes them.',
    );
  }
  sections.push(characterSec.join('\n'));

  if (a.presentation === 'mixed') {
    sections.push(mixedVoTimelineSection());
  }

  const voice: string[] = ['## Brand voice & writing'];
  if (tones.length) voice.push(`Tone: ${joinList(tones)}`);
  if (existingWriting) voice.push(`Writing style notes: ${existingWriting}`);
  voice.push(
    `Write crisp, scroll-stopping copy. Prefer concrete specifics over vague claims. ${formatPublishCopyLanguageRules(language)} On-screen captions stay in ${lang}. Publish titles follow the LANGUAGE POLICY title-language rules.`,
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

  const motion = ownerAnimationGuidelines || composeDefaultAnimationDna(a);
  sections.push(
    [
      '## Animation / video generation guidelines',
      ownerAnimationGuidelines
        ? 'Owner-pasted motion rules (do not replace — apply to every scene animationPrompt):'
        : 'Seeded motion DNA from brand answers (edit after Generate if you want a different universal motion language):',
      motion,
    ].join('\n'),
  );

  const rules: string[] = ['## 6. Hard rules'];
  if (a.avoid.trim()) rules.push(`Do NOT: ${a.avoid.trim()}`);
  rules.push('Stay strictly on-niche and on-audience.');
  rules.push('Do not invent conflicting brand rules or unrelated topics.');
  rules.push(
    'Every still and clip is AI-generated. Never request stock footage, screen recordings, live B-roll, phone-camera plates, or green screen.',
  );
  rules.push('Prefer reusable patterns that match tone, pacing, hooks, audio mode, and visual DNA above.');
  if (documentaryFormat) {
    rules.push(
      'Real-tragedy / documentary: no gore, no suffering close-ups, no exploitation of victims — keep dignity and editorial distance.',
    );
  }
  if (cartoon) {
    rules.push('Do not add cartoon or anime to negative prompts for this channel.');
  }
  sections.push(rules.join('\n'));

  if (a.extraNotes.trim()) {
    sections.push(['## Additional owner notes', a.extraNotes.trim()].join('\n'));
  }

  sections.push(
    [
      '## Operating checklist',
      '- Idea titles follow the title-language rules; idea angle/hook/rationale/topicSummary and story drafts stay English, on-niche, format-fit, hook-first.',
      `- Scripts / narration / dialogue: match audio mode, pacing, and tone; speak ${lang}.`,
      `- On-screen text: ${formatOnScreenTextLanguageRules(language)} ${formatPublishCopyLanguageRules(language)} Publish titles follow the title-language rules; follow templates and caption style when set.`,
      '- Image / video / animation prompts: English bodies; quoted overlay/spoken text in the output language; fill Visual prompt DNA per scene.',
      '- Tags: discoverable, niche-relevant, no spam stuffing.',
      '- Thumbnails & animationPrompts: obey visual DNA + animation guideline sections.',
      a.presentation === 'mixed'
        ? '- Mixed: VO LAYUP TIMELINE in editingInstructions with mm:ss NARRATION vs DIALOGUE windows.'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );

  const writingBits = [
    tones.length ? `Tone: ${joinList(tones)}` : '',
    formats.length ? `Formats: ${joinList(formats)}` : '',
    hook ? `Hooks: ${hook}` : '',
    retention ? `Retention: ${retention}` : '',
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
      a.extraNotes.trim() ||
      a.customVisualStyle.trim(),
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
  const overlayLang = thumbnailOverlayLanguageLabel(profile?.language);
  const onScreen = formatOnScreenTextLanguageRules(profile?.language);
  const overlayRule = ` If the thumbnail includes on-image lettering, quote that text in ${overlayLang}; keep the rest of the prompt in English. ${onScreen}`;
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
  /** Mixed VO + dialogue: per-scene narration vs talking rules. */
  mixedPresentation?: boolean;
  cartoonPackage?: boolean;
  visualPromptDna?: string;
}

function timedBeatHint(clipDurationSec: number | null): string {
  if (!clipDurationSec || clipDurationSec <= 0) {
    return 'timed beats 0-2 / 2-4 / 4-6 / 6-8 for ~8s clips (scale if clip length differs)';
  }
  if (clipDurationSec <= 4) {
    return `timed beats across the full ~${clipDurationSec}s clip (scale the 0-2 / 2-4 / 4-6 / 6-8 pattern)`;
  }
  const q = Math.max(1, Math.round(clipDurationSec / 4));
  return `timed beats 0-${q} / ${q}-${q * 2} / ${q * 2}-${q * 3} / ${q * 3}-${clipDurationSec}s (scale of the 8s 0-2/2-4/4-6/6-8 pattern)`;
}

/**
 * Shared rules for per-scene still + video prompts (dialogue one-shot and visuals stage).
 */
export function formatSceneVisualPromptRules(
  sceneCount: number,
  options?: SceneVisualPromptRuleOptions,
): string {
  const drama = options?.dramaOrDialogue === true;
  const mixed = options?.mixedPresentation === true && !drama;
  const narration = options?.narrationVoiceover === true && !drama && !mixed;
  const cartoon = options?.cartoonPackage === true;
  const clip =
    typeof options?.clipDurationSec === 'number' && options.clipDurationSec > 0
      ? Math.round(options.clipDurationSec)
      : null;
  const dna = (options?.visualPromptDna ?? '').trim();

  const base = `Scene image & video prompt quality (required for every scene):
- Return scenes ordered Scene 1 through Scene ${sceneCount} (sceneIndex 1..${sceneCount}). Each prompt string must be human-readable prose ready to copy-paste — never dump nested JSON inside the prompt text.
- Fill this visual prompt DNA per scene (one idea only): SCENE (hero ~70% + 2–3 supports) / STYLE / FRAMING / LIGHTING / MOOD / MOTION (${timedBeatHint(clip)}) / AUDIO-IN-PROMPT / CLOSER + negatives.
- imagePrompt: a long, detailed, standalone still-image generation prompt. Include subject(s) and what they are doing; character appearance/wardrobe consistency from the character sheets when people appear; framing and composition (shot type, camera angle, lens feel); lighting; environment and background; time of day / era; art style and medium; mood/atmosphere; and key props. Tie the still only to that scene's narration segment, dialogue, and time range.
- animationPrompt: a long, detailed, standalone video/animation generation prompt covering the full clip duration. Include what happens over time; camera move (pan, tilt, dolly, zoom, or locked-off); subject motion; environmental motion; pacing; transition into/out of the shot; and sync with narration or dialogue (quote or clearly time the spoken lines). Maintain continuity with adjacent scenes when relevant.
- Self-contained negatives (mandatory): for every scene return BOTH negativePrompt (still-image avoid list) AND animationNegativePrompt / videoNegativePrompt (video/motion avoid list). Embed negativePrompt only at the end of imagePrompt, and animationNegativePrompt only at the end of animationPrompt, each as "${NEGATIVE_PROMPT_INLINE_PREFIX} …". The two lists MUST differ — do not copy the same string into both prompts.${
    cartoon
      ? '\n- Cartoon package: STYLE must say 2D cartoon or 3D CGI cartoon. Do NOT add cartoon or anime to negatives.'
      : ''
  }`;

  const dnaBlock = dna
    ? `
Visual prompt DNA (fill every scene from this skeleton):
${dna}`
    : '';

  const narrationBlock = narration
    ? `
- Narration / voiceover mode (external VO is the real audio track — the video model must NOT generate spoken narration or character speech):
  - negativePrompt (image): forbid dialogue/talking characters for stills, plus still-image artifacts. Start from: ${DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT}. Embed only in imagePrompt.
  - animationNegativePrompt (video): forbid dialogue/talking AND cover motion/audio-related avoids (lip-sync speech, invented VO on the video track, sung vocals, morphing/flicker/jitter). Start from: ${DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT}. Embed only in animationPrompt.
  - animationPrompt MUST include scene-based sound design / audio layer directions synced to the beat: music mood/genre/energy, dramatic SFX (impact hits, whooshes, tension risers, stingers), and ambient bed cues appropriate to the scene and narration beat. VO stays external — describe music/SFX/ambience only, never ask for spoken dialogue or VO on the video track.`
    : '';

  const mixedBlock = mixed
    ? `
- Mixed narration + dialogues: tag each scene as audioMode "narration" | "dialogue" (or "both" only if a clip truly layers both).
  - NARRATION scenes (audioMode=narration, dialogue[] empty): treat as voiceover — no talking in prompts; start negatives from ${DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT} (image) and ${DEFAULT_NARRATION_VIDEO_NEGATIVE_PROMPT} (video). AUDIO-IN-PROMPT = SFX/music/ambience only.
  - DIALOGUE scenes (audioMode=dialogue, dialogue[] filled): quoted speech allowed in imagePrompt/animationPrompt; do NOT add "no dialogue" / "no talking" negatives. narrationSegment should be empty; no VO on these clips.
  - editingInstructions must keep/update the VO LAYUP TIMELINE (Scene N  mm:ss–mm:ss  NARRATION|DIALOGUE).`
    : '';

  if (drama) {
    const quality = cartoon
      ? '- Always use expanded character references (never bare names alone). Keep the cartoon/CGI look; do NOT require "ultra realistic"; do NOT forbid cartoon or anime.'
      : '- Always use expanded character references (never bare names alone) and include the quality phrase "ultra realistic" in imagePrompt and animationPrompt.';
    return `${base}${dnaBlock}
- Drama/dialogue detail: imagePrompt and animationPrompt must be especially specific about faces, wardrobe continuity, blocking, and prop interaction${clip ? ` across the full ~${clip}s clip` : ''}. Do NOT write tone/emotion words (excited, angry, cheerful, etc.) into the prompts — keep spoken lines as "Dialogue: Name: line" only.
- Lip-sync (mandatory): every talking imagePrompt and animationPrompt MUST explicitly require accurate mouth lip-sync to the spoken lines (clear mouth shapes matching each word; no frozen or mismatched mouths).
${quality}
- Include distinct negativePrompt (image) and animationNegativePrompt (video) per scene; embed each into its own prompt only. Dialogue is allowed — do NOT add "no dialogue" negatives.
- Where appropriate, animationPrompt should also call for dramatic production audio under/around dialogue (impact hits, whooshes, tension risers, ambient beds) without replacing spoken lines.`;
  }

  return `${base}${dnaBlock}${mixedBlock}${narrationBlock}`;
}

/**
 * Combine base scene visual rules with optional channel animation guidelines.
 */
export function formatSceneVisualPromptRulesWithChannel(
  sceneCount: number,
  profile: ChannelStyleFields | null | undefined,
  options?: SceneVisualPromptRuleOptions,
): string {
  const parsed = parseStyleProfile(profile?.styleProfile);
  const cartoon = options?.cartoonPackage ?? isCartoonPackage(profile?.styleProfile);
  const mixed =
    options?.mixedPresentation ?? parsed.answers.presentation === 'mixed';
  const dna = options?.visualPromptDna ?? formatVisualPromptDna(parsed.answers);
  const base = formatSceneVisualPromptRules(sceneCount, {
    ...options,
    cartoonPackage: cartoon,
    mixedPresentation: mixed,
    visualPromptDna: dna,
  });
  const ownerAnim = formatAnimationPromptInstructions(profile);
  const seeded = ownerAnim
    ? ownerAnim
    : `Channel animation / video guidelines (seeded MOTION DNA — apply to every scene animationPrompt):
${composeDefaultAnimationDna(parsed.answers)}`;
  return `${base}\n\n${seeded}`;
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
    lines.push(
      formatIdeaTitleLanguageRules(profile.language),
      formatSpokenLanguageRules(profile.language),
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
        lockedCharacters: parsed.lockedCharacters,
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
