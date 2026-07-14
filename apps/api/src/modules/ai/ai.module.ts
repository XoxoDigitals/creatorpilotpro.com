import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/** AI providers & encrypted key pool (docs/03 Domain 6, docs/05 §4). */
@Module({
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
