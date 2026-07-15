import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, ScheduleSlot } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
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
  scheduled: Array<{ publishTargetId: string; contentItemId: string; title: string; scheduledAt: string }>;
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

  /** Upcoming scheduled targets + the next generated free slots for an account. */
  async upcoming(accountId: string): Promise<UpcomingView> {
    const targets = await this.prisma.client.publishTarget.findMany({
      where: { accountId, status: 'SCHEDULED', scheduledAt: { not: null } },
      include: { contentItem: { select: { title: true } } },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
    });
    const freeSlots = await this.planner.nextSlots(accountId, 10);
    return {
      scheduled: targets.map((t) => ({
        publishTargetId: t.id,
        contentItemId: t.contentItemId,
        title: t.contentItem.title,
        scheduledAt: (t.scheduledAt as Date).toISOString(),
      })),
      freeSlots: freeSlots.map((d) => d.toISOString()),
    };
  }
}
