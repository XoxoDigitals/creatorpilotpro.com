import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import type { ContentItemStatus, Prisma } from '@scp/db';
import { withPublishReviewApproved, normalizeCaptionTemplateId, normalizeOverlayPosition, normalizeCaptionColorMode } from '@scp/shared';
import { drivePreviewEmbedUrl } from '@scp/storage';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { AiService } from '../ai/ai.service';
import { assertTransition, canTransition } from './content-state';
import {
  toAiPipelineItemView,
  toContentItemView,
  toReviewItemView,
  type AiPipelineItemView,
  type ContentItemView,
  type ReviewItemView,
} from './content.view';
import type { CreateContentDto } from './dto/content.dto';

const pipelineItemInclude = {
  assets: {
    where: { kind: { in: ['FINAL', 'ORIGINAL', 'THUMBNAIL'] } },
    select: { kind: true, localPath: true, driveFileId: true },
  },
  publishTargets: {
    select: { accountId: true, account: { select: { platform: true } } },
  },
  idea: { select: { accountId: true, account: { select: { platform: true } } } },
  sourceVideo: {
    select: {
      watchedSource: {
        select: {
          targetAccountId: true,
          targetAccount: { select: { platform: true } },
        },
      },
    },
  },
} as const satisfies Prisma.ContentItemInclude;

/** Stored narration option on `currentStep.scriptVariants` (worker + API). */
type ScriptVariantRow = Record<string, unknown> & {
  id?: unknown;
  script?: unknown;
  englishSummary?: string;
};

function variantRows(raw: unknown): ScriptVariantRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ScriptVariantRow => !!r && typeof r === 'object' && !Array.isArray(r),
  );
}

/** Keep `script` in sync with the selected narration option (and optional edit). */
function applySelectedScript(
  step: Record<string, unknown>,
  opts: { selectedScriptId?: string; script?: string; englishSummary?: string | null },
): void {
  const variants = variantRows(step.scriptVariants);
  let selectedId =
    opts.selectedScriptId?.trim() ||
    (typeof step.selectedScriptId === 'string' ? step.selectedScriptId : '') ||
    '';
  if (opts.selectedScriptId?.trim() && variants.length > 0) {
    const found = variants.find((v) => v.id === opts.selectedScriptId);
    if (!found) throw new BadRequestException('Unknown narration option.');
    selectedId = opts.selectedScriptId.trim();
  }
  if (selectedId) step.selectedScriptId = selectedId;
  if (opts.script != null) {
    const script = opts.script.trim();
    step.script = script;
    const englishSummary =
      opts.englishSummary === undefined
        ? undefined
        : (opts.englishSummary ?? '').trim();
    if (englishSummary !== undefined) {
      step.englishSummary = englishSummary;
    }
    if (variants.length > 0 && selectedId) {
      step.scriptVariants = variants.map((v) => {
        if (v.id !== selectedId) return v;
        const next: ScriptVariantRow = { ...v, script };
        if (englishSummary !== undefined) {
          if (englishSummary) next.englishSummary = englishSummary;
          else delete next.englishSummary;
        }
        return next;
      });
    }
  } else if (selectedId && variants.length > 0) {
    const found = variants.find((v) => v.id === selectedId);
    const script = typeof found?.script === 'string' ? found.script.trim() : '';
    if (script) step.script = script;
    const summary =
      typeof found?.englishSummary === 'string' ? found.englishSummary.trim() : '';
    step.englishSummary = summary;
  }
}

function hookTextRows(raw: unknown): Array<Record<string, unknown> & { id?: unknown; text?: unknown }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is Record<string, unknown> & { id?: unknown; text?: unknown } =>
      !!r && typeof r === 'object' && !Array.isArray(r),
  );
}

