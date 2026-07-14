import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret, encryptSecret, last4, loadMasterKey } from './crypto.util';

/**
 * Injectable vault: encrypts/decrypts secrets with the MASTER_KEY from env.
 * The key is decoded once at construction so a bad/missing key fails fast.
 */
@Injectable()
export class CryptoService {
  private readonly masterKey: Buffer;

  constructor(config: ConfigService) {
    this.masterKey = loadMasterKey(config.get<string>('masterKey'));
  }

  encrypt(plaintext: string): string {
    return encryptSecret(plaintext, this.masterKey);
  }

  decrypt(serialized: string): string {
    return decryptSecret(serialized, this.masterKey);
  }

  last4(secret: string): string {
    return last4(secret);
  }
}
