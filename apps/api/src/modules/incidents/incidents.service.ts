import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { IncidentStatus } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { toIncidentView, type IncidentView } from './incident.view';

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
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
   * Manual retry from the incident center (docs/06 §4 step 6): re-enqueue the
   * incident's publish target, preserving its attempt history. The target is
   * reset to SCHEDULED and the incident acknowledged.
   */
  async retry(id: string): Promise<IncidentView> {
    const incident = await this.prisma.client.incident.findUnique({ where: { id } });
    if (!incident) throw new NotFoundException('Incident not found.');
    if (!incident.publishTargetId) {
      throw new BadRequestException('This incident has no publish target to retry.');
    }
    await this.prisma.client.publishTarget.update({
      where: { id: incident.publishTargetId },
      data: { status: 'SCHEDULED', scheduledAt: new Date() },
    });
    await this.queue.enqueuePublish(incident.publishTargetId);
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

  private async requireIncident(id: string): Promise<void> {
    const exists = await this.prisma.client.incident.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Incident not found.');
  }
}