/** Keep `selectedHookText` in sync with the picked short on-screen phrase. */
function applySelectedHookText(
  step: Record<string, unknown>,
  opts: { selectedHookTextId?: string },
): void {
  const id = opts.selectedHookTextId?.trim();
  if (!id) return;
  const variants = hookTextRows(step.hookTextVariants);
  const found = variants.find((v) => v.id === id);
  if (!found) throw new BadRequestException('Unknown hook text option.');
  const text = typeof found.text === 'string' ? found.text.trim() : '';
  if (!text) throw new BadRequestException('Hook text option is empty.');
  step.selectedHookTextId = id;
  step.selectedHookText = text;
}

function applySelectedCaptionTemplate(
  step: Record<string, unknown>,
  opts: { selectedCaptionTemplateId?: string },
): void {
  const id = opts.selectedCaptionTemplateId?.trim();
  if (!id) return;
  step.selectedCaptionTemplateId = normalizeCaptionTemplateId(id);
}

function applySelectedCaptionPosition(
  step: Record<string, unknown>,
  opts: { selectedCaptionPosition?: string },
): void {
  const raw = opts.selectedCaptionPosition?.trim();
  if (!raw) return;
  step.selectedCaptionPosition = normalizeOverlayPosition(raw, 'center');
}

function applySelectedCaptionColorMode(
  step: Record<string, unknown>,
  opts: { selectedCaptionColorMode?: string },
): void {
  const raw = opts.selectedCaptionColorMode?.trim();
  if (!raw) return;
  step.selectedCaptionColorMode = normalizeCaptionColorMode(raw);
}

function applySelectedHookPosition(
  step: Record<string, unknown>,
  opts: { selectedHookPosition?: string },
): void {
  const raw = opts.selectedHookPosition?.trim();
  if (!raw) return;
  step.selectedHookPosition = normalizeOverlayPosition(raw, 'top');
}

