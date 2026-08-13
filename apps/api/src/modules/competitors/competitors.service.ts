import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import {
  toCompetitorChannelView,
  toCompetitorVideoView,
  type CompetitorChannelView,
  type CompetitorVideoPage,
} from './competitors.view';
import type {
  CreateCompetitorDto,
  ListCompetitorVideosQuery,
  PatchCompetitorDto,
} from './dto/competitors.dto';
import { resolveYouTubeChannel } from './youtube-resolve';

const CHANNEL_WITH_COUNT = { _count: { select: { videos: true } } } as const;

/** Opaque load-more token encoding the next offset. */
function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(cursor: string): number | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as { o?: unknown };
    if (typeof parsed?.o !== 'number' || !Number.isFinite(parsed.o) || parsed.o < 0) return null;
    return Math.floor(parsed.o);
  } catch {
    return null;
  }
}

@Injectable()
export class CompetitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
  ) {}

  private async assertAccount(accountId: string): Promise<void> {
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new NotFoundException(`Account ${accountId} not found.`);
  }

  async list(accountId: string): Promise<CompetitorChannelView[]> {
    const channels = await this.prisma.client.competitorChannel.findMany({
      where: { ownAccountId: accountId, deletedAt: null },
      include: CHANNEL_WITH_COUNT,
      orderBy: { createdAt: 'desc' },
    });
    return channels.map(toCompetitorChannelView);
  }

  async get(id: string): Promise<CompetitorChannelView> {
    const channel = await this.prisma.client.competitorChannel.findFirst({
      where: { id, deletedAt: null },
      include: CHANNEL_WITH_COUNT,
    });
    if (!channel) throw new NotFoundException('Competitor channel not found.');
    return toCompetitorChannelView(channel);
  }

  async create(accountId: string, dto: CreateCompetitorDto): Promise<CompetitorChannelView> {
    await this.assertAccount(accountId);

    let youtubeChannelId = dto.youtubeChannelId ?? '';
    let name = dto.name ?? '';
    let channelUrl: string | null = null;

    if (dto.urlOrHandle) {
      const resolved = await resolveYouTubeChannel(this.prisma.client, dto.urlOrHandle);
      youtubeChannelId = resolved.youtubeChannelId;
      name = dto.name?.trim() || resolved.name;
      channelUrl = resolved.channelUrl;
    } else if (dto.youtubeChannelId) {
      youtubeChannelId = dto.youtubeChannelId;
      name = dto.name!;
      channelUrl = `https://www.youtube.com/channel/${youtubeChannelId}`;
    }

    try {
      const channel = await this.prisma.client.competitorChannel.create({
        data: {
          ownAccountId: accountId,
          youtubeChannelId,
          name,
          channelUrl,
          role: dto.role,
          checkIntervalMin: dto.checkIntervalMin,
        },
        include: CHANNEL_WITH_COUNT,
      });
      // Kick off an immediate poll so the Ideas UI can show videos soon.
      await this.queue.enqueueCompetitorPoll(channel.id);
      return toCompetitorChannelView(channel);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        throw new BadRequestException(
          'This YouTube channel is already tracked for the given account.',
        );
      }
      throw err;
    }
  }

  async patch(id: string, dto: PatchCompetitorDto): Promise<CompetitorChannelView> {
    const existing = await this.prisma.client.competitorChannel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Competitor channel not found.');

    const data: Prisma.CompetitorChannelUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.checkIntervalMin !== undefined) data.checkIntervalMin = dto.checkIntervalMin;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'ACTIVE') {
        data.consecutiveFailures = 0;
        data.errorNote = null;
      }
    }

    const channel = await this.prisma.client.competitorChannel.update({
      where: { id },
      data,
      include: CHANNEL_WITH_COUNT,
    });
    return toCompetitorChannelView(channel);
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.prisma.client.competitorChannel.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Competitor channel not found.');
    await this.prisma.client.competitorChannel.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'PAUSED' },
    });
    return { id, deleted: true };
  }

  /** Manually enqueue a competitor poll. ERROR channels resume to ACTIVE first. */
  async checkNow(id: string): Promise<{ id: string; enqueued: true }> {
    const channel = await this.prisma.client.competitorChannel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!channel) throw new NotFoundException('Competitor channel not found.');
    if (channel.status === 'PAUSED') {
      throw new BadRequestException('Resume the competitor before checking it.');
    }
    if (channel.status === 'ERROR') {
      await this.prisma.client.competitorChannel.update({
        where: { id },
        data: { status: 'ACTIVE', consecutiveFailures: 0, errorNote: null },
      });
    }
    await this.queue.enqueueCompetitorPoll(id);
    return { id, enqueued: true };
  }

  /** Manually enqueue channel performance analysis (channel memory refresh). */
  async analyzeNow(id: string): Promise<{ id: string; enqueued: true }> {
    const channel = await this.prisma.client.competitorChannel.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Competitor channel not found.');
    await this.queue.enqueueCompetitorPerformanceAnalysis(id, true);
    return { id, enqueued: true };
  }

  /**
   * Paginated video list. Default newest-first (publishedAt, then fetchedAt).
   * Supports limit / offset / page / cursor; always returns total for "Showing X of N".
   */
  async listVideos(
    competitorChannelId: string,
    query: ListCompetitorVideosQuery,
  ): Promise<CompetitorVideoPage> {
    const channel = await this.prisma.client.competitorChannel.findFirst({
      where: { id: competitorChannelId, deletedAt: null },
      select: { id: true },
    });
    if (!channel) throw new NotFoundException('Competitor channel not found.');

    const { limit, sort } = query;
    let offset = query.offset;

    if (query.cursor) {
      const decoded = decodeOffsetCursor(query.cursor);
      if (decoded == null) throw new BadRequestException('Invalid cursor.');
      offset = decoded;
    } else if (query.page != null) {
      offset = (query.page - 1) * limit;
    }

    const where = { competitorChannelId };
    const total = await this.prisma.client.competitorVideo.count({ where });

    const orderBy: Prisma.CompetitorVideoOrderByWithRelationInput[] =
      sort === 'views'
        ? [{ views: 'desc' }, { id: 'desc' }]
        : [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }, { id: 'desc' }];

    const videos = await this.prisma.client.competitorVideo.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
    });

    const items = videos.map(toCompetitorVideoView);
    const nextOffset = offset + items.length < total ? offset + items.length : null;

    return {
      items,
      total,
      limit,
      offset,
      hasMore: nextOffset !== null,
      nextOffset,
      nextCursor: nextOffset != null ? encodeOffsetCursor(nextOffset) : null,
      sort,
    };
  }
}
