import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Role, WorkerTaskStatus } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { toWorkerTaskView, type WorkerStatsView, type WorkerTaskView } from './tasks.view';
import type { CreateTaskDto, TaskListQueryDto } from './dto/tasks.dto';

const WORKER_INCLUDE = { worker: { select: { name: true } } } as const;

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // List & get
  // ---------------------------------------------------------------------------

  async list(filters: TaskListQueryDto): Promise<WorkerTaskView[]> {
    const where: Prisma.WorkerTaskWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.workerId) where.workerId = filters.workerId;
    if (filters.accountId) where.accountId = filters.accountId;

    const tasks = await this.prisma.client.workerTask.findMany({
      where,
      include: WORKER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return tasks.map(toWorkerTaskView);
  }

  async listForWorker(workerId: string): Promise<WorkerTaskView[]> {
    const tasks = await this.prisma.client.workerTask.findMany({
      where: { workerId },
      include: WORKER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return tasks.map(toWorkerTaskView);
  }

  async get(id: string): Promise<WorkerTaskView> {
    const task = await this.prisma.client.workerTask.findFirst({
      where: { id },
      include: { ...WORKER_INCLUDE, brief: true, episode: true },
    });
    if (!task) throw new NotFoundException('Task not found.');
    return toWorkerTaskView(task);
  }

  // ---------------------------------------------------------------------------
  // Access control
  // ---------------------------------------------------------------------------

  async assertWorkerAccess(taskId: string, actorId: string, actorRole: Role): Promise<void> {
    // Reviewers only see tasks assigned to them; Owner/Admin see all.
    if (actorRole === 'REVIEWER') {
      const task = await this.prisma.client.workerTask.findFirst({
        where: { id: taskId },
        select: { workerId: true },
      });
      if (!task) throw new NotFoundException('Task not found.');
      if (task.workerId !== actorId) {
        throw new ForbiddenException('You can only access your own tasks.');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Create & assign
  // ---------------------------------------------------------------------------

  async create(dto: CreateTaskDto): Promise<WorkerTaskView> {
    // Assignees are REVIEWER users (production board assignees — not a separate role).
    const worker = await this.prisma.client.user.findFirst({
      where: { id: dto.workerId, role: 'REVIEWER' },
      select: { id: true },
    });
    if (!worker) throw new BadRequestException('Assignee not found or user is not a REVIEWER.');

    // Verify account exists
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: dto.accountId, deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new NotFoundException(`Account ${dto.accountId} not found.`);

    const data: Prisma.WorkerTaskCreateInput = {
      title: dto.title,
      status: 'ASSIGNED',
      worker: { connect: { id: dto.workerId } },
      account: { connect: { id: dto.accountId } },
    };

    if (dto.briefId) {
      const brief = await this.prisma.client.productionBrief.findFirst({
        where: { id: dto.briefId },
        select: { id: true, ideaId: true },
      });
      if (!brief) throw new NotFoundException('Production brief not found.');
      data.brief = { connect: { id: dto.briefId } };
      data.idea = { connect: { id: brief.ideaId } };
    }

    if (dto.episodeId) {
      const episode = await this.prisma.client.dramaEpisode.findFirst({
        where: { id: dto.episodeId },
        select: { id: true },
      });
      if (!episode) throw new NotFoundException('Drama episode not found.');
      data.episode = { connect: { id: dto.episodeId } };
    }

    const task = await this.prisma.client.workerTask.create({
      data,
      include: WORKER_INCLUDE,
    });
    return toWorkerTaskView(task);
  }

  async assign(id: string, workerId: string): Promise<WorkerTaskView> {
    const task = await this.prisma.client.workerTask.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!task) throw new NotFoundException('Task not found.');

    const worker = await this.prisma.client.user.findFirst({
      where: { id: workerId, role: 'REVIEWER' },
      select: { id: true },
    });
    if (!worker) throw new BadRequestException('Assignee not found or user is not a REVIEWER.');

    const updated = await this.prisma.client.workerTask.update({
      where: { id },
      data: { workerId, status: 'ASSIGNED', assignedAt: new Date() },
      include: WORKER_INCLUDE,
    });
    return toWorkerTaskView(updated);
  }

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  async start(id: string, actorId: string): Promise<WorkerTaskView> {
    const task = await this.prisma.client.workerTask.findFirst({
      where: { id },
      include: WORKER_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found.');
    this.assertStatus(task.status, ['ASSIGNED', 'REVISION_REQUESTED'], 'start');
    if (task.workerId !== actorId) {
      throw new ForbiddenException('Only the assigned worker can start this task.');
    }

    const updated = await this.prisma.client.workerTask.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
      include: WORKER_INCLUDE,
    });

    // Side effects: update idea / episode status
    if (task.ideaId) {
      await this.prisma.client.idea.update({
        where: { id: task.ideaId },
        data: { status: 'IN_PRODUCTION' },
      });
    }
    if (task.episodeId) {
      await this.prisma.client.dramaEpisode.update({
        where: { id: task.episodeId },
        data: { status: 'IN_PRODUCTION' },
      });
    }

    return toWorkerTaskView(updated);
  }

  async markUploaded(id: string, actorId: string): Promise<WorkerTaskView> {
    const task = await this.prisma.client.workerTask.findFirst({
      where: { id },
      include: WORKER_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found.');
    this.assertStatus(task.status, ['IN_PROGRESS', 'REVISION_REQUESTED'], 'upload');
    if (task.workerId !== actorId) {
      throw new ForbiddenException('Only the assigned worker can upload to this task.');
    }

    const updated = await this.prisma.client.workerTask.update({
      where: { id },
      data: { status: 'UPLOADED', uploadedAt: new Date() },
      include: WORKER_INCLUDE,
    });
    return toWorkerTaskView(updated);
  }

  async requestRevision(id: string, note: string): Promise<WorkerTaskView> {
    const task = await this.prisma.client.workerTask.findFirst({
      where: { id },
      include: WORKER_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found.');
    this.assertStatus(task.status, ['UPLOADED'], 'request revision');

    const updated = await this.prisma.client.workerTask.update({
      where: { id },
      data: {
        status: 'REVISION_REQUESTED',
        revisionNotes: { push: note },
      },
      include: WORKER_INCLUDE,
    });
    return toWorkerTaskView(updated);
  }

  async accept(id: string): Promise<WorkerTaskView> {
    const task = await this.prisma.client.workerTask.findFirst({
      where: { id },
      include: WORKER_INCLUDE,
    });
    if (!task) throw new NotFoundException('Task not found.');
    this.assertStatus(task.status, ['UPLOADED'], 'accept');

    // Create a ContentItem for the accepted work
    const contentType = task.episodeId ? 'DRAMA_EPISODE' : 'WORKER_PRODUCED';
    const contentItem = await this.prisma.client.contentItem.create({
      data: {
        title: task.title,
        type: contentType,
        status: 'REVIEW_PENDING',
        ...(task.ideaId ? { ideaId: task.ideaId } : {}),
        ...(task.episodeId ? { episodeId: task.episodeId } : {}),
      },
    });

    const updated = await this.prisma.client.workerTask.update({
      where: { id },
      data: { status: 'DONE', contentItemId: contentItem.id },
      include: WORKER_INCLUDE,
    });

    // Side effects: update idea / episode status
    if (task.ideaId) {
      await this.prisma.client.idea.update({
        where: { id: task.ideaId },
        data: { status: 'UPLOADED' },
      });
    }
    if (task.episodeId) {
      await this.prisma.client.dramaEpisode.update({
        where: { id: task.episodeId },
        data: { status: 'UPLOADED' },
      });
    }

    return toWorkerTaskView(updated);
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async getStats(workerId: string): Promise<WorkerStatsView> {
    const tasks = await this.prisma.client.workerTask.findMany({
      where: { workerId },
      select: { status: true, assignedAt: true, uploadedAt: true, revisionNotes: true },
    });

    const totalAssigned = tasks.length;
    const doneTasks = tasks.filter((t) => t.status === 'DONE');
    const totalCompleted = doneTasks.length;

    // Average turnaround: uploadedAt - assignedAt for DONE tasks that have both dates
    let averageTurnaroundHours: number | null = null;
    const turnarounds = doneTasks
      .filter((t) => t.uploadedAt != null)
      .map((t) => (t.uploadedAt!.getTime() - t.assignedAt.getTime()) / (1000 * 60 * 60));
    if (turnarounds.length > 0) {
      averageTurnaroundHours =
        Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 100) / 100;
    }

    // Revision rate: tasks that had any revision notes / total completed
    const revisedCount = totalCompleted > 0
      ? doneTasks.filter((t) => t.revisionNotes.length > 0).length
      : 0;
    const revisionRate = totalCompleted > 0 ? Math.round((revisedCount / totalCompleted) * 100) / 100 : 0;

    return { totalAssigned, totalCompleted, averageTurnaroundHours, revisionRate };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private assertStatus(
    current: WorkerTaskStatus,
    allowed: WorkerTaskStatus[],
    action: string,
  ): void {
    if (!allowed.includes(current)) {
      throw new BadRequestException(
        `Cannot ${action} a task in ${current} status. Allowed: ${allowed.join(', ')}.`,
      );
    }
  }
}
