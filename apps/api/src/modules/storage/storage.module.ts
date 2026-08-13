import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { SystemModule } from '../system/system.module';

/**
 * Storage module (docs/02 §6). Manual upload → local hot tier → Asset row.
 * PrismaModule + ConfigModule are global. SystemModule provides SettingsService
 * for encrypted Google Drive credentials.
 */
@Module({
  imports: [SystemModule],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
