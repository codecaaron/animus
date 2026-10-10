import { createSystem, createTransform } from '@animus-ui/system';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  analyzeProject,
  clearAnalysisCache,
  transformFile,
} from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

// A configured definition carrying the readable name of the local one below.
const decoy = createTransform('double', (value) => `${Number(value) * 9}px`);
const configured = createSystem()
  .addProps({ decoyWidth: { property: 'width', transform: decoy } })
  .build()
  .seal()
  .toConfig();

// Analyzed beside the components, so their Animus origin is proven.
const SYSTEM = {
  path: 'fixtures/local-references-system.ts',
  source: `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();
`,
};

const FILE = {
  path: 'fixtures/local-references.tsx',
  source: `import { createTransform as ct } from '@animus-ui/system';
import { ds } from './local-references-system';

const double = (value) => \`\${Number(value) * 2}px\`;
const twice = double;
function half(value) { return \`\${Number(value) / 2}px\`; }
const named = ct('double', (value) => \`\${Number(value) * 3}px\`);
let shift = (value) => value;

export const Box = ds
  .props({
    wide: { property: 'minWidth', transform: double },
    tall: { property: 'minHeight', transform: twice },
    thin: { property: 'maxWidth', transform: half },
    ring: { property: 'marginLeft', transform: named },
  })
  .asElement('div');
export const Tag = ds.props({ inset: { property: 'paddingLeft', transform: double } }).asElement('span');
export const Loose = ds.props({ drift: { property: 'left', transform: shift } }).asElement('p');

export const App = ({ n }) => (
  <>
    <Box wide={10} tall={n} thin={n} ring={n} />
    <Box wide={n} />
    <Tag inset={n} />
    <Loose drift={n} />
  </>
);
`,
};

type Manifest = {
  components: Record<string, { replacement: string }>;
  diagnostics?: ManifestDiagnostic[];
  css: string;
};

describe('module-local transform references in .props()', () => {
  let manifest: Manifest;

  beforeAll(() => {
    clearAnalysisCache();
    manifest = JSON.parse(
      analyzeProject(JSON.stringify([SYSTEM, FILE]), {
        propConfigJson: configured.propConfig,
        groupRegistryJson: configured.groupRegistry,
        transformSourcesJson: configured.transformSources,
      })
    );
  });

  const replacement = (binding: string) =>
    manifest.components[`${FILE.path}::${binding}`].replacement;

  test('each supported prop delivers its authored reference in place', () => {
    for (const [binding, prop, reference] of [
      ['Box', 'wide', 'double'],
      ['Box', 'tall', 'twice'],
      ['Box', 'thin', 'half'],
      ['Box', 'ring', 'named'],
      ['Tag', 'inset', 'double'],
    ]) {
      expect(replacement(binding)).toMatch(
        new RegExp(`"${prop}":\\{[^}]*"transform":${reference}\\}`)
      );
    }
    const { code } = transformFile(FILE.path, FILE.source);
    expect(code).toContain('const double = (value) =>');
    expect(code).toContain("const named = ct('double',");
    expect(code).toMatch(/"transform":double\}/);
  });

  test('a same-named configured definition never replaces a local reference', () => {
    for (const binding of ['Box', 'Tag']) {
      expect(replacement(binding)).not.toContain('transformName');
      expect(replacement(binding)).not.toContain('transforms[');
    }
    // 90px is the configured decoy's result; 10px is the raw literal a lost
    // callback would apply.
    expect(manifest.css).not.toMatch(/min-width:\s*(90px|10px)/);
  });

  test('supported references are not diagnosed; an unsupported one is attributable', () => {
    const forComponent = (component: string) =>
      (manifest.diagnostics ?? []).filter((d) => d.component === component);
    expect(forComponent('Box')).toEqual([]);
    expect(forComponent('Tag')).toEqual([]);
    expect(forComponent('Loose')).toMatchObject([
      {
        code: 'animus.props.unsupported-transform-reference',
        severity: 'error',
        file: FILE.path,
      },
    ]);
    const [loose] = forComponent('Loose');
    expect(loose.message).toContain("'drift'");
    expect(loose.message).toContain("'shift' is a mutable `let` binding");
    expect(loose.message).toContain('inside the .props() object literal');
    expect(replacement('Loose')).not.toMatch(/"transform":/);
  });
});

