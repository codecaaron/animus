import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import { compareSeamResults, writeJsonFileAtomic } from '../src/seam-baseline';

describe('seam baseline', () => {
  test('reports baseline-only, candidate-only, and changed cases', () => {
    expect(
      compareSeamResults(
        { retained: { css: 'old' }, removed: { css: 'gone' } },
        { retained: { css: 'new' }, added: { css: 'here' } }
      )
    ).toEqual([
      'added: missing from baseline',
      'removed: missing from candidate',
      'retained: output differs',
    ]);
  });

  test('a partial temporary-file write cannot truncate the live oracle', () => {
    const root = mkdtempSync(join(tmpdir(), 'animus-seam-baseline-'));
    const target = join(root, 'seam-baseline.json');
    writeFileSync(target, 'preserved');

    expect(() =>
      writeJsonFileAtomic(
        target,
        { replacement: true },
        {
          writeFileSync(path, _content) {
            writeFileSync(path, 'partial');
            throw new Error('fabricated write failure');
          },
          renameSync,
          rmSync,
        }
      )
    ).toThrow(/fabricated write failure/);
    expect(readFileSync(target, 'utf8')).toBe('preserved');
  });
});
