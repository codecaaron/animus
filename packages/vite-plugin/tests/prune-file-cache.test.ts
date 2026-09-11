import { join } from 'path';
import { describe, expect, test } from 'vitest';

import { pruneFileCache } from '../src/context';

/** Cache keying for the dev delete path: a key the prune misses keeps the
 *  deleted file in every later re-analysis. */

const ROOT = join('/', 'repo', 'e2e', 'app');

function makeCache(
  paths: string[]
): Map<string, { hash: string; source: string }> {
  return new Map(paths.map((p) => [p, { hash: 'h', source: 'src' }]));
}

describe('pruneFileCache', () => {
  test('removes the plain rootDir-relative key', () => {
    const cache = makeCache([
      join('src', 'Button.tsx'),
      join('src', 'App.tsx'),
    ]);

    const removed = pruneFileCache(
      cache,
      ROOT,
      join(ROOT, 'src', 'Button.tsx')
    );

    expect(removed).toBe(true);
    expect([...cache.keys()]).toEqual([join('src', 'App.tsx')]);
  });

  test('removes the raw MDX original key', () => {
    // Parser-ready `.tsx` children live in the projection cache; the watcher
    // deletion removes the original `.mdx` owner.
    const cache = makeCache([join('src', 'Doc.mdx')]);

    const removed = pruneFileCache(cache, ROOT, join(ROOT, 'src', 'Doc.mdx'));

    expect(removed).toBe(true);
    expect(cache.size).toBe(0);
  });

  test('removes external package entries keyed with .. segments', () => {
    // External DS package sources live outside rootDir, so their cache keys
    // are relative paths that climb out of it.
    const externalKey = join('..', '..', 'packages', 'ds', 'src', 'Card.tsx');
    const cache = makeCache([externalKey]);

    const removed = pruneFileCache(
      cache,
      ROOT,
      join('/', 'repo', 'packages', 'ds', 'src', 'Card.tsx')
    );

    expect(removed).toBe(true);
    expect(cache.size).toBe(0);
  });

  test('a miss is a no-op and reports false', () => {
    const cache = makeCache([join('src', 'Button.tsx')]);

    const removed = pruneFileCache(cache, ROOT, join(ROOT, 'src', 'Never.tsx'));

    expect(removed).toBe(false);
    expect([...cache.keys()]).toEqual([join('src', 'Button.tsx')]);
  });

  test('removes at most one key — the plain form wins over the MDX form', () => {
    const cache = makeCache([
      join('src', 'Doc.mdx'),
      join('src', 'Doc.mdx.tsx'),
    ]);

    const removed = pruneFileCache(cache, ROOT, join(ROOT, 'src', 'Doc.mdx'));

    expect(removed).toBe(true);
    expect([...cache.keys()]).toEqual([join('src', 'Doc.mdx.tsx')]);
  });
});
