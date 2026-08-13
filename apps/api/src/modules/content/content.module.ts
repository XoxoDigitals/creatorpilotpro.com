import { Module } from '@nestjs/common';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { AiModule } from '../ai/ai.module';

/**
 * Content module (docs/03 Domain 4). Content items + review queue with
 * state-machine-enforced transitions. PrismaModule is global. AiModule is imported
 * so the title-translation endpoint can call the AI router.
 */
@Module({
  imports: [AiModule],
  controllers: [ContentController],
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
