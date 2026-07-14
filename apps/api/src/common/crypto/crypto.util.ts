import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption helper for secrets at rest (docs/03 cross-cutting,
 * docs/08 §2). Every stored secret — AI keys, OAuth tokens, SMTP/Telegram
 * creds — is encrypted with the server-only MASTER_KEY.
 *
 * Serialized format: `v1:<ivB64>:<tagB64>:<ciphertextB64>` (versioned so the
 * scheme can evolve). A fresh random 12-byte IV is used per value.
 */

const FORMAT_VERSION = 'v1';
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32; // AES-256

/**
 * Decode the MASTER_KEY env into a 32-byte buffer. Accepts base64 or hex.
 * Throws loudly if missing/invalid so we never silently encrypt with a weak key.
 */
export function loadMasterKey(raw: string | undefined): Buffer {
  if (!raw || raw.trim() === '') {
    throw new Error('MASTER_KEY is not set — cannot encrypt/decrypt secrets.');
  }
  const value = raw.trim();

  // Try base64 first, then hex.
  let key: Buffer | undefined;
  const b64 = Buffer.from(value, 'base64');
  if (b64.length === KEY_BYTES) {
    key = b64;
  } else if (/^[0-9a-fA-F]+$/.test(value) && value.length === KEY_BYTES * 2) {
    key = Buffer.from(value, 'hex');
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      `MASTER_KEY must decode to ${KEY_BYTES} bytes (base64 or hex). ` +
        `Generate one with: openssl rand -base64 32`,
    );
  }
  return key;
}

/** Encrypt a UTF-8 plaintext into the `v1:iv:tag:ciphertext` envelope. */
export function encryptSecret(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    FORMAT_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** Decrypt a `v1:iv:tag:ciphertext` envelope. Throws on tamper or bad key. */
export function decryptSecret(serialized: string, masterKey: Buffer): string {
  const parts = serialized.split(':');
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error('Malformed ciphertext envelope.');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const data = Buffer.from(dataB64!, 'base64');

  const decipher = createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag); // GCM auth tag — decryption throws if data/tag tampered
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Last 4 chars of a secret, kept in clear for UI display (docs/08 §2). */
export function last4(secret: string): string {
  return secret.slice(-4);
}
