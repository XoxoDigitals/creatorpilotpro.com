import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import {
  toDramaSeriesView,
  toDramaSeriesDetailView,
  toDramaEpisodeView,
  type DramaSeriesView,
  type DramaSeriesDetailView,
  type DramaEpisodeView,
} from './dramas.view';
import type { CreateSeriesDto, PatchSeriesDto } from './dto/dramas.dto';

/** Statuses that allow metadata edits on a series. */
const EDITABLE_STATUSES = ['PLANNING', 'BIBLE_READY'] as const;

/** Statuses from which bible regeneration is allowed. */
const REGENERATABLE_STATUSES = ['BIBLE_READY', 'FAILED'] as const;

/** Statuses that allow episode generation on a series. */
const EPISODE_GEN_SERIES_STATUSES = ['BIBLE_READY', 'IN_PRODUCTION'] as const;

/** Episode statuses that allow (re-)generation. */
const EPISODE_GEN_STATUSES = ['PENDING', 'FAILED'] as const;

/** Episode statuses that count as "generated" for dependency checks. */
const EPISODE_READY_STATUSES = [
  'GENERATED',
  'IN_PRODUCTION',
  'UPLOADED',
  'PUBLISHED',
] as const;

@Injectable()
export class DramasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
  ) {}

  // ---------------------------------------------------------------------------
  // Series CRUD
  // ---------------------------------------------------------------------------

  async list(accountId: string): Promise<DramaSeriesView[]> {
    const series = await this.prisma.client.dramaSeries.findMany({
      where: { accountId, deletedAt: null },
      include: { episodes: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return series.map(toDramaSeriesView);
  }

  async get(id: string): Promise<DramaSeriesDetailView> {
    const series = await this.prisma.client.dramaSeries.findFirst({
      where: { id, deletedAt: null },
      include: { episodes: { orderBy: { number: 'asc' } } },
    });
    if (!series) throw new NotFoundException('Drama series not found.');
    return toDramaSeriesDetailView(series);
  }

  async create(accountId: string, dto: CreateSeriesDto): Promise<DramaSeriesView> {
    // Verify account exists and has dramas enabled.
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true, dramasEnabled: true },
    });
    if (!account) throw new NotFoundException(`Account ${accountId} not found.`);
    if (!account.dramasEnabled) {
      throw new BadRequestException(
        'Dramas are not enabled for this account. Enable them in account settings first.',
      );
    }

    // Create the series with PLANNING status, then transition to BIBLE_GENERATING.
    const series = await this.prisma.client.dramaSeries.create({
      data: {
        accountId,
        title: dto.title,
        genre: dto.genre,
        theme: dto.theme,
        audience: dto.audience,
        episodeCount: dto.episodeCount,
        episodeDurationSec: dto.episodeDurationSec,
        styleReferences: dto.styleReferences ?? null,
        status: 'BIBLE_GENERATING',
        // Pre-create episode stubs so they exist for listing.
        episodes: {
          create: Array.from({ length: dto.episodeCount }, (_, i) => ({
            number: i + 1,
            status: 'PENDING' as const,
          })),
        },
      },
      include: { episodes: { select: { status: true } } },
    });

    await this.queue.enqueueDramaBible(series.id);
    return toDramaSeriesView(series);
  }

  async patch(id: string, dto: PatchSeriesDto): Promise<DramaSeriesView> {
    const series = await this.prisma.client.dramaSeries.findFirst({
      where: { id, deletedAt: null },
    });
    if (!series) throw new NotFoundException('Drama series not found.');

    if (!(EDITABLE_STATUSES as readonly string[]).includes(series.status)) {
      throw new BadRequestException(
        'Series can only be edited in PLANNING or BIBLE_READY status.',
      );
    }

    const updated = await this.prisma.client.dramaSeries.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.genre !== undefined ? { genre: dto.genre } : {}),
        ...(dto.theme !== undefined ? { theme: dto.theme } : {}),
        ...(dto.audience !== undefined ? { audience: dto.audience } : {}),
        ...(dto.episodeCount !== undefined ? { episodeCount: dto.episodeCount } : {}),
        ...(dto.episodeDurationSec !== undefined
          ? { episodeDurationSec: dto.episodeDurationSec }
          : {}),
        ...(dto.styleReferences !== undefined
          ? { styleReferences: dto.styleReferences }
          : {}),
      },
      include: { episodes: { select: { status: true } } },
    });
    return toDramaSeriesView(updated);
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    const series = await this.prisma.client.dramaSeries.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!series) throw new NotFoundException('Drama series not found.');
    await this.prisma.client.dramaSeries.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Bible regeneration
  // ---------------------------------------------------------------------------

  async regenerateBible(id: string): Promise<DramaSeriesView> {
    const series = await this.prisma.client.dramaSeries.findFirst({
      where: { id, deletedAt: null },
      include: { episodes: { select: { id: true, status: true } } },
    });
    if (!series) throw new NotFoundException('Drama series not found.');

    if (!(REGENERATABLE_STATUSES as readonly string[]).includes(series.status)) {
      throw new BadRequestException(
        'Bible can only be regenerated in BIBLE_READY or FAILED status.',
      );
    }

    // Delete PENDING episodes (not ones already generated/in production).
    const pendingEpisodeIds = series.episodes
      .filter((e) => e.status === 'PENDING')
      .map((e) => e.id);
    if (pendingEpisodeIds.length > 0) {
      await this.prisma.client.dramaEpisode.deleteMany({
        where: { id: { in: pendingEpisodeIds } },
      });
    }

    const updated = await this.prisma.client.dramaSeries.update({
      where: { id },
      data: {
        seriesBible: Prisma.DbNull,
        characterSheets: [],
        status: 'BIBLE_GENERATING',
      },
      include: { episodes: { select: { status: true } } },
    });

    await this.queue.enqueueDramaBible(id);
    return toDramaSeriesView(updated);
  }

  // ---------------------------------------------------------------------------
  // Episodes
  // ---------------------------------------------------------------------------

  async listEpisodes(seriesId: string): Promise<DramaEpisodeView[]> {
    const episodes = await this.prisma.client.dramaEpisode.findMany({
      where: { seriesId },
      orderBy: { number: 'asc' },
    });
    return episodes.map((e) => toDramaEpisodeView(e, { truncateScript: true }));
  }

  async getEpisode(seriesId: string, number: number): Promise<DramaEpisodeView> {
    const episode = await this.prisma.client.dramaEpisode.findFirst({
      where: { seriesId, number },
    });
    if (!episode) throw new NotFoundException(`Episode ${number} not found.`);
    return toDramaEpisodeView(episode);
  }

  async generateEpisode(seriesId: string, number: number): Promise<DramaEpisodeView> {
    // Validate the series is in the right state.
    const series = await this.prisma.client.dramaSeries.findFirst({
      where: { id: seriesId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!series) throw new NotFoundException('Drama series not found.');

    if (
      !(EPISODE_GEN_SERIES_STATUSES as readonly string[]).includes(series.status)
    ) {
      throw new BadRequestException(
        'Episodes can only be generated when the series is in BIBLE_READY or IN_PRODUCTION status.',
      );
    }

    // Find the target episode.
    const episode = await this.prisma.client.dramaEpisode.findFirst({
      where: { seriesId, number },
    });
    if (!episode) throw new NotFoundException(`Episode ${number} not found.`);

    if (!(EPISODE_GEN_STATUSES as readonly string[]).includes(episode.status)) {
      throw new BadRequestException(
        `Episode ${number} cannot be generated in its current status (${episode.status}).`,
      );
    }

    // For episode > 1, verify the previous episode has been generated.
    if (number > 1) {
      const previous = await this.prisma.client.dramaEpisode.findFirst({
        where: { seriesId, number: number - 1 },
        select: { status: true },
      });
      if (
        !previous ||
        !(EPISODE_READY_STATUSES as readonly string[]).includes(previous.status)
      ) {
        throw new BadRequestException('Previous episode must be generated first.');
      }
    }

    // Transition episode to GENERATING.
    const updated = await this.prisma.client.dramaEpisode.update({
      where: { id: episode.id },
      data: { status: 'GENERATING' },
    });

    // Transition series to IN_PRODUCTION if it was BIBLE_READY.
    if (series.status === 'BIBLE_READY') {
      await this.prisma.client.dramaSeries.update({
        where: { id: seriesId },
        data: { status: 'IN_PRODUCTION' },
      });
    }

    await this.queue.enqueueDramaEpisode(episode.id);
    return toDramaEpisodeView(updated);
  }
}
