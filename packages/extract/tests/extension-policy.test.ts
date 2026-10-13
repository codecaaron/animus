import { describe, expect, it } from 'vitest';

import { builtInExtensionPolicy } from '../pipeline/host-extensions';
import { probeEnginePrerequisites } from './engine-prerequisites';

const prerequisites = probeEnginePrerequisites();
const suite = prerequisites.ok ? describe : describe.skip;

suite('the built-in extension policy', () => {
  /** Contract: the one extension policy, as the system loader holds it in
   *  `extension_policy.json` and every TypeScript caller reads it. A change
   *  to which files a specifier names, for evaluation, analysis and
   *  discovery alike, shows here in review. */
  it('is the system loader’s order', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../index-v2.js');
    expect(JSON.parse(native.builtInExtensionPolicy())).toEqual({
      ...builtInExtensionPolicy(),
      resolverVersion: undefined,
    });
    expect(builtInExtensionPolicy()).toEqual({
      appended: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
      nodeNext: [
        ['.js', ['.ts', '.tsx', '.jsx']],
        ['.jsx', ['.tsx']],
        ['.mjs', ['.mts']],
        ['.cjs', ['.cts']],
      ],
      alias: [],
      resolverVersion: 'built-in',
    });
  });
});
