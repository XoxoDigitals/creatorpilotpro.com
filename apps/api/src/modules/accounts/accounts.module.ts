import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { PostQuedClient } from './postqued.client';
import { GoogleOAuthService } from './oauth/google.service';
import { MetaOAuthService } from './oauth/meta.service';
import { SystemModule } from '../system/system.module';

/**
 * Accounts module (docs mission §2): real account connections replacing the mock
 * layer. Imports SystemModule for SettingsService (encrypted platform-app creds).
 * CryptoService is global.
 */
@Module({
  imports: [SystemModule],
  controllers: [AccountsController],
  providers: [AccountsService, PostQuedClient, GoogleOAuthService, MetaOAuthService],
  exports: [AccountsService, PostQuedClient, GoogleOAuthService],
})
export class AccountsModule {}
