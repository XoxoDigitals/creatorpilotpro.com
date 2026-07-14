import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

/** Global secret vault (AES-256-GCM) available to any module. */
@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
