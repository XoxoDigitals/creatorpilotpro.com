import { Module } from '@nestjs/common';
import { CompetitorsController } from './competitors.controller';
import { CompetitorsService } from './competitors.service';

/**
 * Competitors module (docs/04 Phase 4). Competitor-channel CRUD, manual poll
 * trigger, and fetched-video listing. QueueModule (producer) is global.
 */
@Module({
  controllers: [CompetitorsController],
  providers: [CompetitorsService],
  exports: [CompetitorsService],
})
export class CompetitorsModule {}
