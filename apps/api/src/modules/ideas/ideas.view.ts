import type { Idea, ProductionBrief } from '@scp/db';
import {
  PACKAGE_STAGE_LABELS,
  parseSpokenNarrationLines,
  parseTtsEmotion,
  splitProductionBriefEditingExtras,
  type PackageStage,
} from '@scp/shared';

/**
 * Defensive: older rows stored the model's raw (often ```json-fenced, sometimes
 * truncated) response as the title. Recover a plain-text title so those rows
 * still render readably.
 */
export function displayIdeaTitle(raw: string): string {
  const clean = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const trimmed = clean(raw ?? '');
  if (!trimmed) return 'Untitled Idea';
  if (!/^(```|[[{])/.test(trimmed)) return trimmed;

  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\r?\n([\s\S]*?)(?:\r?\n?```)?\s*$/);
  const body = (fenced?.[1] ?? trimmed).trim();

  try {
    const parsed = JSON.parse(body) as unknown;
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const title = (first as { title?: unknown } | null)?.title;
    if (typeof title === 'string' && clean(title)) return clean(title);
  } catch {
    /* truncated JSON — fall back to a field scan */
  }

  // Truncated blobs never parse, but the first "title" field is usually intact.
  const match = body.match(/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match?.[1]) {
    const recovered = clean(match[1].replace(/\\"/g, '"').replace(/\\n/g, ' '));
    if (recovered) return recovered;
  }
  return 'Untitled Idea';
}

/** Public view of an idea (docs/03 Domain 5 + AI owner package flow). */
export interface IdeaView {
  id: string;
  accountId: string;
  sourceCompetitorVideoIds: string[];
  title: string;
  angle: string;
  hook: string;
  rationale: string;
  topicSummary: string;
  category: Idea['category'];
  viralScore: number | null;
  status: Idea['status'];
  packageStatus: Idea['packageStatus'];
  packageStage: ProductionBrief['packageStage'] | null;
  packageStageError: string | null;
  packageStageLabel: string | null;
  requestedVideoDurationSec: number | null;
  requestedClipDurationSec: number | null;
  rejectionReason: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  hasBrief: boolean;
  hasFinalVideo: boolean;
  hasThumbnail: boolean;
  /** Content item the owner's final video + thumbnail attach to, once created. */
  contentItemId: string | null;
  /** Status of that content item, so the UI can tag scheduled/published packages. */
  contentStatus: string | null;
  /** Earliest pending slot across the content item's publish targets. */
  scheduledAt: string | null;
  /** Most recent successful publish across the content item's publish targets. */
  publishedAt: string | null;
  voiceoverStatus: ProductionBrief['voiceoverStatus'] | null;
  voiceoverReady: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Public view of a creative package / production brief. */
export interface ProductionBriefView {
  id: string;
  ideaId: string;
  researchSummary: string;
  storySummary: string;
  script: string;
  narrationScript: string;
  /** English summary of non-English voiceover (empty when output language is English). */
  englishSummary: string;
  presentationMode: string;
  sceneBreakdown: unknown[];
  characterPrompts: unknown[];
  editingInstructions: string;
  targetDurationSec: number | null;
  videoTitle: string;
  videoDescription: string;
  thumbnailPrompt: string;
  thumbnailNegativePrompt: string;
  universalVideoPrompt: string;
  thumbnailPromptVariants: string;
  voiceoverStatus: ProductionBrief['voiceoverStatus'];
  voiceoverReady: boolean;
  packageStage: ProductionBrief['packageStage'];
  packageStageError: string | null;
  packageStageLabel: string;
  timedTranscript: Array<{ startMs: number; endMs: number; text: string }>;
  narrationLines: Array<{ text: string; emotion: string }>;
  transcriptReady: boolean;
  voiceIdUsed: string | null;
  version: number;
  createdAt: string;
}

const PENDING_TARGET_STATUSES = new Set(['PENDING', 'SCHEDULED', 'PUBLISHING']);

type IdeaWithExtras = Idea & {
  brief?: {
    id: string;
    voiceoverStatus?: ProductionBrief['voiceoverStatus'];
    voiceoverLocalPath?: string | null;
    packageStage?: ProductionBrief['packageStage'];
    packageStageError?: string | null;
  } | null;
  contentItems?: Array<{
    id?: string;
    status?: string;
    assets?: Array<{ kind: string; localPath: string | null; driveFileId?: string | null }>;
    publishTargets?: Array<{
      status?: string;
      scheduledAt?: Date | null;
      publishedAt?: Date | null;
    }>;
  }>;
};

function ideaAssetPresent(a: { kind: string; localPath: string | null; driveFileId?: string | null }): boolean {
  return Boolean(a.localPath || a.driveFileId);
}

export function toIdeaView(idea: IdeaWithExtras): IdeaView {
  const items = idea.contentItems ?? [];
  const assets = items.flatMap((c) => c.assets ?? []);
  const hasFinalVideo = assets.some((a) => a.kind === 'FINAL' && ideaAssetPresent(a));
  const hasThumbnail = assets.some((a) => a.kind === 'THUMBNAIL' && ideaAssetPresent(a));
  const contentItem =
    items.find((c) => (c.assets ?? []).some((a) => a.kind === 'FINAL' && ideaAssetPresent(a))) ??
    items[0] ??
    null;
  const contentItemId = contentItem?.id ?? null;
  const targets = contentItem?.publishTargets ?? [];
  // Earliest upcoming slot reads as "the" schedule; latest publish reads as "it went out".
  // Cancelled (DRAFT) and FAILED targets keep their old slot, so they are not a schedule.
  const scheduledAt = targets
    .filter((t) => PENDING_TARGET_STATUSES.has(t.status ?? '') && t.scheduledAt)
    .map((t) => t.scheduledAt as Date)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const publishedAt = targets
    .filter((t) => t.publishedAt)
    .map((t) => t.publishedAt as Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const voStatus = idea.brief?.voiceoverStatus ?? null;
  const voReady = voStatus === 'READY' && !!idea.brief?.voiceoverLocalPath;
  const stage = (idea.brief?.packageStage ?? null) as PackageStage | null;
  const stageError = idea.brief?.packageStageError ?? null;

  return {
    id: idea.id,
    accountId: idea.accountId,
    sourceCompetitorVideoIds: idea.sourceCompetitorVideoIds,
    title: displayIdeaTitle(idea.title),
    angle: idea.angle,
    hook: idea.hook,
    rationale: idea.rationale,
    topicSummary: idea.topicSummary ?? '',
    category: idea.category,
    viralScore: idea.viralScore ?? null,
    status: idea.status,
    packageStatus: idea.packageStatus,
    packageStage: stage,
    packageStageError: stageError,
    packageStageLabel: stage ? PACKAGE_STAGE_LABELS[stage] ?? stage : null,
    requestedVideoDurationSec: idea.requestedVideoDurationSec,
    requestedClipDurationSec: idea.requestedClipDurationSec,
    rejectionReason: idea.rejectionReason,
    decidedById: idea.decidedById,
    decidedAt: idea.decidedAt ? idea.decidedAt.toISOString() : null,
    hasBrief: !!idea.brief,
    hasFinalVideo,
    hasThumbnail,
    contentItemId,
    contentStatus: contentItem?.status ?? null,
    scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    voiceoverStatus: voStatus,
    voiceoverReady: voReady,
    createdAt: idea.createdAt.toISOString(),
    updatedAt: idea.updatedAt.toISOString(),
  };
}

export function toBriefView(brief: ProductionBrief, presentationMode = ''): ProductionBriefView {
  const {
    editingInstructions,
    thumbnailNegativePrompt,
    universalVideoPrompt,
    thumbnailPromptVariants,
    narrationLines: narrationLinesRaw,
  } = splitProductionBriefEditingExtras(brief.editingInstructions ?? '');
  const rawScenes = Array.isArray(brief.sceneBreakdown) ? brief.sceneBreakdown : [];
  const sceneBreakdown = rawScenes.map((entry, index) => {
    const scene = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const dialogue = Array.isArray(scene.dialogue)
      ? scene.dialogue
          .map((line) => {
            const row = (line && typeof line === 'object' ? line : {}) as Record<string, unknown>;
            return {
              speaker: String(row.speaker ?? row.character ?? '').trim(),
              line: String(row.line ?? row.text ?? '').trim(),
              emotion: parseTtsEmotion(row.emotion ?? row.mood ?? row.tone),
            };
          })
          .filter((line) => line.line)
      : typeof scene.dialogue === 'string' && scene.dialogue.trim()
        ? scene.dialogue
            .split(/\r?\n/)
            .map((line) => {
              const match = line.match(/^\s*([^:]{1,60}):\s*(.+)$/);
              return match
                ? {
                    speaker: (match[1] ?? '').trim(),
                    line: (match[2] ?? '').trim(),
                    emotion: parseTtsEmotion(undefined),
                  }
                : { speaker: '', line: line.trim(), emotion: parseTtsEmotion(undefined) };
            })
            .filter((line) => line.line)
        : [];
    return {
      sceneIndex:
        typeof scene.sceneIndex === 'number' && Number.isFinite(scene.sceneIndex)
          ? scene.sceneIndex
          : index + 1,
      durationSec: typeof scene.durationSec === 'number' ? scene.durationSec : null,
      startMs: typeof scene.startMs === 'number' ? scene.startMs : null,
      endMs: typeof scene.endMs === 'number' ? scene.endMs : null,
      narrationSegment: String(scene.narrationSegment ?? '').trim(),
      imagePrompt: String(scene.imagePrompt ?? scene.image ?? '').trim(),
      animationPrompt: String(scene.animationPrompt ?? scene.videoPrompt ?? '').trim(),
      negativePrompt: String(scene.negativePrompt ?? scene.negative ?? '').trim(),
      animationNegativePrompt: String(
        scene.animationNegativePrompt ??
          scene.videoNegativePrompt ??
          scene.animationNegative ??
          '',
      ).trim(),
      dialogue,
    };
  });
  const rawCharacters = Array.isArray(brief.characterPrompts) ? brief.characterPrompts : [];
  const characterPrompts = rawCharacters.map((entry, index) => {
    if (typeof entry === 'string') {
      return {
        name: `Character ${index + 1}`,
        appearance: entry.trim(),
        wardrobe: '',
        age: '',
        personality: '',
        consistencyDetails: entry.trim(),
      };
    }
    const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    return {
      name: String(row.name ?? row.characterName ?? `Character ${index + 1}`).trim(),
      appearance: String(row.appearance ?? row.visualDescription ?? row.description ?? '').trim(),
      wardrobe: String(row.wardrobe ?? row.clothing ?? '').trim(),
      age: String(row.age ?? row.ageRange ?? '').trim(),
      personality: String(row.personality ?? '').trim(),
      consistencyDetails: String(
        row.consistencyDetails ?? row.consistency ?? row.generationPrompt ?? row.prompt ?? '',
      ).trim(),
    };
  });
  const narrationScript = brief.voiceoverStatus === 'NONE' ? '' : brief.script;
  const timedTranscript = Array.isArray(brief.timedTranscript)
    ? brief.timedTranscript
        .map((entry) => {
          const row = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
          return {
            startMs: typeof row.startMs === 'number' ? row.startMs : Number(row.startMs) || 0,
            endMs: typeof row.endMs === 'number' ? row.endMs : Number(row.endMs) || 0,
            text: String(row.text ?? '').trim(),
          };
        })
        .filter((s) => s.text)
    : [];
  const narrationLines = (() => {
    const fromExtras = parseSpokenNarrationLines(narrationLinesRaw);
    if (fromExtras.length > 0) return fromExtras;
    return parseSpokenNarrationLines(brief.timedTranscript);
  })();
  const stage = brief.packageStage as PackageStage;
  return {
    id: brief.id,
    ideaId: brief.ideaId,
    researchSummary: brief.researchSummary,
    storySummary: brief.researchSummary,
    script: brief.script,
    narrationScript,
    englishSummary: brief.englishSummary?.trim() || '',
    presentationMode,
    sceneBreakdown,
    characterPrompts,
    editingInstructions,
    targetDurationSec: brief.targetDurationSec,
    videoTitle: brief.videoTitle,
    videoDescription: brief.videoDescription,
    thumbnailPrompt: brief.thumbnailPrompt,
    thumbnailNegativePrompt,
    universalVideoPrompt,
    thumbnailPromptVariants,
    voiceoverStatus: brief.voiceoverStatus,
    voiceoverReady: brief.voiceoverStatus === 'READY' && !!brief.voiceoverLocalPath,
    packageStage: brief.packageStage,
    packageStageError: brief.packageStageError ?? null,
    packageStageLabel: PACKAGE_STAGE_LABELS[stage] ?? stage,
    timedTranscript,
    narrationLines,
    transcriptReady: timedTranscript.length > 0,
    voiceIdUsed: brief.voiceIdUsed ?? null,
    version: brief.version,
    createdAt: brief.createdAt.toISOString(),
  };
}
