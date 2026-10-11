import { describe, expect, test } from 'vitest';

import { builtInAssetClassification } from '../pipeline/host-assets';
import { hostExpansions } from '../pipeline/host-expansions';

import type { ListedLoad } from '../pipeline/host-expansions';

describe('hostExpansions', () => {
  // Contract: a query selects how the host loads a file, which can be other
  // code than the module (a plugin transforms `p.ts?mutate`), so a queried
  // file is never the analysed module: opaque where the host loads it as a
  // value, otherwise unanalysed, keyed with its query.
  test('a queried expansion file is never the analysed module', () => {
    const load: ListedLoad = {
      importer: 'src/load.ts',
      start: 0,
      kind: 'glob',
      args: null,
    };
    const [expansion] = hostExpansions(
      [load],
      '/root',
      new Set(['src/p.ts']),
      {
        expand: () => [
          { path: 'src/p.ts', query: '' },
          { path: 'src/p.ts', query: '?mutate' },
          { path: 'src/p.ts', query: '?raw' },
        ],
      },
      builtInAssetClassification('noHost').isAsset
    );
    expect(expansion?.files).toEqual([
      { path: 'src/p.ts', status: 'analysed' },
      { path: 'src/p.ts?mutate', status: 'unanalysed' },
      { path: 'src/p.ts?raw', status: 'opaque' },
    ]);
  });
});
