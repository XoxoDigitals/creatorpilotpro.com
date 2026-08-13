import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { stat } from 'node:fs/promises';
import type { ContentItemStatus, Prisma } from '@scp/db';
import { withPublishReviewApproved } from '@scp/shared';
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

  async listReview(accountId?: string): Promise<ReviewItemView[]> {
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
   * & normalized) and falls back to ORIGINAL. Returns either a local path to
   * stream or a Drive embed URL when the asset lives only in Drive.
   */
  async getPlayableAsset(id: string): Promise<{
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
    const asset =
      item.assets.find((a) => a.kind === 'FINAL' && (a.localPath || a.driveFileId)) ??
      item.assets.find((a) => a.kind === 'ORIGINAL' && (a.localPath || a.driveFileId));
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

    // Auto-enqueue AI/TTS pipelines on state transitions
    if (to === 'APPROVED') {
      await this.queue.enqueueAi(id, 'analyze');
    } else if (to === 'SCRIPT_APPROVED') {
      await this.queue.enqueueTts(id);
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
