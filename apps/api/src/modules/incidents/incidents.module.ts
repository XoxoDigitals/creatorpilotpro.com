import { Module } from '@nestjs/common';
import { IncidentsController } from './incidents.controller';
import { IncidentsService } from './incidents.service';
import { IdeasModule } from '../ideas/ideas.module';
import { ContentModule } from '../content/content.module';

/**
 * Incidents module (docs/03 Domain 7). Incident center; QueueModule (producer)
 * is global for manual retry re-dispatch. Ideas/Content services handle
 * package and AI-pipeline retries for non-publish incidents.
 */
@Module({
  imports: [IdeasModule, ContentModule],
  controllers: [IncidentsController],
  providers: [IncidentsService],
  exports: [IncidentsService],
})
export class IncidentsModule {}
