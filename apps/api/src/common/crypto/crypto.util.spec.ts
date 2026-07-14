import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, loadMasterKey, last4 } from './crypto.util';

// Deterministic 32-byte test key (base64) — never a real MASTER_KEY.
const TEST_KEY_B64 = Buffer.alloc(32, 7).toString('base64');

describe('crypto.util (AES-256-GCM secret vault)', () => {
  const key = loadMasterKey(TEST_KEY_B64);

  it('round-trips a secret through encrypt/decrypt', () => {
    const plaintext = 'sk-super-secret-api-key-1234';
    const enc = encryptSecret(plaintext, key);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain(plaintext);
    expect(decryptSecret(enc, key)).toBe(plaintext);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same', key);
    const b = encryptSecret('same', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('same');
    expect(decryptSecret(b, key)).toBe('same');
  });

  it('detects tampering with the ciphertext (auth tag fails)', () => {
    const enc = encryptSecret('tamper-me', key);
    const parts = enc.split(':');
    // Flip a byte in the ciphertext segment.
    const data = Buffer.from(parts[3]!, 'base64');
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[3] = data.toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
  });

  it('detects a wrong key', () => {
    const enc = encryptSecret('secret', key);
    const otherKey = loadMasterKey(Buffer.alloc(32, 9).toString('base64'));
    expect(() => decryptSecret(enc, otherKey)).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => decryptSecret('not-a-valid-envelope', key)).toThrow();
    expect(() => decryptSecret('v2:a:b:c', key)).toThrow();
  });

  it('rejects an invalid master key', () => {
    expect(() => loadMasterKey(undefined)).toThrow();
    expect(() => loadMasterKey('too-short')).toThrow();
  });

  it('accepts a hex-encoded master key', () => {
    const hexKey = loadMasterKey('00'.repeat(32));
    const enc = encryptSecret('hi', hexKey);
    expect(decryptSecret(enc, hexKey)).toBe('hi');
  });

  it('last4 returns the trailing 4 chars', () => {
    expect(last4('abcdef1234')).toBe('1234');
  });
});
