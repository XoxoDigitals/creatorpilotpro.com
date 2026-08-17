/**
 * Documentary Paper Collage Engine — prompt DNA for channels whose style
 * formats include documentary (or similar) and presentation is voiceover / mixed.
 * Mapped into the AI-owner package pipeline (ideas → script → visuals), not a chat UI.
 */
import {
  DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT,
  NEGATIVE_PROMPT_INLINE_PREFIX,
  parseStyleProfile,
} from './style-profile.js';

/** Verbatim STYLE BLOCK from engine STATE 7 (include in every image prompt). */
export const DOCUMENTARY_COLLAGE_STYLE_BLOCK =
  'hand-cut documentary paper collage on aged newsprint and archival map surfaces, black and white halftone photograph cutouts with rough scissor-cut edges and offset accent strokes, torn paper edges, masking tape fragments, typewriter caption strips, rubber stamp marks, red string and brass pins where the story calls for connections, desaturated archival palette of tan, ink black, and halftone gray with ONE hot red signal accent and a restrained mustard yellow secondary, condensed bold headline lettering only where a label is specified, visible print grain and paper fiber, matte, flat even documentary lighting with soft cutout drop shadows';

/** Verbatim CLOSER from engine STATE 7 (end every image prompt with this). */
export const DOCUMENTARY_COLLAGE_CLOSER =
  'Every element must appear physically hand-cut and layered from real paper, with visible cutout edges, halftone print texture, and soft shadow separation between layers. The composition stays clean, minimal, and editorial with generous negative space. NOT digital illustration, NOT cartoon, NOT 3D render, NOT glossy, no gradients, no clutter, no watermark, no logos, no text beyond the specified label. Premium documentary collage aesthetic, 16:9, ultra-detailed, 8K.';

/** Thumbnail closer: same as STATE 7 closer with label wording adjusted. */
export const DOCUMENTARY_COLLAGE_THUMBNAIL_CLOSER =
  'Every element must appear physically hand-cut and layered from real paper, with visible cutout edges, halftone print texture, and soft shadow separation between layers. The composition stays clean, minimal, and editorial with generous negative space. NOT digital illustration, NOT cartoon, NOT 3D render, NOT glossy, no gradients, no clutter, no watermark, no logos, no text beyond the specified thumbnail words. Premium documentary collage aesthetic, 16:9, ultra-detailed, 8K.';

/**
 * Verbatim UNIVERSAL VIDEO PROMPT from engine STATE 8.
 * Applied to every collage still as the animation / video instruction.
 */
export const DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT = `Transform the provided image into a 10-second premium editorial documentary paper-collage animation. Preserve the final composition of the provided image exactly. Do not redesign, reposition, resize, or replace any element. The provided image is the FINISHED frame that the animation builds toward.
Style: hand-cut documentary paper collage in motion. Aged newsprint and archival surfaces, halftone photo cutouts, torn edges, tape, stamps, red string, typewriter strips. Every element moves as a rigid physical paper piece. Visible cutout thickness, print grain, soft layered shadows. Stop-motion cadence, stepped easing, 2-3 frame holds, the hand-made "cutting on twos" feel. Never smooth CGI motion.
CAMERA, STRICT: the camera stays completely locked for the entire clip. No zoom, no pan, no tilt, no rotation, no orbit, no dolly, no tracking, no handheld shake, no focus pulls, no reframing, no cuts, no transitions, no morphing, no object replacement, no time skips. One continuous static shot.
0 TO 7 SECONDS, BUILD-ON ASSEMBLY: the frame opens on the EMPTY background plate only: the bare aged-newsprint or archival surface with its stains, grain, and any fixed scaffolding (a map base, a timeline line, a corkboard), with every story element absent. Elements then enter one by one, back to front, in narrative order: background scraps settle first, then the hero cutout slides in with paper drag and a small settle, supporting cutouts drop or pin on with a 2-frame stamp settle, tape presses down, typewriter strips slide in, stamps slap on, red string draws itself from pin to pin, marker underlines and arrows draw themselves last. Each entrance lands with a tiny handcrafted bounce and casts a real layered shadow. No element moves again after it lands. By 7 seconds the frame exactly matches the provided image.
7 TO 10 SECONDS, LIVING PAPER POSTER: everything holds position. Only subtle life remains: paper corners lift a millimeter in a draft, halftone dots shimmer faintly, string tension quivers once, shadows breathe, stamp ink glistens subtly. Nothing changes location, nothing scales, nothing rotates significantly, nothing enters or exits.
AUDIO: no music, no narration, no voices, no dialogue, no talking characters, no lip-sync speech. Only close-up paper ASMR and faint scene-appropriate ambience synced to the assembly: paper sliding, cardstock taps, tape press, stamp thud, string zip, pin click, soft room tone. All subtle. Voiceover is external — never invent spoken lines on the video track.
FINAL RULE: the finished clip must feel like a real editorial paper collage assembling itself on a table, then holding as a living poster, matching the provided image exactly from 7 seconds to the end.`;

