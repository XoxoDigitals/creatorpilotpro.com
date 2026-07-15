import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope shared by apps/api and apps/worker so both encrypt/decrypt
 * secrets identically (docs/03 cross-cutting, docs/08 §2). Byte-compatible with
 * the API's CryptoService: `v1:<ivB64>:<tagB64>:<ciphertextB64>`.
 */

const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function loadMasterKey(raw: string | undefined): Buffer {
  if (!raw || raw.trim() === '') {
    throw new Error('MASTER_KEY is not set — cannot encrypt/decrypt secrets.');
  }
  const value = raw.trim();
  let key: Buffer | undefined;
  const b64 = Buffer.from(value, 'base64');
  if (b64.length === KEY_BYTES) {
    key = b64;
  } else if (/^[0-9a-fA-F]+$/.test(value) && value.length === KEY_BYTES * 2) {
    key = Buffer.from(value, 'hex');
  }
  if (!key || key.length !== KEY_BYTES) {
    throw new Error(`MASTER_KEY must decode to ${KEY_BYTES} bytes (base64 or hex).`);
  }
  return key;
}

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
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
