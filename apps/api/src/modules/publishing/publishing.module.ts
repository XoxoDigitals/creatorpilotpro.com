import { Module } from '@nestjs/common';
import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';
import { SchedulingModule } from '../scheduling/scheduling.module';

/**
 * Publishing module (docs/06 §4). Imports SchedulingModule for the SlotPlanner;
 * QueueModule (producer) is global.
 */
@Module({
  imports: [SchedulingModule],
  controllers: [PublishingController],
  providers: [PublishingService],
  exports: [PublishingService],
})
export class PublishingModule {}