/** Title shapes from engine STATE 2 (idea generation). */
export const DOCUMENTARY_TITLE_SHAPES = [
  'How [event] Unfolded',
  'The Hunt for [target]',
  'The [adjective] Story of [subject]',
  'Why [place] [did X]',
  '[Event] Explained',
  'The Man/Woman Who [impossible act]',
  'What Really Happened to [subject]',
] as const;

/** Calm documentary voice direction for TTS / narration notes (Edge TTS, not ElevenLabs GUI). */
export const DOCUMENTARY_VOICEOVER_DIRECTION =
  'calm deadpan male narrator, mid-range, mild gravitas, about 155 wpm, minimal emotion spikes, documentary read';

const UNIVERSAL_VIDEO_PROMPT_MARKER = 'Universal video prompt:';
const THUMBNAIL_VARIANTS_MARKER = 'Thumbnail prompt variants:';
const THUMBNAIL_NEGATIVE_MARKER = 'Thumbnail negative prompt:';
const NARRATION_LINES_MARKER = 'Narration lines:';

/** Documentary-like format values from the style questionnaire (and loose matches). */
export function isDocumentaryLikeFormat(value: string): boolean {
  const v = value.toLowerCase().trim();
  if (!v) return false;
  if (v === 'documentary') return true;
  if (v.includes('documentary')) return true;
  if (v === 'doc' || v.startsWith('doc_') || v.endsWith('_doc')) return true;
  return false;
}

/**
 * Activate the paper-collage engine when formats include documentary (or similar)
 * and presentation is voiceover or mixed. Drama / pure dialogue stays on its own path.
 */
export function isDocumentaryVoiceoverPackage(styleProfile: unknown): boolean {
  const answers = parseStyleProfile(styleProfile).answers;
  const documentary = answers.formats.some(isDocumentaryLikeFormat);
  if (!documentary) return false;

  const presentation = answers.presentation;
  if (presentation !== 'voiceover' && presentation !== 'mixed') return false;

  const dramaFormat = answers.formats.some((value) => {
    const v = value.toLowerCase().trim();
    return v === 'drama' || v.includes('skit');
  });
  if (dramaFormat) return false;

  return true;
}

/** True when idea generation should use documentary title-shape rules. */
export function isDocumentaryIdeaGeneration(styleProfile: unknown): boolean {
  const answers = parseStyleProfile(styleProfile).answers;
  return answers.formats.some(isDocumentaryLikeFormat);
}

/** Target spoken word count at ~2.5 words per second. */
export function documentaryTargetWordCount(durationSec: number): number {
  const sec = Math.max(1, Math.round(durationSec));
  return Math.round(sec * 2.5);
}

/** Prefer ~2.5s visual beats when clip length is longer than that. */
export function documentaryBeatSceneCount(
  videoDurationSec: number,
  clipDurationSec: number,
): number {
  const video = Math.max(1, Math.round(videoDurationSec));
  const clip = Math.max(1, Math.round(clipDurationSec));
  const fromClip = Math.max(1, Math.round(video / clip));
  const fromBeats = Math.max(1, Math.round(video / 2.5));
  // Prefer tighter beats when the owner left a long default clip length.
  return clip > 3 ? Math.max(fromClip, fromBeats) : fromClip;
}

