import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { GoogleOAuthService } from './oauth/google.service';
import { MetaOAuthService } from './oauth/meta.service';
import { TikTokOAuthService } from './oauth/tiktok.service';
import { SystemModule } from '../system/system.module';

/**
 * Accounts module (docs mission §2): direct-platform connections.
 * Imports SystemModule for SettingsService (encrypted platform-app creds).
 * CryptoService is global.
 */
@Module({
  imports: [SystemModule],
  controllers: [AccountsController],
  providers: [AccountsService, GoogleOAuthService, MetaOAuthService, TikTokOAuthService],
  exports: [AccountsService, GoogleOAuthService, TikTokOAuthService],
})
export class AccountsModule {}
