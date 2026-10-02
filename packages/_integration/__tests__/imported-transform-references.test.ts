import { beforeAll, describe, expect, test } from 'vitest';

import {
  analyzeProject,
  clearAnalysisCache,
  transformFile,
} from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

const file = (path: string, source: string) => ({
  path: `fixtures/imported/${path}`,
  source,
});

const SYSTEM = file(
  'system.ts',
  `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();
`
);

// `tripled`, `quintupled` and `unused` share a readable name and close over
// `factor`, which isolated evaluation rejects; only `unused` is unreferenced,
// and `quintupled` is reached only through a consumer's alias.
const SCALES = file(
  'scales.ts',
  `import { createTransform } from '@animus-ui/system';

const factor = 2;
export const double = (value) => \`\${Number(value) * factor}px\`;
export function half(value) { return \`\${Number(value) / 2}px\`; }
export default function quarter(value) { return \`\${Number(value) / 4}px\`; }
export const tripled = createTransform('double', (value) => \`\${Number(value) * factor * 3}px\`);
export const quintupled = createTransform('double', (value) => \`\${Number(value) * factor * 5}px\`);
export const unused = createTransform('double', (value) => \`\${Number(value) + factor}px\`);
let shift = (value) => value;
export { shift };
`
);

const OTHER = file(
  'other.ts',
  'export const double = (value) => `${Number(value) * 5}px`;\n'
);

const BARREL = file(
  'index.ts',
  `export { double as twice, tripled } from './scales';
import { half } from './scales';
export { half };
export { double as otherDouble } from './other';
`
);

// createTransform reached through a local re-export of the system package.
const KIT = file(
  'kit.ts',
  "export { createTransform } from '@animus-ui/system';\n"
);
// A system export that is not createTransform makes no transform.
const FAKE_KIT = file(
  'fake-kit.ts',
  "export { createSystem as make } from '@animus-ui/system';\n"
);
const MADE = file(
  'made.ts',
  `import { createTransform as ct } from './kit';
import { make } from './fake-kit';
const unit = 'px';
export const angled = ct('angled', (value) => \`\${value}\${unit}\`);
export const faked = make('faked', (value) => value);
`
);
const ANONYMOUS = file(
  'anonymous.ts',
  'export default (value) => `${Number(value) * 6}px`;\n'
);

const STAR = file('star.ts', "export * from './scales';\n");
// Exported declarations that are not callbacks, and a named namespace
// re-export; this module has no unnamed `export *`.
const DECLARATIONS = file(
  'declarations.ts',
  `const helpers = { double: (value) => value };
export const { double: unpacked } = helpers;
export enum Mode { Wide = 1 }
export * as nsx from './scales';
`
);
const CYCLE_A = file('cycle-a.ts', "export { loop } from './cycle-b';\n");
const CYCLE_B = file('cycle-b.ts', "export { loop } from './cycle-a';\n");

const PACKAGE = {
  path: 'fixtures/packages/transforms/index.ts',
  source: 'export const fromPackage = (value) => `${Number(value) * 7}px`;\n',
};

const CONSUMER = file(
  'consumer.tsx',
  `import { ds } from './system';
import quarter, { double as dbl, shift, missing, quintupled } from './scales';
import { twice, half, tripled, otherDouble } from '.';
import { double as otherDirect } from './other';
import { angled, faked } from './made';
import sixfold from './anonymous';
import { double as starred } from './star';
import { loop } from './cycle-a';
import { unpacked, Mode, nsx, absent } from './declarations';
import { opaque } from 'not-analyzed-lib';
import { fromPackage } from '@fixture/transforms';
import { half as viaPath } from '~/scales';

const local = dbl;
const viaAlias = quintupled;

export const Box = ds
  .props({
    wide: { property: 'minWidth', transform: dbl },
    tall: { property: 'minHeight', transform: twice },
    thin: { property: 'maxWidth', transform: half },
    ring: { property: 'marginLeft', transform: tripled },
    fourth: { property: 'marginRight', transform: quarter },
    near: { property: 'paddingTop', transform: local },
    five: { property: 'marginTop', transform: viaAlias },
    six: { property: 'marginBottom', transform: sixfold },
  })
  .asElement('div');
export const Tag = ds
  .props({
    inset: { property: 'paddingLeft', transform: dbl },
    other: { property: 'paddingRight', transform: otherDouble },
    direct: { property: 'paddingBottom', transform: otherDirect },
    angle: { property: 'top', transform: angled },
    pkg: { property: 'left', transform: fromPackage },
    path: { property: 'right', transform: viaPath },
  })
  .asElement('span');
export const Loose = ds
  .props({
    drift: { property: 'left', transform: shift },
    star: { property: 'top', transform: starred },
    cycle: { property: 'right', transform: loop },
    unpacked: { property: 'maxHeight', transform: unpacked },
    mode: { property: 'minHeight', transform: Mode },
    nsx: { property: 'maxWidth', transform: nsx },
    absent: { property: 'minWidth', transform: absent },
    opaque: { property: 'bottom', transform: opaque },
    gone: { property: 'width', transform: missing },
    fake: { property: 'height', transform: faked },
  })
  .asElement('p');

export const App = ({ n }) => (
  <>
    <Box wide={n} tall={n} thin={n} ring={n} fourth={n} near={n} five={n} six={n} />
    <Tag inset={n} other={n} direct={n} angle={n} pkg={n} path={n} />
    <Loose drift={n} star={n} cycle={n} opaque={n} gone={n} fake={n} unpacked={n} mode={n} nsx={n} absent={n} />
  </>
);
`
);

