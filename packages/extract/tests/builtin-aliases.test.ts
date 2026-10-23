import { BUILT_IN_CONDITIONS, BUILT_IN_SELECTORS } from '@animus-ui/system';
import { describe, expect, it } from 'vitest';

import { probeEnginePrerequisites } from './engine-prerequisites';

const prerequisites = probeEnginePrerequisites();
const suite = prerequisites.ok ? describe : describe.skip;

suite('the built-in aliases', () => {
  /** Contract: the engine's table of built-in aliases, which the system
   *  fingerprint leaves out when a system keeps them unchanged, is the
   *  system package's, entry for entry. A built-in only one of them holds
   *  would name classes by it, and renaming them is what the table
   *  exists to stop. */
  it('are the system package’s, entry for entry', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../extractor.js');
    const table = JSON.parse(native.builtInAliases());
    expect(table.selectors).toEqual(
      Object.fromEntries(
        Object.entries(BUILT_IN_SELECTORS).map(([name, { selector }]) => [
          name,
          selector,
        ])
      )
    );
    expect(table.conditions).toEqual(BUILT_IN_CONDITIONS);
  });
});