// A `.ts` module, so angle-bracket assertions parse.
const DECLARATIONS = {
  path: 'fixtures/local-reference-declarations.ts',
  source: `import { createTransform as ct } from '@animus-ui/system';
import { createTransform as foreignCt } from 'other-lib';
import { ds } from './local-references-system';

type Fn = (value: string | number) => string;
const factor = 3;
const offset = 1;
const label = 'dynamic';
const closed = ct('double', (value) => \`\${Number(value) * factor}px\`);
const dynamic = ct(label, (value) => \`\${value}px\`);
const viaAlias = closed;
const unused = ct('double', (value) => \`\${Number(value) + offset}px\`);
const foreign = foreignCt('foreign', (value) => \`\${value}px\`);
const double = (value: string | number) => \`\${Number(value) * 2}px\`;
const angled = <Fn>((value) => \`\${value}px\`);
const assertedAlias = <Fn>double;

export const Declared = ds
  .props({
    a: { property: 'width', transform: closed },
    b: { property: 'height', transform: dynamic },
    c: { property: 'minWidth', transform: viaAlias },
    d: { property: 'maxWidth', transform: <Fn>double },
    e: { property: 'minHeight', transform: angled },
    f: { property: 'maxHeight', transform: assertedAlias },
    g: { property: 'top', transform: <Fn>(<Fn>double) },
  })
  .asElement('div');
export const Foreign = ds.props({ x: { property: 'left', transform: foreign } }).asElement('div');
`,
};

// Runtime values, so each prop keeps its slot and its delivered reference.
const RENDERS = {
  path: 'fixtures/local-reference-renders.tsx',
  source: `import { Declared } from './local-reference-declarations';

export const App = ({ n }) => <Declared a={n} b={n} c={n} d={n} e={n} f={n} g={n} />;
`,
};

describe('captured createTransform bindings, callee source and asserted references', () => {
  let manifest: Manifest;

  beforeAll(() => {
    clearAnalysisCache();
    manifest = JSON.parse(
      analyzeProject(JSON.stringify([SYSTEM, DECLARATIONS, RENDERS]))
    );
  });

  const replacement = (binding: string) =>
    manifest.components[`${DECLARATIONS.path}::${binding}`].replacement;
  const diagnosticsOf = (file: string) =>
    (manifest.diagnostics ?? []).filter((d) => d.file === file);

  test('closures, computed names and asserted forms keep their authored reference', () => {
    for (const [prop, reference] of [
      ['a', 'closed'],
      ['b', 'dynamic'],
      ['c', 'viaAlias'],
      ['d', 'double'],
      ['e', 'angled'],
      ['f', 'assertedAlias'],
      ['g', 'double'],
    ]) {
      expect(replacement('Declared')).toMatch(
        new RegExp(`"${prop}":\\{[^}]*"transform":${reference}\\}`)
      );
    }
  });

  test('only the unreferenced declaration keeps its project bail', () => {
    const bails = diagnosticsOf(DECLARATIONS.path).filter(
      (d) => d.kind === 'bail'
    );
    // `unused` shares `closed`'s readable name; only its own capture is reported.
    expect(bails).toHaveLength(1);
    expect(bails[0].component).toBe("createTransform('double')");
    expect(bails[0].message).toContain("'offset'");
    expect(
      diagnosticsOf(DECLARATIONS.path).filter((d) => d.component === 'Declared')
    ).toEqual([]);
  });

  test('a createTransform imported from another library is not a supported callee', () => {
    const foreign = diagnosticsOf(DECLARATIONS.path).filter(
      (d) => d.component === 'Foreign'
    );
    expect(foreign).toMatchObject([
      {
        code: 'animus.props.unsupported-transform-reference',
        severity: 'error',
      },
    ]);
    expect(foreign[0].message).toContain("'foreign' is not a function");
    expect(replacement('Foreign')).not.toMatch(/"transform":/);
  });
});
