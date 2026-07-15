import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';

/**
 * Content module (docs/03 Domain 4). Content items + review queue with
 * state-machine-enforced transitions. PrismaModule is global.
 */
@Module({
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
