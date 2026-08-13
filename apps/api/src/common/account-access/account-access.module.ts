import { Global, Module } from '@nestjs/common';
import { AccountAccessService } from './account-access.service';

/** Global account-ACL helpers used by users, accounts, and the access guard. */
@Global()
@Module({
  providers: [AccountAccessService],
  exports: [AccountAccessService],
})
export class AccountAccessModule {}
