import { Module } from '@nestjs/common';
import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

/**
 * Sources module (docs/04 §1–3). Watched-source CRUD + bulk import + ingestion
 * review. QueueModule (producer) is global, so no imports are needed.
 */
@Module({
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
