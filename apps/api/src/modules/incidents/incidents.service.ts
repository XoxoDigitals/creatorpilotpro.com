import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Incident, IncidentStatus } from '@scp/db';
import { isPublishReviewApproved } from '@scp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { ContentService } from '../content/content.service';
import { IdeasService } from '../ideas/ideas.service';
import { canTransition } from '../content/content-state';
import { isIncidentRetryable, toIncidentView, type IncidentView } from './incident.view';

type Detail = Record<string, unknown>;

function asDetail(raw: unknown): Detail {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Detail) : {};
}

function str(detail: Detail, key: string): string | undefined {
  const v = detail[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
    private readonly ideas: IdeasService,
    private readonly content: ContentService,
  ) {}

  async list(status?: IncidentStatus): Promise<IncidentView[]> {
    const incidents = await this.prisma.client.incident.findMany({
      where: status ? { status } : {},
      include: { account: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return incidents.map(toIncidentView);
  }

  async get(id: string): Promise<IncidentView> {
    const incident = await this.prisma.client.incident.findUnique({
      where: { id },
      include: { account: { select: { name: true } } },
    });
    if (!incident) throw new NotFoundException('Incident not found.');
    return toIncidentView(incident);
  }

  /**
   * Manual retry from the incident center (docs/06 §4 step 6 / PRD F6):
   * re-enqueue the related work (publish target, idea package, AI/TTS pipeline,
   * idea generation, or watched source), then acknowledge the incident.
   */
  async retry(id: string): Promise<IncidentView> {
    const incident = await this.prisma.client.incident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found.');
    if (!isIncidentRetryable(incident)) {
      throw new BadRequestException(
        'This incident has nothing to re-queue. Fix the underlying cause, then mark it resolved.',
      );
    }

    await this.dispatchRetry(incident);
    await this.prisma.client.incident.update({ where: { id }, data: { status: 'ACKED' } });
    return this.get(id);
  }

  async ack(id: string): Promise<IncidentView> {
    await this.requireIncident(id);
    await this.prisma.client.incident.update({ where: { id }, data: { status: 'ACKED' } });
    return this.get(id);
  }

  async resolve(id: string, actorId: string): Promise<IncidentView> {
    await this.requireIncident(id);
    await this.prisma.client.incident.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedById: actorId, resolvedAt: new Date() },
    });
    return this.get(id);
  }

  /** Resolve every OPEN/ACKED incident in this deployment (single-tenant). */
  async resolveAll(actorId: string): Promise<{ resolved: number; incidentIds: string[] }> {
    const open = await this.prisma.client.incident.findMany({
      where: { status: { in: ['OPEN', 'ACKED'] } },
      select: { id: true },
    });
    if (open.length === 0) return { resolved: 0, incidentIds: [] };
    const incidentIds = open.map((i) => i.id);
    await this.prisma.client.incident.updateMany({
      where: { id: { in: incidentIds } },
      data: { status: 'RESOLVED', resolvedById: actorId, resolvedAt: new Date() },
    });
    return { resolved: incidentIds.length, incidentIds };
  }

  private async dispatchRetry(incident: Incident): Promise<void> {
    const detail = asDetail(incident.detail);
    const title = incident.title;

    if (incident.publishTargetId) {
      await this.retryPublish(incident.publishTargetId);
      return;
    }

    const ideaId = str(detail, 'ideaId');
    if (ideaId) {
      await this.retryIdeaIncident(ideaId, title);
      return;
    }

    const accountId =
      incident.accountId ??
      str(detail, 'accountId') ??
      undefined;
    if (accountId && /idea generation/i.test(title)) {
      await this.queue.enqueueIdeaGeneration(accountId);
      return;
    }

    if (incident.contentItemId) {
      if (/^TTS\b/i.test(title)) {
        await this.content.retryTtsPipeline(incident.contentItemId);
      } else if (/A\/B|AB suggestions/i.test(title)) {
        await this.content.generateSuggestions(incident.contentItemId);
      } else {
        await this.content.retryAiPipeline(incident.contentItemId);
      }
      return;
    }

    const watchedSourceId = str(detail, 'watchedSourceId');
    if (watchedSourceId) {
      await this.retryWatcher(watchedSourceId);
      return;
    }

    const seriesId = str(detail, 'seriesId');
    if (seriesId) {
      await this.prisma.client.dramaSeries.update({
        where: { id: seriesId },
        data: { status: 'BIBLE_GENERATING' },
      });
      await this.queue.enqueueDramaBible(seriesId);
      return;
    }

    const episodeId = str(detail, 'episodeId');
    if (episodeId) {
      await this.queue.enqueueDramaEpisode(episodeId);
      return;
    }

    throw new BadRequestException(
      'This incident has nothing to re-queue. Fix the underlying cause, then mark it resolved.',
    );
  }

  private async retryPublish(publishTargetId: string): Promise<void> {
    const target = await this.prisma.client.publishTarget.findUnique({
      where: { id: publishTargetId },
      select: {
        id: true,
        status: true,
        contentItemId: true,
        contentItem: {
          select: { id: true, status: true, type: true, currentStep: true },
        },
      },
    });
    if (!target) {
      throw new BadRequestException('The publish target for this incident no longer exists.');
    }
    const content = target.contentItem;
    if (
      content.status === 'REVIEW_PENDING' ||
      content.status === 'REJECTED' ||
      content.status === 'INGESTED'
    ) {
      throw new BadRequestException(
        'This content is still in Review (or rejected). Approve it in Review before retrying publish.',
      );
    }
    // Legacy AI schedules that never passed publish Review — pull back instead of publishing.
    if (content.type === 'REPURPOSED' && !isPublishReviewApproved(content.currentStep)) {
      if (canTransition(content.status, 'REVIEW_PENDING')) {
        await this.prisma.client.contentItem.update({
          where: { id: content.id },
          data: { status: 'REVIEW_PENDING', statusReason: null },
        });
      }
      await this.prisma.client.publishTarget.updateMany({
        where: {
          contentItemId: content.id,
          status: { in: ['SCHEDULED', 'PUBLISHING', 'FAILED', 'PENDING'] },
        },
        data: { status: 'PENDING' },
      });
      throw new BadRequestException(
        'This package was scheduled without Review approval. It has been moved to the Review queue — Approve there to publish.',
      );
    }
    await this.prisma.client.publishTarget.update({
      where: { id: publishTargetId },
      data: { status: 'SCHEDULED', scheduledAt: new Date() },
    });
    await this.queue.enqueuePublish(publishTargetId);
  }

  /**
   * Re-queue an idea package / stage. Prefer the dedicated package resume path
   * when the package is FAILED; otherwise re-enqueue the stage named in the
   * incident title (incidents can outlive a later package-status change).
   */
  private async retryIdeaIncident(ideaId: string, title: string): Promise<void> {
    const idea = await this.prisma.client.idea.findFirst({
      where: { id: ideaId, deletedAt: null },
      include: { brief: { select: { packageStage: true } } },
    });
    if (!idea) {
      throw new BadRequestException('The idea for this incident no longer exists.');
    }

    const packageFailed =
      idea.packageStatus === 'FAILED' || idea.brief?.packageStage === 'FAILED';
    if (packageFailed) {
      await this.ideas.retryPackage(ideaId);
      return;
    }

    await this.prisma.client.idea.update({
      where: { id: ideaId },
      data: { packageStatus: 'GENERATING', status: 'APPROVED' },
    });

    if (/visuals/i.test(title)) {
      if (idea.brief) {
        await this.prisma.client.productionBrief.update({
          where: { ideaId },
          data: { packageStage: 'VISUALS', packageStageError: null },
        });
      }
      await this.queue.enqueueIdeaVisuals(ideaId);
      return;
    }
    if (/tts|voice/i.test(title)) {
      if (idea.brief) {
        await this.prisma.client.productionBrief.update({
          where: { ideaId },
          data: {
            packageStage: 'VOICE',
            packageStageError: null,
            voiceoverStatus: 'GENERATING',
          },
        });
      }
      await this.queue.enqueueIdeaTts(ideaId);
      return;
    }
    if (/transcript/i.test(title)) {
      if (idea.brief) {
        await this.prisma.client.productionBrief.update({
          where: { ideaId },
          data: { packageStage: 'TRANSCRIPT', packageStageError: null },
        });
      }
      await this.queue.enqueueIdeaTranscript(ideaId);
      return;
    }

    if (idea.brief) {
      await this.prisma.client.productionBrief.update({
        where: { ideaId },
        data: { packageStage: 'SCRIPT', packageStageError: null },
      });
    }
    await this.queue.enqueueBriefGeneration(ideaId);
  }

  private async retryWatcher(watchedSourceId: string): Promise<void> {
    const source = await this.prisma.client.watchedSource.findUnique({
      where: { id: watchedSourceId },
      select: { id: true },
    });
    if (!source) {
      throw new BadRequestException('The watched source for this incident no longer exists.');
    }
    await this.prisma.client.watchedSource.update({
      where: { id: watchedSourceId },
      data: {
        status: 'ACTIVE',
        consecutiveFailures: 0,
        errorNote: null,
      },
    });
    await this.queue.enqueueWatch(watchedSourceId);
  }

  private async requireIncident(id: string): Promise<void> {
    const exists = await this.prisma.client.incident.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Incident not found.');
  }
}