export function formatDocumentaryIdeaRules(): string {
  const shapes = DOCUMENTARY_TITLE_SHAPES.map((s) => `"${s}"`).join(', ');
  return `DOCUMENTARY idea rules (mandatory when this channel makes documentary-format content):
- Prefer declarative or interrogative titles with light punctuation. No clickbait spam.
- Use these title shapes when they fit: ${shapes}.
- Each idea needs a concrete hook: a date, a name, a number, or a place that makes it feel real.
- No two ideas in the same sub-territory.
- Never use em dashes (—) anywhere. Use commas, colons, parentheses, or plain hyphens instead.
- Real-tragedy restraint: no gore, no victim mockery.`.trim();
}

export function formatFernNarrationRules(durationSec: number): string {
  const target = documentaryTargetWordCount(durationSec);
  const min = Math.max(1, Math.round(target * 0.95));
  const max = Math.max(min + 1, Math.round(target * 1.05));
  return `DOCUMENTARY voiceover narration (Fern DNA, mandatory):
- Continuous narration only: one flowing prose block. No chapter labels, no headers, no camera directions, no visual cues.
- Word count: target about ${target} spoken words for ${Math.round(durationSec)}s at ~2.5 words/sec (acceptable range ${min}-${max}, within ~5%).
- Cold open: first 3-4 sentences (about 30-40 words) open on a precise date, a location, and one small concrete action. Example shape: "November 24, 1971. Portland International Airport. A man in a dark suit buys a one-way ticket under the name Dan Cooper."
- Calm, precise documentary tone. Short declaratives mixed with one longer explanatory sentence per stretch. Temporal and causal connectives carry the story: then, by morning, three days later, because of this, which meant.
- Every sentence ends cleanly on a full stop. Every sentence is one self-contained idea (sentences become visual beats later).
- Facts stay accurate. If a detail is uncertain, write around it. Never invent names, dates, or numbers.
- Real-tragedy restraint: no gore, no suffering close-ups, no mockery of victims. Tension lives in objects, places, documents, and time.
- No sponsor copy, no subscribe prompts, no sign-offs.
- Mandatory cliffhanger ending: final line 12 words or fewer, ending on a noun, a name, a date, or a short declarative.
- Never use em dashes (—) anywhere. Use commas, colons, parentheses, or plain hyphens instead.
- Overlay per-sentence speaking emotion from the situation onto this Fern DNA (keep facts, cold open, and cliffhanger). Grief/loss → sad; reveal/shock → excited; report/facts → newscast; argument → angry; warmth → cheerful; comfort → empathetic; waiting/quiet → calm; otherwise default. Energy of the wording must match that beat. Do not name the emotion, and do not put stage directions, in the spoken words. Also return narrationLines: [{ "text", "emotion" }] one spoken sentence per item; narrationScript stays the concatenated prose.
- Voice direction note for TTS: ${DOCUMENTARY_VOICEOVER_DIRECTION}.`.trim();
}

export function formatDocumentaryCollageVisualRules(options: {
  sceneCount: number;
  videoDurationSec: number;
  clipDurationSec: number;
}): string {
  const { sceneCount, videoDurationSec, clipDurationSec } = options;
  return `DOCUMENTARY PAPER COLLAGE visuals (mandatory):
- Beat breakdown: aim for about 2-3 seconds of narration per scene (about 5-8 words at 2.5 wps). A short sentence is one beat. A long sentence splits at its natural comma or clause into two beats. Every beat carries one visual idea only.
- Return about ${sceneCount} scenes covering ~${Math.round(videoDurationSec)}s (prefer ~2-3s beats when practical; clip hint ~${Math.round(clipDurationSec)}s).
- imagePrompt structure for EVERY scene (one prose block, fully self-contained):
  1. SCENE: concrete composition for this beat. One hero element (about 70% visual weight), 2-3 supporting elements max, generous negative space. If the beat carries a date, name, or number, it may appear as ONE short label of 1-4 words on a paper strip or stamp. Otherwise no text. Visualize the IDEA (object, document, map, timeline fragment, halftone figure, place), never illustrate every word.
  2. STYLE BLOCK, include this verbatim: ${DOCUMENTARY_COLLAGE_STYLE_BLOCK}
  3. CLOSER, end every prompt with exactly: ${DOCUMENTARY_COLLAGE_CLOSER}
  4. NEGATIVES: also return negativePrompt (still-image avoid list) and append it at the end of imagePrompt as "${NEGATIVE_PROMPT_INLINE_PREFIX} …". Start from: ${DEFAULT_NARRATION_IMAGE_NEGATIVE_PROMPT}. Narration VO is external — forbid dialogue/talking characters on stills; focus on still-image artifacts (not motion/audio lists). Do NOT put image negatives into animationPrompt.
- animationPrompt: for EVERY scene, use EXACTLY this universal video prompt (verbatim, do not rewrite). It already includes scene-synced paper ASMR / ambience sound design and forbids dialogue/voices/narration on the video track (video negatives live here — do not duplicate image negatives):
${DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT}
- Do not invent camera moves that contradict the locked-camera universal prompt.
- Never use em dashes (—) in any prompt text.
- Real-tragedy restraint: no gore, no victim mockery.`.trim();
}