@Injectable()
export class ContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
    private readonly ai: AiService,
  ) {}

  async create(dto: CreateContentDto): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.create({
      data: { title: dto.title, type: dto.type, status: 'REVIEW_PENDING' },
      include: { assets: true },
    });
    return toContentItemView(item);
  }

  async list(status?: ContentItemStatus): Promise<ContentItemView[]> {
    const items = await this.prisma.client.contentItem.findMany({
      where: { deletedAt: null, ...(status ? { status } : {}) },
      include: { assets: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return items.map(toContentItemView);
  }

  async get(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      include: { assets: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    return toContentItemView(item);
  }

  async listReview(
    accountId?: string,
    opts?: { excludeScheduled?: boolean },
  ): Promise<ReviewItemView[]> {
    const where: Prisma.ContentItemWhereInput = {
      deletedAt: null,
      status: 'REVIEW_PENDING',
      // An item belongs to an account either through an existing publish target
      // (scheduled/produced work), its linked idea, or, for freshly ingested videos,
      // through its source's watched-source target account.
      ...(accountId
        ? {
            OR: [
              { publishTargets: { some: { accountId } } },
              { idea: { accountId } },
              { sourceVideo: { watchedSource: { targetAccountId: accountId } } },
            ],
          }
        : {}),
      // Schedule-approval packages (held publish slot) belong on the global Review
      // Queue only — account Review is for pre-pipeline rights/content gates.
      ...(opts?.excludeScheduled
        ? {
            NOT: {
              publishTargets: { some: { scheduledAt: { not: null } } },
            },
          }
        : {}),
    };
    const items = await this.prisma.client.contentItem.findMany({
      where,
      include: {
        assets: true,
        publishTargets: {
          select: {
            accountId: true,
            scheduledAt: true,
            metadataOverride: true,
          },
        },
        idea: { select: { accountId: true, brief: { select: { videoDescription: true } } } },
        sourceVideo: {
          select: {
            id: true,
            sourceUrl: true,
            rightsNote: true,
            watchedSource: { select: { targetAccountId: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return items.map(toReviewItemView);
  }

  /**
   * AI-pipeline queue for an account. Statuses covered are everything between
   * Review approval and Publish — the second (script-approval) human gate lives
   * on `SCRIPT_READY` in this list.
   */
  async listAiPipeline(accountId?: string): Promise<AiPipelineItemView[]> {
    const aiStatuses: ContentItemStatus[] = [
      'APPROVED',
      'ANALYZING',
      'SCRIPT_READY',
      'SCRIPT_APPROVED',
      'TTS_DONE',
      'RENDERED',
      'METADATA_READY',
      'FAILED',
    ];
    const items = await this.prisma.client.contentItem.findMany({
      where: {
        deletedAt: null,
        status: { in: aiStatuses },
        ...(accountId
          ? {
              OR: [
                { publishTargets: { some: { accountId } } },
                { sourceVideo: { watchedSource: { targetAccountId: accountId } } },
                { idea: { accountId } },
              ],
            }
          : {}),
      },
      include: {
        assets: {
          where: { kind: { in: ['FINAL', 'ORIGINAL', 'THUMBNAIL'] } },
          select: { kind: true, localPath: true, driveFileId: true },
        },
        publishTargets: {
          select: { accountId: true, account: { select: { platform: true } } },
        },
        idea: { select: { accountId: true, account: { select: { platform: true } } } },
        sourceVideo: {
          select: {
            watchedSource: {
              select: {
                targetAccountId: true,
                targetAccount: { select: { platform: true } },
              },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return items.map(toAiPipelineItemView);
  }

  async approve(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        assets: {
          where: { kind: { in: ['FINAL', 'ORIGINAL'] } },
          select: { kind: true, localPath: true, driveFileId: true },
        },
        publishTargets: {
          where: { status: { in: ['PENDING', 'SCHEDULED'] } },
          select: { id: true, status: true, scheduledAt: true, scheduleMode: true },
        },
      },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    assertTransition(item.status, 'APPROVED');

    const hasPlayable = item.assets.some((a) => !!a.localPath);
    const pendingTargets = item.publishTargets.filter((t) => t.status === 'PENDING');
    // Finished owner uploads always release publish. Any item with held PENDING
    // targets is in the publish Review pass (createTargets blocks scheduling
    // ingested REPURPOSED videos until the AI pipeline has run).
    const finishedUpload =
      hasPlayable &&
      (item.type === 'MANUAL_UPLOAD' ||
        item.type === 'WORKER_PRODUCED' ||
        item.type === 'DRAMA_EPISODE' ||
        pendingTargets.length > 0);

    if (finishedUpload) {
      let status: ContentItemStatus = 'APPROVED';
      if (item.publishTargets.length > 0 && canTransition('APPROVED', 'SCHEDULED')) {
        status = 'SCHEDULED';
      }
      const updated = await this.prisma.client.contentItem.update({
        where: { id },
        data: {
          status,
          statusReason: null,
          currentStep: withPublishReviewApproved(item.currentStep) as Prisma.InputJsonValue,
        },
        include: { assets: true },
      });

      // Release held publish targets and dispatch any that are already due.
      await this.prisma.client.publishTarget.updateMany({
        where: { contentItemId: id, status: 'PENDING' },
        data: { status: 'SCHEDULED' },
      });
      const now = Date.now();
      const toDispatch = await this.prisma.client.publishTarget.findMany({
        where: {
          contentItemId: id,
          status: 'SCHEDULED',
          OR: [{ scheduleMode: 'NOW' }, { scheduledAt: { lte: new Date(now) } }],
        },
        select: { id: true },
      });
      for (const t of toDispatch) await this.queue.enqueuePublish(t.id);

      return toContentItemView(updated);
    }

    return this.transition(id, 'APPROVED');
  }

  /**
   * Retry a FAILED AI-pipeline item at the step that failed, preserving any
   * successful prior AI outputs so they hit the AI cache instead of being
   * regenerated (docs/05 §5 — cache lookup precedes provider calls).
   *
   *  • analyze failed  (no `currentStep.analysis`)   → status APPROVED  + enqueue analyze
   *  • narration failed (analysis but no script)     → status ANALYZING + enqueue narration
   *  • metadata failed  (script but no metadata)     → status RENDERED  + enqueue metadata
   *
   * The state-machine transitions are all recorded in `content-state.ts`. The
   * AI worker's `runAi` reads `currentStep`, so re-enqueuing a step whose
   * output is already present costs zero credits (cache hits + chains forward).
   */
  async retryAiPipeline(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, currentStep: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const step = (item.currentStep ?? {}) as Record<string, unknown>;

    let toStatus: ContentItemStatus;
    let jobKind: 'analyze' | 'narration' | 'metadata';
    if (step.analysis == null) {
      toStatus = 'APPROVED';
      jobKind = 'analyze';
    } else if (step.script == null) {
      toStatus = 'ANALYZING';
      jobKind = 'narration';
    } else {
      toStatus = 'RENDERED';
      jobKind = 'metadata';
    }

    assertTransition(item.status, toStatus);
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: { status: toStatus, statusReason: null },
      include: { assets: true },
    });
    await this.queue.enqueueAi(id, jobKind);
    return toContentItemView(updated);
  }

  /**
   * Re-run metadata generation for an item that already has a final render.
   * Clears stored AI metadata so the worker produces a fresh platform-aware
   * title/description/tags (cache key also includes platform + prompt rev).
   */
  async regenerateMetadata(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, currentStep: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    assertTransition(item.status, 'RENDERED');
    const step = { ...((item.currentStep ?? {}) as Record<string, unknown>) };
    delete step.metadata;
    // Bump nonce so the AI cache key changes even when script/analysis are unchanged.
    step.metadataNonce = Date.now();
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: {
        status: 'RENDERED',
        statusReason: null,
        currentStep: step as Prisma.InputJsonValue,
      },
      include: { assets: true },
    });
    await this.queue.enqueueAi(id, 'metadata');
    return toContentItemView(updated);
  }

  /**
   * Re-run narration from existing analysis (cache-busted). Keeps the video
   * analysis; clears the previous script so TTS/render will follow the new copy.
   */
  async regenerateScript(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, currentStep: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const step = { ...((item.currentStep ?? {}) as Record<string, unknown>) };
    if (step.analysis == null) {
      throw new BadRequestException(
        'No video analysis yet — approve the item so Analyze can run before regenerating the script.',
      );
    }
    assertTransition(item.status, 'ANALYZING');
    delete step.script;
    delete step.narration;
    delete step.scriptVariants;
    delete step.selectedScriptId;
    delete step.hookTextVariants;
    delete step.selectedHookTextId;
    delete step.selectedHookText;
    delete step.selectedCaptionTemplateId;
    delete step.selectedCaptionPosition;
    delete step.selectedCaptionColorMode;
    delete step.selectedHookPosition;
    step.scriptNonce = Date.now();
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: {
        status: 'ANALYZING',
        statusReason: null,
        currentStep: step as Prisma.InputJsonValue,
      },
      include: { assets: true },
    });
    await this.queue.enqueueAi(id, 'narration');
    return toContentItemView(updated);
  }

  /**
   * Re-synthesize voiceover from the current script, then re-render.
   */
  async regenerateVoiceover(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { status: true, currentStep: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const step = (item.currentStep ?? {}) as Record<string, unknown>;
    if (step.script == null || (typeof step.script === 'string' && !step.script.trim())) {
      throw new BadRequestException('No script to synthesize — generate or approve a script first.');
    }
    return this.transition(id, 'SCRIPT_APPROVED');
  }

  /**
   * Re-mix the FINAL video from the existing VOICEOVER (skip TTS).
   * Optional per-video `backgroundBedPercent` is stored on currentStep.
   */
  async regenerateRender(
    id: string,
    dto: { backgroundBedPercent?: number } = {},
  ): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: {
        status: true,
        currentStep: true,
        assets: {
          where: { kind: 'VOICEOVER' },
          select: { id: true, localPath: true },
          take: 1,
        },
      },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const vo = item.assets[0];
    if (!vo?.localPath) {
      throw new BadRequestException(
        'No voiceover asset to re-render — regenerate voiceover first.',
      );
    }
    const allowed: ContentItemStatus[] = [
      'TTS_DONE',
      'RENDERED',
      'METADATA_READY',
      'FAILED',
    ];
    if (!allowed.includes(item.status)) {
      throw new BadRequestException(
        `Cannot re-render from status ${item.status}. Wait until voiceover is ready.`,
      );
    }
    if (dto.backgroundBedPercent != null) {
      const percent = Math.max(1, Math.min(100, Math.round(dto.backgroundBedPercent)));
      const step = { ...((item.currentStep ?? {}) as Record<string, unknown>) };
      step.backgroundBedPercent = percent;
      await this.prisma.client.contentItem.update({
        where: { id },
        data: { currentStep: step as Prisma.InputJsonValue },
      });
    }
    return this.transition(id, 'TTS_DONE');
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    if (item.status === 'PUBLISHING') {
      throw new BadRequestException('Cannot delete a video while it is publishing.');
    }
    await this.prisma.client.publishTarget.updateMany({
      where: {
        contentItemId: id,
        status: { in: ['PENDING', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'DRAFT'] },
      },
      data: {
        status: 'DRAFT',
        lastError: {
          message: 'Deleted from CreatorPilot',
          reason: 'user_deleted_system',
          detectedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    await this.prisma.client.contentItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id, deleted: true };
  }

  /**
   * Persist owner edits to AI publish metadata (title / description / tags)
   * on `currentStep.metadata` while the item is Metadata ready.
   */
  async updatePublishMetadata(
    id: string,
    dto: { title: string; description: string; tags: string[] },
  ): Promise<AiPipelineItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        assets: {
          where: { kind: { in: ['FINAL', 'ORIGINAL', 'THUMBNAIL'] } },
          select: { kind: true, localPath: true, driveFileId: true },
        },
        publishTargets: {
          select: { accountId: true, account: { select: { platform: true } } },
        },
        idea: { select: { accountId: true, account: { select: { platform: true } } } },
        sourceVideo: {
          select: {
            watchedSource: {
              select: {
                targetAccountId: true,
                targetAccount: { select: { platform: true } },
              },
            },
          },
        },
      },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    if (item.status !== 'METADATA_READY' && item.status !== 'RENDERED') {
      throw new BadRequestException(
        'Publish metadata can only be edited when the item is Rendered or Metadata ready.',
      );
    }
    const step = { ...((item.currentStep ?? {}) as Record<string, unknown>) };
    const prev =
      step.metadata && typeof step.metadata === 'object' && !Array.isArray(step.metadata)
        ? (step.metadata as Record<string, unknown>)
        : {};
    step.metadata = {
      ...prev,
      title: dto.title.trim(),
      description: dto.description,
      tags: dto.tags.map((t) => t.trim()).filter(Boolean),
    };
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: {
        currentStep: step as Prisma.InputJsonValue,
        ...(item.status === 'RENDERED' && dto.title.trim()
          ? { status: 'METADATA_READY' as ContentItemStatus }
          : {}),
      },
      include: {
        assets: {
          where: { kind: { in: ['FINAL', 'ORIGINAL', 'THUMBNAIL'] } },
          select: { kind: true, localPath: true, driveFileId: true },
        },
        publishTargets: {
          select: { accountId: true, account: { select: { platform: true } } },
        },
        idea: { select: { accountId: true, account: { select: { platform: true } } } },
        sourceVideo: {
          select: {
            watchedSource: {
              select: {
                targetAccountId: true,
                targetAccount: { select: { platform: true } },
              },
            },
          },
        },
      },
    });
    return toAiPipelineItemView(updated);
  }

  /**
   * Persist an owner/reviewer edit of the narration script on `currentStep.script`,
   * and/or switch the selected variant. Does not re-run TTS; after SCRIPT_READY
   * the reviewer still approves, or they click Regenerate voiceover later.
   */
  async updateScript(
    id: string,
    dto: {
      script?: string;
      selectedScriptId?: string;
      selectedHookTextId?: string;
      selectedCaptionTemplateId?: string;
      selectedCaptionPosition?: string;
      selectedCaptionColorMode?: string;
      selectedHookPosition?: string;
    },
  ): Promise<AiPipelineItemView> {
    const item = await this.findPipelineItem(id);
    this.assertScriptEditable(item.status);
    const step = { ...((item.currentStep ?? {}) as Record<string, unknown>) };

    if (dto.selectedCaptionTemplateId?.trim()) {
      applySelectedCaptionTemplate(step, {
        selectedCaptionTemplateId: dto.selectedCaptionTemplateId,
      });
    }

    if (dto.selectedCaptionPosition?.trim()) {
      applySelectedCaptionPosition(step, {
        selectedCaptionPosition: dto.selectedCaptionPosition,
      });
    }

    if (dto.selectedCaptionColorMode?.trim()) {
      applySelectedCaptionColorMode(step, {
        selectedCaptionColorMode: dto.selectedCaptionColorMode,
      });
    }

    if (dto.selectedHookPosition?.trim()) {
      applySelectedHookPosition(step, {
        selectedHookPosition: dto.selectedHookPosition,
      });
    }

    if (dto.selectedHookTextId?.trim()) {
      // Persist synthesized options for legacy items so selection sticks.
      if (!Array.isArray(step.hookTextVariants) || (step.hookTextVariants as unknown[]).length < 2) {
        const view = toAiPipelineItemView(item);
        step.hookTextVariants = view.hookTextVariants;
        if (!step.selectedHookTextId && view.selectedHookTextId) {
          step.selectedHookTextId = view.selectedHookTextId;
          step.selectedHookText = view.selectedHookText ?? '';
        }
      }
      applySelectedHookText(step, { selectedHookTextId: dto.selectedHookTextId });
    }

    let englishSummary: string | null | undefined = undefined;
    if (dto.script != null) {
      const language = await this.resolveAccountLanguage(item);
      try {
        englishSummary = await this.ai.summarizeNarrationInEnglish({
          script: dto.script,
          language,
        });
      } catch {
        englishSummary = '';
      }
    }

    if (dto.script != null || dto.selectedScriptId?.trim()) {
      applySelectedScript(step, {
        selectedScriptId: dto.selectedScriptId,
        script: dto.script,
        englishSummary,
      });
      if (typeof step.script !== 'string' || !step.script.trim()) {
        throw new BadRequestException('Narration script cannot be empty.');
      }
    }
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: { currentStep: step as Prisma.InputJsonValue },
      include: pipelineItemInclude,
    });
    return toAiPipelineItemView(updated);
  }

  /**
   * AI rewrite of the current (or provided draft) narration. Returns the new
   * script without persisting — the UI PATCHes `/script` on accept.
   */
  async rewriteScript(
    id: string,
    dto: { instruction: string; script?: string },
  ): Promise<{ script: string }> {
    const item = await this.findPipelineItem(id);
    this.assertScriptEditable(item.status);
    const step = (item.currentStep ?? {}) as Record<string, unknown>;
    const stored =
      typeof step.script === 'string'
        ? step.script
        : step.script != null
          ? JSON.stringify(step.script)
          : '';
    const current = (dto.script ?? stored).trim();
    if (!current) {
      throw new BadRequestException('No narration script to rewrite.');
    }
    const analysis =
      step.analysis == null
        ? null
        : typeof step.analysis === 'string'
          ? step.analysis
          : JSON.stringify(step.analysis);
    const language = await this.resolveAccountLanguage(item);
    const script = await this.ai.rewriteNarrationScript({
      script: current,
      instruction: dto.instruction.trim(),
      analysis,
      language,
    });
    return { script };
  }

  private assertScriptEditable(status: ContentItemStatus): void {
    const allowed: ContentItemStatus[] = ['SCRIPT_READY', 'SCRIPT_APPROVED', 'TTS_DONE', 'FAILED'];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        'The narration script can only be edited while Script ready, after approval, or after a failed later step.',
      );
    }
  }

  private async findPipelineItem(id: string) {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      include: pipelineItemInclude,
    });
    if (!item) throw new NotFoundException('Content item not found.');
    return item;
  }

  private async resolveAccountLanguage(item: {
    publishTargets?: { accountId: string }[];
    idea?: { accountId?: string } | null;
    sourceVideo?: { watchedSource?: { targetAccountId: string | null } | null } | null;
  }): Promise<string> {
    const accountId =
      item.publishTargets?.[0]?.accountId ??
      item.sourceVideo?.watchedSource?.targetAccountId ??
      item.idea?.accountId ??
      null;
    if (!accountId) return 'en';
    const profile = await this.prisma.client.channelProfile.findUnique({
      where: { accountId },
      select: { language: true },
    });
    return profile?.language?.trim() || 'en';
  }

  /**
   * Retry TTS after a FAILED voiceover step (Incident center / docs/05 §6).
   * Restores SCRIPT_APPROVED so the TTS worker accepts the job.
   */
  async retryTtsPipeline(id: string): Promise<ContentItemView> {
    return this.transition(id, 'SCRIPT_APPROVED');
  }

  /**
   * Reset an APPROVED-or-later item back to REVIEW_PENDING so the reviewer can
   * re-approve after fixing the underlying cause (missing API key, wrong video).
   * Clears `currentStep` and `statusReason` so the AI pipeline re-runs from scratch.
   */
  async resetToReview(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { status: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    assertTransition(item.status, 'REVIEW_PENDING');
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: { status: 'REVIEW_PENDING', statusReason: null, currentStep: {} },
      include: { assets: true },
    });
    return toContentItemView(updated);
  }

  /**
   * Look up the streamable video for a content item. Prefers FINAL (trimmed
   * & normalized) and falls back to ORIGINAL. Pass `prefer` to pin one kind
   * (AI pipeline original vs rendered previews). Returns either a local path
   * to stream or a Drive embed URL when the asset lives only in Drive.
   */
  async getPlayableAsset(
    id: string,
    prefer?: 'FINAL' | 'ORIGINAL',
  ): Promise<{
    path?: string;
    bytes?: number;
    mimeType: string;
    driveFileId?: string;
    embedUrl?: string;
  } | null> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      include: {
        assets: { where: { kind: { in: ['FINAL', 'ORIGINAL'] } } },
      },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const order: Array<'FINAL' | 'ORIGINAL'> =
      prefer === 'ORIGINAL' ? ['ORIGINAL'] : prefer === 'FINAL' ? ['FINAL'] : ['FINAL', 'ORIGINAL'];
    const asset = order
      .map((kind) =>
        item.assets.find((a) => a.kind === kind && (a.localPath || a.driveFileId)),
      )
      .find((a): a is NonNullable<typeof a> => !!a);
    if (!asset) return null;

    if (asset.localPath) {
      try {
        const s = await stat(asset.localPath);
        return { path: asset.localPath, bytes: s.size, mimeType: 'video/mp4' };
      } catch {
        // Fall through to Drive if local missing.
      }
    }
    if (asset.driveFileId) {
      return {
        mimeType: 'video/mp4',
        driveFileId: asset.driveFileId,
        embedUrl: drivePreviewEmbedUrl(asset.driveFileId),
      };
    }
    return null;
  }

  /** Stored thumbnail — local stream or Drive embed. */
  async getThumbnailAsset(
    id: string,
  ): Promise<{
    path?: string;
    bytes?: number;
    mimeType: string;
    driveFileId?: string;
    embedUrl?: string;
  } | null> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      include: { assets: { where: { kind: 'THUMBNAIL' }, orderBy: { createdAt: 'desc' } } },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const asset = item.assets.find((a) => a.localPath || a.driveFileId);
    if (!asset) return null;

    if (asset.localPath) {
      const ext = asset.localPath.split('.').pop()?.toLowerCase() ?? '';
      const mimeType =
        ext === 'png'
          ? 'image/png'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'gif'
              ? 'image/gif'
              : 'image/jpeg';
      try {
        const s = await stat(asset.localPath);
        return { path: asset.localPath, bytes: s.size, mimeType };
      } catch {
        // Fall through.
      }
    }
    if (asset.driveFileId) {
      return {
        mimeType: 'image/jpeg',
        driveFileId: asset.driveFileId,
        embedUrl: drivePreviewEmbedUrl(asset.driveFileId),
      };
    }
    return null;
  }

  /**
   * Translate the item's title to English on demand (used by the review UI when
   * the ingested title is in a non-Latin script). Persists so the translation is
   * one-shot per item.
   */
  async translateTitle(id: string): Promise<{ id: string; title: string; originalTitle: string }> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const original = item.title;
    const translated = await this.ai.translateToEnglish(original);
    if (translated === original) return { id: item.id, title: original, originalTitle: original };
    await this.prisma.client.contentItem.update({
      where: { id: item.id },
      data: { title: translated },
    });
    return { id: item.id, title: translated, originalTitle: original };
  }

  async approveScript(id: string): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { currentStep: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    const step = { ...((item.currentStep ?? {}) as Record<string, unknown>) };
    applySelectedScript(step, {});
    if (typeof step.script === 'string' && step.script.trim()) {
      await this.prisma.client.contentItem.update({
        where: { id },
        data: { currentStep: step as Prisma.InputJsonValue },
      });
    }
    return this.transition(id, 'SCRIPT_APPROVED');
  }

  async reject(id: string, reason?: string): Promise<ContentItemView> {
    const updated = await this.transition(id, 'REJECTED', reason);
    // Hold/cancel any outstanding publish slots so a rejected item never goes live.
    await this.prisma.client.publishTarget.updateMany({
      where: { contentItemId: id, status: { in: ['PENDING', 'SCHEDULED'] } },
      data: { status: 'DRAFT' },
    });
    return updated;
  }

  /** Apply a state-machine transition, rejecting illegal edges (docs/04 §4). */
  private async transition(
    id: string,
    to: ContentItemStatus,
    statusReason?: string,
  ): Promise<ContentItemView> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id, deletedAt: null },
      select: { status: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    assertTransition(item.status, to);
    const updated = await this.prisma.client.contentItem.update({
      where: { id },
      data: { status: to, statusReason: statusReason ?? null },
      include: { assets: true },
    });

    // Auto-enqueue AI/TTS/render pipelines on state transitions
    if (to === 'APPROVED') {
      await this.queue.enqueueAi(id, 'analyze');
    } else if (to === 'SCRIPT_APPROVED') {
      await this.queue.enqueueTts(id);
    } else if (to === 'TTS_DONE') {
      await this.queue.enqueueRender(id);
    }

    return toContentItemView(updated);
  }

  // ── A/B suggestions (Phase 7 #10) ────────────────────────────────────────

  async listSuggestions(contentItemId: string) {
    const rows = await this.prisma.client.postSuggestion.findMany({
      where: { contentItemId },
      orderBy: [{ kind: 'asc' }, { rank: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      contentItemId: r.contentItemId,
      kind: r.kind,
      content: r.content,
      rationale: r.rationale,
      chosen: r.chosen,
      rank: r.rank,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async generateSuggestions(contentItemId: string): Promise<{ enqueued: true }> {
    const item = await this.prisma.client.contentItem.findFirst({
      where: { id: contentItemId, deletedAt: null },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Content item not found.');
    await this.queue.enqueueAbSuggestions(contentItemId);
    return { enqueued: true };
  }

  async chooseSuggestion(suggestionId: string) {
    const s = await this.prisma.client.postSuggestion.findUnique({
      where: { id: suggestionId },
    });
    if (!s) throw new NotFoundException('Suggestion not found.');

    // Unmark other suggestions of the same kind for this content item.
    await this.prisma.client.postSuggestion.updateMany({
      where: { contentItemId: s.contentItemId, kind: s.kind, id: { not: s.id } },
      data: { chosen: false },
    });
    const chosen = await this.prisma.client.postSuggestion.update({
      where: { id: s.id },
      data: { chosen: true },
    });
    return { id: chosen.id, chosen: true };
  }
}
