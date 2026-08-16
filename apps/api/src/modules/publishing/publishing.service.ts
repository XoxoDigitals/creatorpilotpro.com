import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Platform } from '@scp/db';
import {
  FacebookAdapter,
  TikTokAdapter,
  YouTubeAdapter,
  type PlatformConstraints,
} from '@scp/publish-adapters';
import {
  hasPublishReadyAiMetadata,
  isPublishReviewApproved,
} from '@scp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { SlotPlannerService } from '../scheduling/slot-planner.service';
import { canTransition } from '../content/content-state';
import {
  parseStepMetadata,
  toPublishTargetView,
  type PublishTargetView,
} from './publish-target.view';
import type { CreatePublishDto, PatchTargetDto } from './dto/publish.dto';

function constraintsFor(platform: Platform): PlatformConstraints {
  switch (platform) {
    case 'YOUTUBE':
      return new YouTubeAdapter().getConstraints();
    case 'FACEBOOK':
      return new FacebookAdapter().getConstraints();
    case 'TIKTOK':
      return new TikTokAdapter().getConstraints();
  }
}

/** Include shape needed by `toPublishTargetView` (copy + media flags + views). */
const TARGET_INCLUDE = {
  account: { select: { platform: true } },
  contentItem: {
    select: {
      title: true,
      currentStep: true,
      assets: { select: { kind: true, localPath: true, driveFileId: true } },
    },
  },
  metricSnapshots: {
    orderBy: { date: 'desc' as const },
    take: 1,
    select: { views: true },
  },
} as const;