/**
 * Thumbnail DNA from engine STATE 9. Merges with channel thumbnailReferencePrompt when set.
 */
export function formatDocumentaryThumbnailInstructions(
  thumbnailReferencePrompt?: string | null,
): string {
  const dna = `DOCUMENTARY COLLAGE thumbnail DNA (mandatory):
- Same newsprint collage world as the video, but pushed louder: bigger type, hotter red, harder contrast, built to read at 200 pixels wide.
- Composition: one dominant halftone subject cutout (a figure with a black censor bar across the eyes where a real person is implied, an object, or a place), one or two torn-label text blocks in condensed all-caps carrying 1-3 words each (words chosen from the video's hook: EXPOSED, VANISHED, FOUND, the year, the amount), one red or yellow highlight device (rough marker circle, stamp box, or underline), aged newsprint base, torn edges bleeding off frame.
- Text in the image: maximum 2 text elements, maximum 3 words each, huge, condensed, all-caps.
- 16:9, ultra-detailed, high contrast, no small details that die at thumbnail size, no watermark, no logos.
- End the thumbnail prompt with exactly: ${DOCUMENTARY_COLLAGE_THUMBNAIL_CLOSER}
- Never use em dashes (—).
- Also return optional thumbnailPromptVariants: an array of 1-2 alternate thumbnail prompts following the same DNA (different hero or label).`;

  const ref = thumbnailReferencePrompt?.trim();
  if (ref) {
    return `${dna}

Additionally merge the channel thumbnail reference below: keep collage DNA (newsprint, halftone, censor bar when a person is implied, loud type) while matching any structure, layout habits, or recurring motifs from the reference.

Channel thumbnail reference:
${ref}

thumbnailPrompt: Write one detailed, ready-to-paste primary thumbnail image prompt for this video that satisfies BOTH the collage DNA and the channel reference.`;
  }

  return `${dna}

thumbnailPrompt: Write one detailed, ready-to-paste primary thumbnail image prompt for this video following the collage DNA above.`;
}

/** Ensure an image prompt includes the verbatim style block and closer. */
export function ensureDocumentaryCollageImagePrompt(prompt: string): string {
  let result = (prompt ?? '').trim();
  if (!result) {
    return `Editorial documentary paper collage scene with one clear hero object on aged newsprint. ${DOCUMENTARY_COLLAGE_STYLE_BLOCK} ${DOCUMENTARY_COLLAGE_CLOSER}`;
  }
  if (!result.includes(DOCUMENTARY_COLLAGE_STYLE_BLOCK)) {
    result = `${result} ${DOCUMENTARY_COLLAGE_STYLE_BLOCK}`;
  }
  if (!result.includes(DOCUMENTARY_COLLAGE_CLOSER)) {
    result = `${result} ${DOCUMENTARY_COLLAGE_CLOSER}`;
  }
  return result.replace(/\u2014/g, '-');
}

/** Force the locked universal video prompt onto each scene. */
export function ensureDocumentaryUniversalVideoPrompt(_prompt?: string): string {
  return DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT;
}

