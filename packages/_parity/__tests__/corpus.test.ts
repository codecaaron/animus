import { describe, expect, test } from 'vitest';

import { assertCorpusDirectories, validateFamilies } from '../src/corpus';

import type { FamilyDecl } from '../src/types';

describe('parity corpus preconditions', () => {
  test('a missing required corpus directory fails with actionable parity remediation', () => {
    const missing = '/definitely-missing/animus-parity-corpus';

    expect(() =>
      assertCorpusDirectories([
        { label: 'parity adversarial corpus', path: missing },
      ])
    ).toThrow(
      `fixture corpus missing: parity adversarial corpus at ${missing} — restore the required directory from version control, then rerun vp run verify:parity`
    );
  });

  test('an additional family cannot reference a unit outside the corpus', () => {
    const required = [
      'mdx-provider-scope',
      'aliased-import',
      'duplicate-binding',
      'bare-create-element',
      'compose-reassignment',
    ].map(
      (family): FamilyDecl => ({
        family,
        units: ['known-unit'],
        expectedVerdict: 'identical',
      })
    );

    expect(() =>
      validateFamilies(
        [
          ...required,
          {
            family: 'additional-family',
            units: ['missing-unit'],
            expectedVerdict: 'identical',
          },
        ],
        new Set(['known-unit'])
      )
    ).toThrow('family additional-family references unknown unit missing-unit');
  });
});
