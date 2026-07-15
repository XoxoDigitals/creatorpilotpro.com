import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';

/**
 * Incidents module (docs/03 Domain 7). Incident center; QueueModule (producer)
 * is global for manual retry re-dispatch.
 */
@Module({
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