export function ensureDocumentaryThumbnailPrompt(prompt: string): string {
  let result = (prompt ?? '').trim();
  if (!result) {
    result = `Loud editorial documentary paper collage thumbnail: one dominant halftone subject with a black censor bar across the eyes if a person is implied, two torn all-caps labels of at most three words, hot red accent, aged newsprint, high contrast for small-size readability.`;
  }
  if (!result.includes(DOCUMENTARY_COLLAGE_THUMBNAIL_CLOSER) && !result.includes(DOCUMENTARY_COLLAGE_CLOSER)) {
    result = `${result} ${DOCUMENTARY_COLLAGE_THUMBNAIL_CLOSER}`;
  }
  return result.replace(/\u2014/g, '-');
}

/** Append / replace the universal video prompt section inside editingInstructions. */
export function withUniversalVideoPromptInEditing(
  editingInstructions: string,
  universalVideoPrompt: string = DOCUMENTARY_UNIVERSAL_VIDEO_PROMPT,
): string {
  const {
    editingInstructions: base,
    thumbnailNegativePrompt,
    thumbnailPromptVariants,
    narrationLines,
  } = splitProductionBriefEditingExtras(editingInstructions);
  return joinProductionBriefEditingExtras({
    editingInstructions: base,
    universalVideoPrompt,
    thumbnailPromptVariants,
    thumbnailNegativePrompt,
    narrationLines,
  });
}

export function splitProductionBriefEditingExtras(editingInstructions: string): {
  editingInstructions: string;
  universalVideoPrompt: string;
  thumbnailPromptVariants: string;
  thumbnailNegativePrompt: string;
  narrationLines: string;
} {
  let rest = editingInstructions ?? '';
  let thumbnailNegativePrompt = '';
  let thumbnailPromptVariants = '';
  let universalVideoPrompt = '';
  let narrationLines = '';

  const takeMarker = (markerTitle: string): string => {
    const withBreak = `\n\n${markerTitle}\n`;
    const atStart = `${markerTitle}\n`;
    const idx = rest.lastIndexOf(withBreak);
    if (idx >= 0) {
      const value = rest.slice(idx + withBreak.length).trim();
      rest = rest.slice(0, idx).trimEnd();
      return value;
    }
    if (rest.startsWith(atStart)) {
      const value = rest.slice(atStart.length).trim();
      rest = '';
      return value;
    }
    return '';
  };

  // Peel from the end so join order stays stable.
  narrationLines = takeMarker(NARRATION_LINES_MARKER);
  thumbnailNegativePrompt = takeMarker(THUMBNAIL_NEGATIVE_MARKER);
  thumbnailPromptVariants = takeMarker(THUMBNAIL_VARIANTS_MARKER);
  universalVideoPrompt = takeMarker(UNIVERSAL_VIDEO_PROMPT_MARKER);

  return {
    editingInstructions: rest,
    universalVideoPrompt,
    thumbnailPromptVariants,
    thumbnailNegativePrompt,
    narrationLines,
  };
}

export function joinProductionBriefEditingExtras(parts: {
  editingInstructions?: string;
  universalVideoPrompt?: string;
  thumbnailPromptVariants?: string;
  thumbnailNegativePrompt?: string;
  narrationLines?: string;
}): string {
  const chunks: string[] = [];
  const base = (parts.editingInstructions ?? '').trim();
  if (base) chunks.push(base);
  const uni = (parts.universalVideoPrompt ?? '').trim();
  if (uni) chunks.push(`${UNIVERSAL_VIDEO_PROMPT_MARKER}\n${uni}`);
  const variants = (parts.thumbnailPromptVariants ?? '').trim();
  if (variants) chunks.push(`${THUMBNAIL_VARIANTS_MARKER}\n${variants}`);
  const neg = (parts.thumbnailNegativePrompt ?? '').trim();
  if (neg) chunks.push(`${THUMBNAIL_NEGATIVE_MARKER}\n${neg}`);
  const lines = (parts.narrationLines ?? '').trim();
  if (lines) chunks.push(`${NARRATION_LINES_MARKER}\n${lines}`);
  return chunks.join('\n\n');
}
