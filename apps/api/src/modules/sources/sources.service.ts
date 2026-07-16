import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { toWatchedSourceView, type WatchedSourceView } from './watched-source.view';
import { toSourceVideoView, type SourceVideoView } from './source-video.view';
import type { BulkImportDto, CreateSourceDto, PatchSourceDto } from './dto/sources.dto';

const SOURCE_WITH_COUNT = { _count: { select: { videos: true } } } as const;

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
  ) {}

  private async assertAccount(targetAccountId: string): Promise<void> {
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: targetAccountId, deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new NotFoundException(`Account ${targetAccountId} not found.`);
  }

  async list(params: { accountId?: string }): Promise<WatchedSourceView[]> {
    const sources = await this.prisma.client.watchedSource.findMany({
      where: {
        deletedAt: null,
        ...(params.accountId ? { targetAccountId: params.accountId } : {}),
      },
      include: SOURCE_WITH_COUNT,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return sources.map(toWatchedSourceView);
  }

  async get(id: string): Promise<WatchedSourceView> {
    const source = await this.prisma.client.watchedSource.findFirst({
      where: { id, deletedAt: null },
      include: SOURCE_WITH_COUNT,
    });
    if (!source) throw new NotFoundException('Watched source not found.');
    return toWatchedSourceView(source);
  }

  async create(dto: CreateSourceDto): Promise<WatchedSourceView> {
    if (dto.targetAccountId) await this.assertAccount(dto.targetAccountId);
    const source = await this.prisma.client.watchedSource.create({
      data: {
        type: dto.type,
        url: dto.url,
        label: dto.label ?? null,
        ...(dto.checkIntervalMin != null ? { checkIntervalMin: dto.checkIntervalMin } : {}),
        ...(dto.trimStartMs != null ? { trimStartMs: dto.trimStartMs } : {}),
        targetAccountId: dto.targetAccountId ?? null,
      },
      include: SOURCE_WITH_COUNT,
    });
    return toWatchedSourceView(source);
  }

  async patch(id: string, dto: PatchSourceDto): Promise<WatchedSourceView> {
    const existing = await this.prisma.client.watchedSource.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Watched source not found.');
    if (dto.targetAccountId) await this.assertAccount(dto.targetAccountId);

    const data: Prisma.WatchedSourceUpdateInput = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.checkIntervalMin !== undefined) data.checkIntervalMin = dto.checkIntervalMin;
    if (dto.trimStartMs !== undefined) data.trimStartMs = dto.trimStartMs;
    if (dto.targetAccountId !== undefined) {
      data.targetAccount = dto.targetAccountId
        ? { connect: { id: dto.targetAccountId } }
        : { disconnect: true };
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      // Resuming to ACTIVE clears the error latch so the watcher polls again.
      if (dto.status === 'ACTIVE') {
        data.consecutiveFailures = 0;
        data.errorNote = null;
      }
    }

    const source = await this.prisma.client.watchedSource.update({
      where: { id },
      data,
      include: SOURCE_WITH_COUNT,
    });
    return toWatchedSourceView(source);
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    const existing = await this.prisma.client.watchedSource.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Watched source not found.');
    await this.prisma.client.watchedSource.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'PAUSED' },
    });
    return { id, deleted: true };
  }

  /** Manually enqueue a poll now (docs/04 §1). ERROR sources resume to ACTIVE first. */
  async checkNow(id: string): Promise<{ id: string; enqueued: true }> {
    const source = await this.prisma.client.watchedSource.findFirst({
      where: { id, deletedAt: null },
    });
    if (!source) throw new NotFoundException('Watched source not found.');
    if (source.status === 'PAUSED') {
      throw new BadRequestException('Resume the source before checking it.');
    }
    if (source.status === 'ERROR') {
      await this.prisma.client.watchedSource.update({
        where: { id },
        data: { status: 'ACTIVE', consecutiveFailures: 0, errorNote: null },
      });
    }
    await this.queue.enqueueWatch(id);
    return { id, enqueued: true };
  }

  /**
   * Bulk URL import (docs/04 §1): one PAUSED GENERIC_URL "batch" source + a
   * SourceVideo per unique URL, each enqueued for download. Returns the batch.
   */
  async bulkImport(dto: BulkImportDto): Promise<WatchedSourceView> {
    if (dto.targetAccountId) await this.assertAccount(dto.targetAccountId);
    const urls = [...new Set(dto.urls.map((u) => u.trim()).filter(Boolean))];
    if (urls.length === 0) throw new BadRequestException('No valid URLs to import.');

    const label = dto.label ?? `Batch import ${new Date().toISOString().slice(0, 10)}`;
    const batch = await this.prisma.client.watchedSource.create({
      data: {
        type: 'GENERIC_URL',
        url: `batch:${label}`,
        label,
        status: 'PAUSED', // a batch never polls; its videos are one-shot imports.
        targetAccountId: dto.targetAccountId ?? null,
        videos: {
          create: urls.map((url) => ({
            sourceUrl: url,
            sourcePlatformId: url,
            downloadStatus: 'PENDING',
          })),
        },
      },
      include: { ...SOURCE_WITH_COUNT, videos: { select: { id: true } } },
    });

    for (const v of batch.videos) await this.queue.enqueueDownload(v.id);
    return toWatchedSourceView(batch);
  }

  async listVideos(params: { sourceId?: string }): Promise<SourceVideoView[]> {
    const videos = await this.prisma.client.sourceVideo.findMany({
      where: { ...(params.sourceId ? { watchedSourceId: params.sourceId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return videos.map(toSourceVideoView);
  }

  async setRights(videoId: string, rightsNote: string, actorId: string): Promise<SourceVideoView> {
    const existing = await this.prisma.client.sourceVideo.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Source video not found.');
    const video = await this.prisma.client.sourceVideo.update({
      where: { id: videoId },
      data: { rightsNote, rightsConfirmedById: actorId },
    });
    return toSourceVideoView(video);
  }
}
