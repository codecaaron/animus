import { beforeAll, describe, expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { clearAnalysisCache, runPipeline } from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

const ANIMUS = {
  path: 'possible-miss/animus.tsx',
  source: `import { ds } from '../../setup';
export const Text = ds.styles({ display: 'block' }).system({ color: true }).asElement('p');
`,
};

/** A tag imported from a package the analysis does not read, named like the
 *  Animus component, beside a proven render of that component. */
const APP = {
  path: 'possible-miss/app.tsx',
  source: `import { Text as AnimusText } from './animus';
import { Text } from 'other-kit';
export const Proven = () => <AnimusText color="nope" />;
export const Named = () => <Text color="nope">x</Text>;
export const Valid = () => <Text color="primary">x</Text>;
`,
};

/** A file that hands the same tag an Animus component through `asChild`. */
const HANDED = {
  path: 'possible-miss/handed.tsx',
  source: `import { Text as AnimusText } from './animus';
import { Text } from 'other-kit';
export const Handed = () => <Text asChild color="nope"><AnimusText /></Text>;
`,
};

function misses(manifest: { diagnostics?: ManifestDiagnostic[] }) {
  return (manifest.diagnostics ?? [])
    .filter((d) =>
      /strict-token-miss|possible-system-prop-miss/.test(d.code ?? '')
    )
    .map((d) => [d.code, d.severity, d.file, d.line, d.column]);
}

// Contract: a strict-scale miss at a render that reaches an Animus component
// by proof is an error, and one at a render matched to it by name alone is an
// `animus.usage.possible-system-prop-miss` warning; a tag of a package the
// host finds has no dependency path to Animus (`foreignPackages`) matches no
// Animus component by name, unless the file hands it a component.
describe('strict misses by the certainty of their render', () => {
  let named: ReturnType<typeof runPipeline>;
  let foreign: ReturnType<typeof runPipeline>;

  beforeAll(() => {
    clearAnalysisCache();
    named = runPipeline([ANIMUS, APP, HANDED]);
    assertNoUnresolvedTokens(named.css);
    clearAnalysisCache();
    foreign = runPipeline([ANIMUS, APP, HANDED], {
      inputs: {
        analysisContextJson: JSON.stringify({ foreignPackages: ['other-kit'] }),
      },
    });
    assertNoUnresolvedTokens(foreign.css);
  });

  test('one value errors at its proven render and warns where it matches by name', () => {
    expect(misses(named.manifest)).toEqual([
      ['animus.props.strict-token-miss', 'error', APP.path, 3, 41],
      ['animus.usage.possible-system-prop-miss', 'warn', APP.path, 4, 34],
      ['animus.usage.possible-system-prop-miss', 'warn', HANDED.path, 3, 43],
    ]);
  });

  test('a foreign tag matches nothing by name, unless the file hands it a component', () => {
    expect(misses(foreign.manifest)).toEqual([
      ['animus.props.strict-token-miss', 'error', APP.path, 3, 41],
      ['animus.usage.possible-system-prop-miss', 'warn', HANDED.path, 3, 43],
    ]);
    // The valid value at the foreign tag gets no utility class either.
    expect(
      Object.keys(foreign.manifest.system_prop_map.color ?? {})
    ).not.toContain('primary');
    expect(Object.keys(named.manifest.system_prop_map.color ?? {})).toContain(
      'primary'
    );
  });
});
