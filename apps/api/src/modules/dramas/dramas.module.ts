import { Module } from '@nestjs/common';
import { DramasController } from './dramas.controller';
import { DramasService } from './dramas.service';

/**
 * Dramas module (Phase 4). Drama series CRUD, bible generation, episode
 * generation on demand. QueueModule (producer) is global, so no imports needed.
 */
@Module({
  controllers: [DramasController],
  providers: [DramasService],
  exports: [DramasService],
})
export class DramasModule {}
