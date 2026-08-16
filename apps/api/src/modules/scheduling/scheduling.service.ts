import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type ScheduleSlot } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveTargetCopy } from '../publishing/publish-target.view';
import { SlotPlannerService } from './slot-planner.service';
import type { CreateSlotDto, PatchSlotDto } from './dto/schedule.dto';

export interface ScheduleSlotView {
  id: string;
  accountId: string;
  rule: unknown;
  timeWindows: unknown;
  active: boolean;
  createdAt: string;
}

function toSlotView(s: ScheduleSlot): ScheduleSlotView {
  return {
    id: s.id,
    accountId: s.accountId,
    rule: s.rule,
    timeWindows: s.timeWindows,
    active: s.active,
    createdAt: s.createdAt.toISOString(),
  };
}

export interface UpcomingView {
  scheduled: Array<{
    publishTargetId: string;
    contentItemId: string;
    title: string;
    scheduledAt: string;
    status: 'PENDING' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'DRAFT';
  }>;
  /** Failed / draft-with-error targets (publish moved failures to DRAFT). */
  failed: Array<{
    publishTargetId: string;
    contentItemId: string;
    title: string;
    scheduledAt: string | null;
    status: 'PENDING' | 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'DRAFT';
    lastError: unknown;
    updatedAt: string;
  }>;
  /** Most recent published posts for this account. */
  published: Array<{
    publishTargetId: string;
    contentItemId: string;
    title: string;
    publishedAt: string | null;
    scheduledAt: string | null;
    status: 'PUBLISHED';
  }>;
  freeSlots: string[];
}

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planner: SlotPlannerService,
  ) {}

  async listSlots(accountId?: string): Promise<ScheduleSlotView[]> {
    const slots = await this.prisma.client.scheduleSlot.findMany({
      where: accountId ? { accountId } : {},
      orderBy: { createdAt: 'asc' },
    });
    return slots.map(toSlotView);
  }

  async createSlot(dto: CreateSlotDto): Promise<ScheduleSlotView> {
    const slot = await this.prisma.client.scheduleSlot.create({
      data: {
        accountId: dto.accountId,
        rule: dto.rule as Prisma.InputJsonValue,
        timeWindows: dto.timeWindows as Prisma.InputJsonValue,
        active: dto.active,
      },
    });
    return toSlotView(slot);
  }

  async patchSlot(id: string, dto: PatchSlotDto): Promise<ScheduleSlotView> {
    const existing = await this.prisma.client.scheduleSlot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Schedule slot not found.');
    const slot = await this.prisma.client.scheduleSlot.update({
      where: { id },
      data: {
        ...(dto.rule !== undefined ? { rule: dto.rule as Prisma.InputJsonValue } : {}),
        ...(dto.timeWindows !== undefined
          ? { timeWindows: dto.timeWindows as Prisma.InputJsonValue }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
    return toSlotView(slot);
  }

  async deleteSlot(id: string): Promise<{ id: string }> {
    const existing = await this.prisma.client.scheduleSlot.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Schedule slot not found.');
    await this.prisma.client.scheduleSlot.delete({ where: { id } });
    return { id };
  }

  /** Upcoming scheduled targets + failed + recent published + next free slots. */
  async upcoming(accountId: string): Promise<UpcomingView> {
    const [targets, failedRows, publishedRows, freeSlots] = await Promise.all([
      this.prisma.client.publishTarget.findMany({
        where: {
          accountId,
          status: 'SCHEDULED',
          scheduledAt: { not: null },
          contentItem: { deletedAt: null },
        },
        include: {
          contentItem: { select: { title: true, currentStep: true } },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 100,
      }),
      this.prisma.client.publishTarget.findMany({
        where: {
          accountId,
          contentItem: { deletedAt: null },
          OR: [
            { status: 'FAILED' },
            { status: 'DRAFT', lastError: { not: Prisma.DbNull } },
          ],
        },
        include: {
          contentItem: { select: { title: true, currentStep: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.publishTarget.findMany({
        where: { accountId, status: 'PUBLISHED', contentItem: { deletedAt: null } },
        include: {
          contentItem: { select: { title: true, currentStep: true } },
        },
        orderBy: { publishedAt: 'desc' },
        take: 10,
      }),
      this.planner.nextSlots(accountId, 10),
    ]);

    const mapCopy = (
      t: (typeof targets)[number],
    ): { title: string } =>
      resolveTargetCopy(t.metadataOverride, t.contentItem.currentStep, t.contentItem.title);

    return {
      scheduled: targets.map((t) => {
        const copy = mapCopy(t);
        return {
          publishTargetId: t.id,
          contentItemId: t.contentItemId,
          title: copy.title,
          scheduledAt: (t.scheduledAt as Date).toISOString(),
          status: t.status,
        };
      }),
      failed: failedRows.map((t) => {
        const copy = mapCopy(t);
        return {
          publishTargetId: t.id,
          contentItemId: t.contentItemId,
          title: copy.title,
          scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
          status: t.status,
          lastError: t.lastError ?? null,
          updatedAt: t.updatedAt.toISOString(),
        };
      }),
      published: publishedRows.map((t) => {
        const copy = mapCopy(t);
        return {
          publishTargetId: t.id,
          contentItemId: t.contentItemId,
          title: copy.title,
          publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
          scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
          status: 'PUBLISHED' as const,
        };
      }),
      freeSlots: freeSlots.map((d) => d.toISOString()),
    };
  }
}