const FILES = [
  SYSTEM,
  SCALES,
  OTHER,
  BARREL,
  KIT,
  FAKE_KIT,
  MADE,
  ANONYMOUS,
  STAR,
  DECLARATIONS,
  CYCLE_A,
  CYCLE_B,
  PACKAGE,
  CONSUMER,
];

type Manifest = {
  components: Record<string, { replacement: string }>;
  diagnostics?: ManifestDiagnostic[];
};

const analyze = (files: typeof FILES): Manifest => {
  clearAnalysisCache();
  return JSON.parse(
    analyzeProject(JSON.stringify(files), {
      packageResolutionJson: JSON.stringify({
        '@fixture/transforms': PACKAGE.path,
      }),
      pathAliasesJson: JSON.stringify({
        aliases: [
          { pattern: '~/', replacement: 'fixtures/imported/', type: 'prefix' },
        ],
      }),
    })
  );
};

describe('imported transform references in .props()', () => {
  let manifest: Manifest;
  let reversed: Manifest;

  beforeAll(() => {
    reversed = analyze([...FILES].reverse());
    manifest = analyze(FILES);
  });

  const replacement = (binding: string, from = manifest) =>
    from.components[`${CONSUMER.path}::${binding}`].replacement;
  const diagnosticsOf = (from: Manifest, path: string) =>
    (from.diagnostics ?? [])
      .filter((d) => d.file === path)
      .map((d) => `${d.component}: ${d.message}`)
      .sort();

  test('each supported import delivers its authored local reference', () => {
    for (const [binding, prop, reference] of [
      ['Box', 'wide', 'dbl'],
      ['Box', 'tall', 'twice'],
      ['Box', 'thin', 'half'],
      ['Box', 'ring', 'tripled'],
      ['Box', 'fourth', 'quarter'],
      ['Box', 'near', 'local'],
      ['Box', 'five', 'viaAlias'],
      ['Box', 'six', 'sixfold'],
      ['Tag', 'inset', 'dbl'],
      ['Tag', 'other', 'otherDouble'],
      ['Tag', 'direct', 'otherDirect'],
      ['Tag', 'angle', 'angled'],
      ['Tag', 'pkg', 'fromPackage'],
      ['Tag', 'path', 'viaPath'],
    ]) {
      expect(replacement(binding)).toMatch(
        new RegExp(`"${prop}":\\{[^}]*"transform":${reference}\\}`)
      );
    }
    const { code } = transformFile(CONSUMER.path, CONSUMER.source);
    expect(code).toContain(
      "import quarter, { double as dbl, shift, missing, quintupled } from './scales';"
    );
    expect(code).toContain("import { double as otherDirect } from './other';");
    expect(code).toContain(
      "import { fromPackage } from '@fixture/transforms';"
    );
  });

  test('supported imports are not diagnosed; unsupported ones are attributable', () => {
    const forComponent = (component: string) =>
      (manifest.diagnostics ?? []).filter((d) => d.component === component);
    expect(forComponent('Box')).toEqual([]);
    expect(forComponent('Tag')).toEqual([]);
    const loose = forComponent('Loose');
    expect(loose).toHaveLength(10);
    for (const diagnostic of loose) {
      expect(diagnostic).toMatchObject({
        code: 'animus.props.unsupported-transform-reference',
        severity: 'error',
        file: CONSUMER.path,
      });
    }
    const messages = loose.map((d) => d.message).join('\n');
    for (const reason of [
      "transform reference 'shift' resolves to 'shift' in fixtures/imported/scales.ts, which is a mutable `let` binding",
      "transform reference 'starred' resolves to 'double' in fixtures/imported/star.ts, which is not exported by that module; `export *` re-exports are not followed",
      'which is a circular re-export',
      "transform reference 'opaque' is imported from 'not-analyzed-lib', which is not an analyzed source module",
      "transform reference 'missing' resolves to 'missing' in fixtures/imported/scales.ts, which is not exported by that module",
      "transform reference 'faked' resolves to 'faked' in fixtures/imported/made.ts, which is not a function",
      // Whole reasons, delimited by the message's parentheses.
      `(transform reference 'unpacked' resolves to 'unpacked' in ${DECLARATIONS.path}, which is not a function, an alias of one or a createTransform call declared with \`const\`)`,
      `(transform reference 'Mode' resolves to 'Mode' in ${DECLARATIONS.path}, which is not a function, an alias of one or a createTransform call declared with \`const\`)`,
      `(transform reference 'nsx' resolves to 'nsx' in ${DECLARATIONS.path}, which is a namespace re-export)`,
      // Only an unnamed `export *` adds its limitation to a missing export.
      `(transform reference 'absent' resolves to 'absent' in ${DECLARATIONS.path}, which is not exported by that module)`,
    ]) {
      expect(messages).toContain(reason);
    }
    expect(replacement('Loose')).not.toMatch(/"transform":/);
  });

  test('only unreferenced createTransform declarations keep their project bail', () => {
    const bails = (manifest.diagnostics ?? []).filter((d) => d.kind === 'bail');
    expect(bails.map((d) => d.file)).toEqual([SCALES.path]);
    expect(bails[0].component).toBe("createTransform('double')");
    expect(bails[0].message).toContain("'factor'");
    expect(diagnosticsOf(manifest, MADE.path)).toEqual([]);
  });

  test('analysis order selects the same callables and diagnostics', () => {
    for (const binding of ['Box', 'Tag', 'Loose']) {
      expect(replacement(binding, reversed)).toBe(replacement(binding));
    }
    for (const path of FILES.map((f) => f.path)) {
      expect(diagnosticsOf(reversed, path)).toEqual(
        diagnosticsOf(manifest, path)
      );
    }
  });
});
