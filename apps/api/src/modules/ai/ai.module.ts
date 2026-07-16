import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { SystemModule } from '../system/system.module';

/** AI providers, encrypted key pool, prompts, playground (docs/03 Domain 6, docs/05). */
@Module({
  imports: [SystemModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
