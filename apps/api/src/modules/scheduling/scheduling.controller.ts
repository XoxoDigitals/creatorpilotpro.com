import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SchedulingService, type ScheduleSlotView, type UpcomingView } from './scheduling.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createSlotSchema,
  patchSlotSchema,
  type CreateSlotDto,
  type PatchSlotDto,
} from './dto/schedule.dto';

/**
 * Scheduling module (docs/06 §3). Per-account slot rules + the slot planner.
 * OWNER/ADMIN/REVIEWER manage slots on accounts they can access.
 */
@ApiTags('scheduling')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('schedule')
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('slots')
  listSlots(@Query('accountId') accountId?: string): Promise<ScheduleSlotView[]> {
    return this.scheduling.listSlots(accountId);
  }

  @Post('slots')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('schedule.slot.create', 'ScheduleSlot')
  createSlot(@Body(new ZodBody(createSlotSchema)) body: CreateSlotDto): Promise<ScheduleSlotView> {
    return this.scheduling.createSlot(body);
  }

  @Patch('slots/:id')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('schedule.slot.update', 'ScheduleSlot')
  patchSlot(
    @Param('id') id: string,
    @Body(new ZodBody(patchSlotSchema)) body: PatchSlotDto,
  ): Promise<ScheduleSlotView> {
    return this.scheduling.patchSlot(id, body);
  }

  @Delete('slots/:id')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('schedule.slot.delete', 'ScheduleSlot')
  deleteSlot(@Param('id') id: string): Promise<{ id: string }> {
    return this.scheduling.deleteSlot(id);
  }

  @Get('upcoming')
  upcoming(@Query('accountId') accountId: string): Promise<UpcomingView> {
    return this.scheduling.upcoming(accountId);
  }
}
