import { Injectable, NotFoundException } from '@nestjs/common';
import type { ContentItemStatus, Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { assertTransition } from './content-state';
import {
  toContentItemView,
  toReviewItemView,
  type ContentItemView,
  type ReviewItemView,
} from './content.view';
import type { CreateContentDto } from './dto/content.dto';

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Items awaiting review, optionally scoped to accounts they target. */
  async listReview(accountId?: string): Promise<ReviewItemView[]> {
    const where: Prisma.ContentItemWhereInput = {
      deletedAt: null,
      status: 'REVIEW_PENDING',
      ...(accountId ? { publishTargets: { some: { accountId } } } : {}),
    };
    const items = await this.prisma.client.contentItem.findMany({
      where,
      include: {
        assets: true,
        publishTargets: { select: { accountId: true } },
        sourceVideo: { select: { id: true, sourceUrl: true, rightsNote: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return items.map(toReviewItemView);
  }

  async approve(id: string): Promise<ContentItemView> {
    return this.transition(id, 'APPROVED');
  }

  async reject(id: string, reason?: string): Promise<ContentItemView> {
    return this.transition(id, 'REJECTED', reason);
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
    return toContentItemView(updated);
  }
}
