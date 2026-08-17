import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { SystemModule } from '../system/system.module';
import { AccountsModule } from '../accounts/accounts.module';

/**
 * Storage module (docs/02 §6). Manual upload → local hot tier → Asset row.
 * PrismaModule + ConfigModule are global. SystemModule provides SettingsService
 * for encrypted Google Drive credentials. AccountsModule exports GoogleOAuthService
 * so Drive Connect can reuse the YouTube/Platform Apps Google client.
 */
@Module({
  imports: [SystemModule, AccountsModule],
  controllers: [StorageController],
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
