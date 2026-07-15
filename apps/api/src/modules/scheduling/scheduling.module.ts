import { Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';
import { SlotPlannerService } from './slot-planner.service';

/**
 * Scheduling module (docs/06 §3). Slot rules + planner. SlotPlannerService is
 * exported so the publishing module can resolve QUEUE_SLOT scheduled times.
 */
@Module({
  controllers: [SchedulingController],
  providers: [SchedulingService, SlotPlannerService],
  exports: [SchedulingService, SlotPlannerService],
})
export class SchedulingModule {}