@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: SlotPlannerService,
    private readonly queue: QueueProducer,
  ) {}

  /** Fail-fast metadata guard (docs/06 §1). Full media validation runs in the worker. */
  private guardMetadata(platform: Platform, override: Record<string, unknown>): void {
    const c = constraintsFor(platform);
    const title = typeof override.title === 'string' ? override.title : '';
    if (title.length > c.maxTitleLength) {
      throw new BadRequestException(
        `Title exceeds ${platform} limit of ${c.maxTitleLength} characters.`,
      );
    }
    if (Array.isArray(override.tags) && override.tags.length > c.maxTags) {
      throw new BadRequestException(`Too many tags for ${platform} (max ${c.maxTags}).`);
    }
  }

  async createTargets(dto: CreatePublishDto): Promise<PublishTargetView[]> {
    const content = await this.prisma.client.contentItem.findFirst({
      where: { id: dto.contentItemId, deletedAt: null },
      select: {
        id: true,
        status: true,
        type: true,
        title: true,
        ideaId: true,
        currentStep: true,
        idea: { select: { brief: { select: { videoTitle: true, videoDescription: true } } } },
      },
    });
    if (!content) throw new NotFoundException('Content item not found.');

    if (content.status === 'PUBLISHED' || content.status === 'PUBLISHING') {
      throw new BadRequestException(`Cannot schedule content that is already ${content.status}.`);
    }
    if (content.status === 'REJECTED') {
      throw new BadRequestException('Rejected content cannot be scheduled.');
    }

    // Ingested REPURPOSED videos must finish the AI pipeline before the publish
    // Review pass. First-pass Review (no AI metadata yet) starts Analyze — it
    // must not create publish targets.
    if (content.type === 'REPURPOSED') {
      const earlyAi = [
        'APPROVED',
        'ANALYZING',
        'SCRIPT_READY',
        'SCRIPT_APPROVED',
        'TTS_DONE',
      ].includes(content.status);
      if (earlyAi) {
        throw new BadRequestException(
          'Finish the AI pipeline before scheduling. The finished package will go to Review before publish.',
        );
      }
      if (
        content.status === 'REVIEW_PENDING' &&
        !hasPublishReadyAiMetadata(content.currentStep) &&
        !isPublishReviewApproved(content.currentStep)
      ) {
        const existing = await this.prisma.client.publishTarget.count({
          where: { contentItemId: content.id },
        });
        if (existing === 0) {
          throw new BadRequestException(
            'This ingested video is still in Review for the AI pipeline. Approve it there first, then schedule after metadata is ready.',
          );
        }
      }
    }

    // Every schedule/publish path parks in Review with PENDING targets until
    // Approve releases them. Never enqueue from here — even for NOW.
    if (content.status !== 'REVIEW_PENDING') {
      if (!canTransition(content.status, 'REVIEW_PENDING')) {
        throw new BadRequestException(
          `Cannot send ${content.status} content to Review for publish approval.`,
        );
      }
      await this.prisma.client.contentItem.update({
        where: { id: content.id },
        // Preserve currentStep (AI metadata / script) — unlike resetToReview.
        data: { status: 'REVIEW_PENDING', statusReason: null },
      });
    }

    const created: PublishTargetView[] = [];
    // Track how many slots we've consumed per account within this call.
    const slotIndexByAccount = new Map<string, number>();

    const briefTitle = content.idea?.brief?.videoTitle?.trim() || '';
    const briefDescription = content.idea?.brief?.videoDescription?.trim() || '';
    const aiMeta = parseStepMetadata(content.currentStep);
    const aiTitle =
      typeof aiMeta.title === 'string' && aiMeta.title.trim() ? aiMeta.title.trim() : '';
    const aiDescription =
      typeof aiMeta.description === 'string' && aiMeta.description.trim()
        ? aiMeta.description.trim()
        : '';
    const aiTags = Array.isArray(aiMeta.tags)
      ? (aiMeta.tags as unknown[]).filter(
          (t): t is string => typeof t === 'string' && t.trim().length > 0,
        )
      : Array.isArray(aiMeta.keywords)
        ? (aiMeta.keywords as unknown[]).filter(
            (t): t is string => typeof t === 'string' && t.trim().length > 0,
          )
        : [];

    for (const t of dto.targets) {
      const account = await this.prisma.client.socialAccount.findFirst({
        where: { id: t.accountId, deletedAt: null },
      });
      if (!account) throw new NotFoundException(`Account ${t.accountId} not found.`);

      const rawOverride = (t.metadataOverride ?? {}) as Record<string, unknown>;
      const override: Record<string, unknown> = { ...rawOverride };
      // Prefer client override → idea brief → AI metadata → content title.
      if (typeof override.title !== 'string' || !override.title.trim()) {
        override.title = briefTitle || aiTitle || content.title;
      }
      if (typeof override.description !== 'string' || !String(override.description).trim()) {
        if (briefDescription) override.description = briefDescription;
        else if (aiDescription) override.description = aiDescription;
      }
      if (!Array.isArray(override.tags) && aiTags.length > 0) {
        override.tags = aiTags;
      }
      this.guardMetadata(account.platform, override);

      let scheduledAt: Date;
      if (t.scheduleMode === 'NOW') {
        scheduledAt = new Date();
      } else if (t.scheduleMode === 'FIXED') {
        if (!t.scheduledAt) throw new BadRequestException('FIXED schedule requires scheduledAt.');
        scheduledAt = new Date(t.scheduledAt);
      } else {
        const idx = slotIndexByAccount.get(t.accountId) ?? 0;
        const slots = await this.planner.nextSlots(t.accountId, idx + 1);
        const slot = slots[idx];
        if (!slot) throw new BadRequestException(`No free schedule slot for account ${t.accountId}.`);
        slotIndexByAccount.set(t.accountId, idx + 1);
        scheduledAt = slot;
      }

      const target = await this.prisma.client.publishTarget.create({
        data: {
          contentItemId: dto.contentItemId,
          accountId: t.accountId,
          scheduleMode: t.scheduleMode,
          scheduledAt,
          status: 'PENDING',
          metadataOverride: override as Prisma.InputJsonValue,
        },
        include: TARGET_INCLUDE,
      });
      created.push(toPublishTargetView(target));
    }

    return created;
  }

  async listTargets(params: { accountId?: string; from?: string; to?: string }): Promise<PublishTargetView[]> {
    const where: Prisma.PublishTargetWhereInput = {
      ...(params.accountId ? { accountId: params.accountId } : {}),
      ...(params.from || params.to
        ? {
            scheduledAt: {
              ...(params.from ? { gte: new Date(params.from) } : {}),
              ...(params.to ? { lte: new Date(params.to) } : {}),
            },
          }
        : {}),
    };
    const targets = await this.prisma.client.publishTarget.findMany({
      where,
      include: TARGET_INCLUDE,
      orderBy: { scheduledAt: 'asc' },
      take: 500,
    });
    return targets.map(toPublishTargetView);
  }

  async getTarget(id: string): Promise<PublishTargetView> {
    const target = await this.prisma.client.publishTarget.findUnique({
      where: { id },
      include: TARGET_INCLUDE,
    });
    if (!target) throw new NotFoundException('Publish target not found.');
    return toPublishTargetView(target);
  }

  /** Look up the FINAL asset for a target so the manual-mode UI can download it. */
  async getFinalAssetForDownload(publishTargetId: string): Promise<{
    path: string;
    bytes: number | null;
    mimeType: string;
  } | null> {
    const target = await this.prisma.client.publishTarget.findUnique({
      where: { id: publishTargetId },
      select: {
        contentItem: {
          select: { assets: { where: { kind: 'FINAL' }, take: 1 } },
        },
      },
    });
    const asset = target?.contentItem.assets[0];
    if (!asset?.localPath) return null;
    const ext = asset.localPath.toLowerCase().split('.').pop() ?? '';
    const mime =
      ext === 'mp4' ? 'video/mp4'
      : ext === 'mov' ? 'video/quicktime'
      : ext === 'webm' ? 'video/webm'
      : 'application/octet-stream';
    return { path: asset.localPath, bytes: asset.bytes ? Number(asset.bytes) : null, mimeType: mime };
  }

  /** Manual mode: Owner uploaded to the platform by hand — record it as PUBLISHED. */
  async markManuallyPublished(id: string, platformPostId?: string): Promise<PublishTargetView> {
    const target = await this.prisma.client.publishTarget.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        contentItemId: true,
        account: { select: { connectionMethod: true, name: true } },
        contentItem: {
          select: { status: true, type: true, currentStep: true },
        },
      },
    });
    if (!target) throw new NotFoundException('Publish target not found.');
    if (target.account.connectionMethod !== 'MANUAL') {
      throw new BadRequestException(
        `Cannot mark-published on a ${target.account.connectionMethod} account (${target.account.name}). Only MANUAL accounts support this.`,
      );
    }
    if (target.status === 'PUBLISHED') {
      // Idempotent — already marked.
      const existing = await this.prisma.client.publishTarget.findUniqueOrThrow({
        where: { id },
        include: TARGET_INCLUDE,
      });
      return toPublishTargetView(existing);
    }
    if (
      target.contentItem.status === 'REVIEW_PENDING' ||
      target.contentItem.status === 'REJECTED' ||
      target.contentItem.status === 'INGESTED' ||
      target.status === 'PENDING' ||
      target.status === 'DRAFT'
    ) {
      throw new BadRequestException(
        'Approve this item in Review before marking it published.',
      );
    }
    if (
      target.contentItem.type === 'REPURPOSED' &&
      !isPublishReviewApproved(target.contentItem.currentStep)
    ) {
      throw new BadRequestException(
        'This package has not passed publish Review yet. Approve it in Review first.',
      );
    }
    const row = await this.prisma.client.publishTarget.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        platformPostId: platformPostId?.trim() || `manual-${id}`,
      },
      include: TARGET_INCLUDE,
    });

    // Advance the parent content item if this was the last outstanding target.
    const siblings = await this.prisma.client.publishTarget.findMany({
      where: { contentItemId: target.contentItemId },
      select: { status: true },
    });
    const terminal = new Set(['PUBLISHED', 'FAILED', 'DRAFT']);
    if (siblings.every((s) => terminal.has(s.status)) && siblings.some((s) => s.status === 'PUBLISHED')) {
      await this.prisma.client.contentItem.update({
        where: { id: target.contentItemId },
        data: { status: 'PUBLISHED' },
      });
    }

    return toPublishTargetView(row);
  }

  async patchTarget(id: string, dto: PatchTargetDto): Promise<PublishTargetView> {
    const existing = await this.prisma.client.publishTarget.findUnique({
      where: { id },
      include: { contentItem: { select: { status: true } } },
    });
    if (!existing) throw new NotFoundException('Publish target not found.');
    if (existing.status === 'PUBLISHING' || existing.status === 'PUBLISHED') {
      throw new BadRequestException(`Cannot modify a ${existing.status.toLowerCase()} target.`);
    }

    if (dto.publishNow) {
      const now = new Date();
      const awaitingReview =
        existing.contentItem.status === 'REVIEW_PENDING' || existing.status === 'PENDING';
      const row = await this.prisma.client.publishTarget.update({
        where: { id },
        data: {
          scheduleMode: 'NOW',
          scheduledAt: now,
          status: awaitingReview ? 'PENDING' : 'SCHEDULED',
          lastError: Prisma.DbNull,
        },
        include: TARGET_INCLUDE,
      });
      if (!awaitingReview) {
        await this.queue.enqueuePublish(id);
      }
      return toPublishTargetView(row);
    }

    if (dto.retry) {
      const awaitingReview =
        existing.contentItem.status === 'REVIEW_PENDING' || existing.status === 'PENDING';
      const row = await this.prisma.client.publishTarget.update({
        where: { id },
        data: {
          scheduleMode: 'NOW',
          scheduledAt: new Date(),
          status: awaitingReview ? 'PENDING' : 'SCHEDULED',
          lastError: Prisma.DbNull,
        },
        include: TARGET_INCLUDE,
      });
      if (!awaitingReview) {
        await this.queue.enqueuePublish(id);
      }
      return toPublishTargetView(row);
    }

    const data: Prisma.PublishTargetUpdateInput = {};
    if (dto.cancel) data.status = 'DRAFT';
    if (dto.scheduledAt) {
      data.scheduledAt = new Date(dto.scheduledAt);
      data.scheduleMode = 'FIXED';
      data.lastError = Prisma.DbNull;
      // Never promote to SCHEDULED while content is still awaiting Review.
      data.status =
        existing.contentItem.status === 'REVIEW_PENDING' || existing.status === 'PENDING'
          ? 'PENDING'
          : 'SCHEDULED';
    }

    const target = await this.prisma.client.publishTarget.update({
      where: { id },
      data,
      include: TARGET_INCLUDE,
    });

    // Changing the schedule time should re-queue only when the new time is due
    // now; future slots are picked up by the worker dispatcher.
    if (
      dto.scheduledAt &&
      target.status === 'SCHEDULED' &&
      existing.contentItem.status !== 'REVIEW_PENDING' &&
      new Date(dto.scheduledAt).getTime() <= Date.now()
    ) {
      await this.queue.enqueuePublish(id);
    }

    return toPublishTargetView(target);
  }
}
