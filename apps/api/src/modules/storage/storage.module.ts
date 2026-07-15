import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';

/**
 * Storage module (docs/02 §6). Manual upload → local hot tier → Asset row.
 * PrismaModule + ConfigModule are global.
 */
@Module({
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
