import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { pruneStaleAssets } from '../../extract/session/extraction-session';

/**
 * `.animus/assets/` sync (asset() delivery): copies are content-addressed
 * and never overwritten, so every pass prunes whatever the current build
 * did not produce — superseded revisions and copies of removed references
 * alike — while tolerating a missing directory and per-entry failures.
 */

let scratch: string | null = null;

function assetsDir(files: string[]): string {
  scratch = mkdtempSync(join(tmpdir(), 'animus-prune-'));
  const dir = join(scratch, 'assets');
  mkdirSync(dir);
  for (const file of files) {
    writeFileSync(join(dir, file), file);
  }
  return dir;
}

afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = null;
});

describe('pruneStaleAssets', () => {
  test('removes superseded revisions, keeps the current set', () => {
    const dir = assetsDir([
      'inter.aaaa1111.woff2',
      'inter.bbbb2222.woff2',
      'mono.cccc3333.woff2',
    ]);

    pruneStaleAssets(dir, new Set(['inter.bbbb2222.woff2']));

    expect(readdirSync(dir).sort()).toEqual(['inter.bbbb2222.woff2']);
  });

  test('an empty expected set clears every leftover copy', () => {
    const dir = assetsDir(['inter.aaaa1111.woff2']);

    pruneStaleAssets(dir, new Set());

    expect(readdirSync(dir)).toEqual([]);
  });

  test('a missing directory is a no-op', () => {
    expect(() =>
      pruneStaleAssets(join(tmpdir(), 'animus-prune-does-not-exist'), new Set())
    ).not.toThrow();
  });

  test('an unexpected subdirectory is tolerated, files beside it still prune', () => {
    const dir = assetsDir(['inter.aaaa1111.woff2']);
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'keep.txt'), 'x');

    pruneStaleAssets(dir, new Set());

    expect(readdirSync(dir)).toEqual(['nested']);
  });
});
