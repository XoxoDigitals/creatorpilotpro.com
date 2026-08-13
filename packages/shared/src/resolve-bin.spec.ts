import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isResolvedBinaryPath, resolveCliBinary } from './resolve-bin.js';

const ENV = 'SCP_TEST_BIN_PATH';

describe('resolveCliBinary', () => {
  const cleanup: string[] = [];

  afterEach(() => {
    delete process.env[ENV];
    for (const d of cleanup) rmSync(d, { recursive: true, force: true });
    cleanup.length = 0;
  });

  function fakeTool(name: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), 'scp-bin-'));
    cleanup.push(dir);
    const path = join(dir, name);
    writeFileSync(path, '');
    return { dir, path };
  }

  it('uses env var when the file exists', () => {
    const { path } = fakeTool('scp-test-tool');
    process.env[ENV] = path;
    expect(resolveCliBinary({ names: ['scp-test-tool'], envVar: ENV })).toBe(path);
  });

  it('ignores a missing env path and searches extraDirs', () => {
    process.env[ENV] = join(tmpdir(), 'scp-missing-bin-does-not-exist');
    const { dir, path } = fakeTool('scp-test-tool-b');
    expect(
      resolveCliBinary({
        names: ['scp-test-tool-b'],
        envVar: ENV,
        extraDirs: [dir],
      }),
    ).toBe(path);
  });

  it('returns the bare name when nothing is found', () => {
    expect(
      resolveCliBinary({
        names: ['scp-definitely-not-installed-xyz'],
        extraDirs: [],
      }),
    ).toBe('scp-definitely-not-installed-xyz');
  });

  it('isResolvedBinaryPath is true only for existing files', () => {
    const { path } = fakeTool('scp-test-tool-c');
    expect(isResolvedBinaryPath(path)).toBe(true);
    expect(isResolvedBinaryPath('ffmpeg')).toBe(false);
  });
});
