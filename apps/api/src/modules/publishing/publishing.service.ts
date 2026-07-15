import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Platform, Prisma } from '@scp/db';
import {
  FacebookAdapter,
  PostQuedAdapter,
  YouTubeAdapter,
  type PlatformConstraints,
} from '@scp/publish-adapters';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { SlotPlannerService } from '../scheduling/slot-planner.service';
import { canTransition } from '../content/content-state';
import { toPublishTargetView, type PublishTargetView } from './publish-target.view';
import type { CreatePublishDto, PatchTargetDto } from './dto/publish.dto';

/** getConstraints() needs no live client, so a stub config is safe here. */
const STUB_PQ = { baseUrl: '', apiKey: '', headerStyle: 'bearer' as const };

function constraintsFor(platform: Platform): PlatformConstraints {
  switch (platform) {
    case 'YOUTUBE':
      return new YouTubeAdapter(STUB_PQ).getConstraints();
    case 'FACEBOOK':
      return new FacebookAdapter().getConstraints();
    case 'TIKTOK':
      return new PostQuedAdapter(STUB_PQ).getConstraints();
  }
}

@Injectable()
export class PublishingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
    private readonly planner: SlotPlannerService,
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
      select: { id: true, status: true },
    });
    if (!content) throw new NotFoundException('Content item not found.');

    const created: PublishTargetView[] = [];
    const nowTargetIds: string[] = [];
    // Track how many slots we've consumed per account within this call.
    const slotIndexByAccount = new Map<string, number>();

    for (const t of dto.targets) {
      const account = await this.prisma.client.socialAccount.findFirst({
        where: { id: t.accountId, deletedAt: null },
      });
      if (!account) throw new NotFoundException(`Account ${t.accountId} not found.`);

      const override = (t.metadataOverride ?? {}) as Record<string, unknown>;
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
          status: 'SCHEDULED',
          metadataOverride: override as Prisma.InputJsonValue,
        },
        include: { account: { select: { platform: true } }, contentItem: { select: { title: true } } },
      });
      created.push(toPublishTargetView(target));
      if (t.scheduleMode === 'NOW') nowTargetIds.push(target.id);
    }

    // Advance the content item to SCHEDULED when the transition is legal.
    if (canTransition(content.status, 'SCHEDULED')) {
      await this.prisma.client.contentItem.update({
        where: { id: content.id },
        data: { status: 'SCHEDULED' },
      });
    }

    // Dispatch NOW targets immediately (the dispatcher handles the rest by cron).
    for (const id of nowTargetIds) await this.queue.enqueuePublish(id);

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
      include: { account: { select: { platform: true } }, contentItem: { select: { title: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 500,
    });
    return targets.map(toPublishTargetView);
  }

  async getTarget(id: string): Promise<PublishTargetView> {
    const target = await this.prisma.client.publishTarget.findUnique({
      where: { id },
      include: { account: { select: { platform: true } }, contentItem: { select: { title: true } } },
    });
    if (!target) throw new NotFoundException('Publish target not found.');
    return toPublishTargetView(target);
  }

  async patchTarget(id: string, dto: PatchTargetDto): Promise<PublishTargetView> {
    const existing = await this.prisma.client.publishTarget.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Publish target not found.');
    if (existing.status === 'PUBLISHING' || existing.status === 'PUBLISHED') {
      throw new BadRequestException(`Cannot modify a ${existing.status.toLowerCase()} target.`);
    }

    const data: Prisma.PublishTargetUpdateInput = {};
    if (dto.cancel) data.status = 'DRAFT';
    if (dto.scheduledAt) {
      data.scheduledAt = new Date(dto.scheduledAt);
      data.status = 'SCHEDULED';
    }

    const target = await this.prisma.client.publishTarget.update({
      where: { id },
      data,
      include: { account: { select: { platform: true } }, contentItem: { select: { title: true } } },
    });
    return toPublishTargetView(target);
  }
}
