import { Module } from '@nestjs/common';
import { PublishingController } from './publishing.controller';
import { PublishingService } from './publishing.service';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { ContentModule } from '../content/content.module';

/**
 * Publishing module (docs/06 §4). Imports SchedulingModule for the SlotPlanner;
 * QueueModule (producer) is global. ContentModule for soft-delete on remove.
 */
@Module({
  imports: [SchedulingModule, ContentModule],
  controllers: [PublishingController],
  providers: [PublishingService],
  exports: [PublishingService],
})
export class PublishingModule {}
