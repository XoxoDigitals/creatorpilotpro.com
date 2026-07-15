import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TieredStorage, md5File, hotTierPath } from './tiered-storage.js';

function md5Hex(data: Buffer | string): string {
  return createHash('md5').update(data).digest('hex');
}

/** Write `data` to a fresh temp file and return its absolute path + a cleanup fn. */
async function tempFile(data: Buffer | string): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'scp-storage-'));
  const path = join(dir, 'asset.bin');
  await writeFile(path, data);
  return { path, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test('md5File computes md5 and byte length matching node:crypto', async () => {
  const data = Buffer.from('the quick brown fox renders a reel');
  const { path, cleanup } = await tempFile(data);
  try {
    const { md5, bytes } = await md5File(path);
    assert.equal(md5, md5Hex(data));
    assert.equal(bytes, data.byteLength);
  } finally {
    await cleanup();
  }
});

test('putLocal happy path registers a file already written to disk', async () => {
  const data = Buffer.from('final render bytes');
  const { path, cleanup } = await tempFile(data);
  try {
    const storage = new TieredStorage();
    const obj = await storage.putLocal({
      destPath: path,
      bytes: data.byteLength,
      md5: md5Hex(data),
    });
    assert.deepEqual(obj, {
      localPath: path,
      md5: md5Hex(data),
      bytes: data.byteLength,
      state: 'LOCAL',
    });
  } finally {
    await cleanup();
  }
});

test('putLocal rejects on md5 mismatch', async () => {
  const data = Buffer.from('final render bytes');
  const { path, cleanup } = await tempFile(data);
  try {
    const storage = new TieredStorage();
    await assert.rejects(
      () =>
        storage.putLocal({
          destPath: path,
          bytes: data.byteLength,
          md5: md5Hex('a different payload'),
        }),
      /md5 mismatch/,
    );
  } finally {
    await cleanup();
  }
});

test('putLocal rejects on byte-length mismatch', async () => {
  const data = Buffer.from('final render bytes');
  const { path, cleanup } = await tempFile(data);
  try {
    const storage = new TieredStorage();
    await assert.rejects(
      () =>
        storage.putLocal({
          destPath: path,
          bytes: data.byteLength + 1,
          md5: md5Hex(data),
        }),
      /byte-length mismatch/,
    );
  } finally {
    await cleanup();
  }
});

test('restore returns LOCAL via the fast path when a valid local copy exists', async () => {
  const data = Buffer.from('local hot-tier copy');
  const { path, cleanup } = await tempFile(data);
  try {
    const storage = new TieredStorage();
    const restored = await storage.restore(
      { localPath: path, md5: md5Hex(data), bytes: data.byteLength, state: 'BOTH' },
      path,
    );
    assert.equal(restored.state, 'LOCAL');
    assert.equal(restored.localPath, path);
    assert.equal(restored.md5, md5Hex(data));
  } finally {
    await cleanup();
  }
});

test('restore defers to Drive (throws) when no valid local copy exists', async () => {
  const storage = new TieredStorage();
  await assert.rejects(
    () =>
      storage.restore(
        { localPath: join(tmpdir(), 'does-not-exist-scp.bin'), md5: 'deadbeef', bytes: 1, state: 'EVICTED' },
        join(tmpdir(), 'dest.bin'),
      ),
    /deferred to the Phase-2/,
  );
});

test('hotTierPath builds the canonical layout and lower-cases kind', () => {
  const p = hotTierPath('/data', 'itm_123', 'FINAL', 'out.mp4');
  assert.equal(p, join('/data', 'items', 'itm_123', 'final', 'out.mp4'));
});
