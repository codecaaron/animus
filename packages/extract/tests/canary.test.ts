import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import { probeAbsolutePathSpecifier } from '../pipeline/discover-packages';
import { builtInAssetClassification } from '../pipeline/host-assets';
import {
  extensionPolicyJson,
  viteExtensionPolicy,
} from '../pipeline/host-extensions';
import { gatherProbeEvidence } from '../pipeline/probe-evidence';
import { analysisContextJson } from '../pipeline/run-analysis';
import { ingestSourceEntries } from '../pipeline/source-ingestion';

const v2 = require('../index-v2.js');

describe('v2 system loader NAPI boundary', () => {
  const root = join(__dirname, '../../..');
  const systemPath = join(__dirname, 'test-system.ts');

  test('loadSystemModule returns a fully-populated NapiSystemConfig', () => {
    const config = v2.loadSystemModule(systemPath, root);

    // NAPI class instances expose fields as getters, not own enumerable
    // properties, so toMatchObject cannot see them; pick explicitly.
    expect({
      propConfig: config.propConfig,
      groupRegistry: config.groupRegistry,
      scalesJson: config.scalesJson,
      variableMapJson: config.variableMapJson,
      variableCss: config.variableCss,
      contextualVarsJson: config.contextualVarsJson,
    }).toEqual({
      propConfig: expect.any(String),
      groupRegistry: expect.any(String),
      scalesJson: expect.any(String),
      variableMapJson: expect.any(String),
      variableCss: expect.any(String),
      contextualVarsJson: expect.any(String),
    });

    expect(() => JSON.parse(config.propConfig)).not.toThrow();
    expect(() => JSON.parse(config.groupRegistry)).not.toThrow();
    expect(() => JSON.parse(config.scalesJson)).not.toThrow();
    expect(() => JSON.parse(config.variableMapJson)).not.toThrow();
  });

  test('loadSystemModule fails loud on a missing module path', () => {
    const missing = join(__dirname, 'fixtures/does-not-exist.ts');

    let message = '';
    try {
      v2.loadSystemModule(missing, root);
    } catch (error) {
      message = String(error);
    }

    expect(message).not.toBe('');
    expect(message).toContain('does-not-exist');
  });
});

describe('assembleStylesheet: anm- layer names', () => {
  const { assembleStylesheet: assemble } = require('../dist/index.mjs');

  test('default produces anm- prefixed layer declaration', () => {
    const css = assemble({});
    expect(css).toContain(
      '@layer anm-vendor, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
  });

  // A list written before the vendor layer existed takes it first.
  test('custom layers with TW interleaving', () => {
    const css = assemble({
      layers: [
        'base',
        'anm-global',
        'anm-base',
        'anm-variants',
        'anm-compounds',
        'anm-states',
        'anm-system',
        'anm-custom',
        'utilities',
      ],
    });
    expect(css).toContain(
      '@layer anm-vendor, base, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, utilities;'
    );
  });

  test('custom layers with bookends', () => {
    const css = assemble({
      layers: [
        'reset',
        'anm-global',
        'anm-base',
        'anm-variants',
        'anm-compounds',
        'anm-states',
        'anm-system',
        'anm-custom',
        'overrides',
      ],
    });
    expect(css).toContain(
      '@layer anm-vendor, reset, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, overrides;'
    );
  });
});

describe('assembleStylesheet: split mode', () => {
  const { assembleStylesheet: assemble } = require('../dist/index.mjs');

  const opts = {
    variableCss:
      ':root { --color-primary: red; }\n[data-color-mode="dark"] { --color-primary: blue; }',
    globalCss: '@layer anm-global { body { margin: 0; } }',
    componentCss:
      '@layer anm-global, anm-base;\n@layer anm-base { .btn { padding: 8px; } }',
  };

  test('declaration contains @layer statement, not in body', () => {
    const { declaration, body } = assemble({ ...opts, split: true });
    expect(declaration).toContain('@layer anm-vendor, anm-global, anm-base');
    expect(body).not.toMatch(/^@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/m);
  });

  test('variables contains :root block, not in body', () => {
    const { variables, body } = assemble({ ...opts, split: true });
    expect(variables).toContain(':root');
    expect(variables).toContain('--color-primary');
    expect(body).not.toContain(':root');
  });

  test('body contains @layer blocks', () => {
    const { body } = assemble({ ...opts, split: true });
    expect(body).toContain('@layer anm-global {');
    expect(body).toContain('@layer anm-base {');
  });

  test('concatenated split equals non-split return', () => {
    const splitResult = assemble({ ...opts, split: true });
    const stringResult = assemble(opts);
    const joined = [
      splitResult.declaration,
      splitResult.variables,
      splitResult.body,
    ]
      .filter(Boolean)
      .join('\n');
    expect(joined).toEqual(stringResult);
  });
});

describe('assembleStylesheet: @property registration split', () => {
  const { assembleStylesheet: assemble } = require('../dist/index.mjs');

  // Exactly the shape createTheme's serialize().variableCss produces for a
  // registered contextual var.
  const VARIABLE_CSS = [
    '@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }',
    '',
    ':root {\n  --color-primary: #abc;\n}',
  ].join('\n');

  const COMPONENT_CSS = '@layer anm-base { .animus-card { padding: 8px; } }';

  test('places @property in the variables part, absent from body/declaration', () => {
    const { declaration, variables, body } = assemble({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
      split: true,
    });

    expect(variables).toContain('@property --current-bg');
    expect(body).not.toContain('@property');
    expect(declaration).not.toContain('@property');
    expect(declaration).toMatch(/@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/);
  });

  test('concatenation invariant: rejoined split equals the non-split output', () => {
    const split = assemble({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
      split: true,
    });
    const nonSplit = assemble({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
    });

    const rejoined = [split.declaration, split.variables, split.body]
      .filter(Boolean)
      .join('\n');
    expect(rejoined).toBe(nonSplit);
  });

  test('@property appears before the @layer declaration in assembled output', () => {
    const nonSplit = assemble({
      variableCss: VARIABLE_CSS,
      componentCss: COMPONENT_CSS,
    });

    const propIdx = nonSplit.indexOf('@property --current-bg');
    const layerBaseIdx = nonSplit.indexOf('@layer anm-base {');
    const declIdx = nonSplit.search(/@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/);

    expect(propIdx).toBeGreaterThanOrEqual(0);
    expect(propIdx).toBeGreaterThan(declIdx);
    expect(layerBaseIdx).toBeGreaterThan(propIdx);
  });
});

// Contract: extraction opens the file the host resolver opens. A configured
// Vite `resolve.extensions` does not describe Vite's resolution: a real Vite
// 8.2.2 build with `['.js']` loads `./only` as `only.tsx`. So the order is
// unreadable, and discovery and the native resolver keep the built-in one.
test("a configured Vite extension list is unreadable, and './only' still finds only.tsx", () => {
  const policy = viteExtensionPolicy(['.js']);
  const root = mkdtempSync(join(tmpdir(), 'animus-vite-configured-'));
  writeFileSync(join(root, 'only.tsx'), 'export {};\n');
  const probed = probeAbsolutePathSpecifier(
    join(root, 'only'),
    new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']),
    root,
    policy
  );
  const native = v2.resolveSpecifier(
    './only',
    root,
    [],
    {},
    extensionPolicyJson(policy)
  );
  rmSync(root, { recursive: true, force: true });

  expect({
    order: policy.resolverVersion,
    discovery: probed.kind === 'found' ? probed.path : null,
    native: native.path ?? null,
  }).toEqual({
    order: 'built-in (hostOptionUnreadable: vite configured extensions)',
    discovery: join(root, 'only.tsx'),
    native: expect.stringMatching(/only\.tsx$/),
  });
});

// Contract: analysis never opens a different file than a case-insensitive
// host would (spec §2.2 A2, A8). `./x` beside `X.ts` (red) and `x.tsx`
// (blue): where the filesystem opens `x.ts` as `X.ts`, the probe is
// Incomplete, the finding names both spellings, and the child is never
// linked to `x.tsx`; where it does not, the exact `x.tsx` is read, as the
// host reads it. The same for an APFS-only pair, `ς` beside `Σ.ts` and an
// exact `ς.tsx`.
test.each([
  ['x', 'X.ts', 'x.tsx'],
  ['ς', 'Σ.ts', 'ς.tsx'],
])(
  "analysis reads './%s' beside %s and %s as the host does",
  (name, variant, exact) => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), 'animus-case-probe-'))
    );
    const sources = {
      [variant]:
        "export const Parent = ds.styles({ color: 'red' }).asElement('div');\n",
      [exact]:
        "export const Parent = ds.styles({ color: 'blue' }).asElement('div');\n",
      'app.tsx': `import { Parent } from './${name}';\nexport const Child = Parent.extend().styles({ margin: '1px' }).asElement('div');\nexport const App = () => <Child />;\n`,
    } satisfies Record<string, string>;
    for (const [path, source] of Object.entries(sources)) {
      writeFileSync(join(root, path), source);
    }
    const candidate = `${name}.ts`;
    const opensVariant =
      existsSync(join(root, candidate)) &&
      !readdirSync(root).includes(candidate);
    const files = Object.entries(sources).map(([path, source]) => ({
      path,
      source,
    }));
    const filesJson = JSON.stringify(files);
    const engine = new v2.ExtractEngine({});
    const prepared = JSON.parse(engine.prepare(filesJson));
    const evidence = gatherProbeEvidence(
      root,
      new Set(Object.keys(sources)),
      undefined
    )(prepared.bases, prepared.identity);
    const manifest = JSON.parse(engine.analyze(filesJson, evidence));
    rmSync(root, { recursive: true, force: true });

    expect({
      parent: manifest.components['app.tsx::Child']?.extends_from ?? null,
      mismatch: manifest.diagnostics
        .filter(
          (d: { code?: string }) => d.code === 'animus.resolve.case-mismatch'
        )
        .map(
          (d: { message: string }) =>
            d.message.includes(candidate) && d.message.includes(variant)
        ),
    }).toEqual(
      opensVariant
        ? { parent: null, mismatch: [true] }
        : { parent: `${exact}::Parent`, mismatch: [] }
    );
  }
);

// Contract: a Svelte resolver call whose import the host opens under another
// spelling is an opening of the analysis (spec §2.2 A8), though it is
// attributed to no module: the finding is reported and nothing is pruned,
// so the variant it renders keeps its CSS. The opening reaches the engine
// on the host's own context wire. spike-codex's witness: Known
// reads `./Definition` (quiet, the control that lets pruning run); Usage
// reads `./definition` (loud), which a case-insensitive host opens as
// `Definition.ts`, beside a `definition.tsx` exporting another badge.
test('a mismatched Svelte resolver call keeps the variant it renders', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-svelte-open-')));
  const sources = {
    'src/Definition.ts':
      "export const badge=ds.styles({color:'red'}).variant({prop:'tone',defaultVariant:'quiet',variants:{quiet:{backgroundColor:'pink'},loud:{backgroundColor:'crimson'}}}).asClass();\n",
    'src/definition.tsx':
      "export const later=ds.styles({color:'blue'}).variant({prop:'tone',defaultVariant:'quiet',variants:{quiet:{backgroundColor:'pink'},loud:{backgroundColor:'crimson'}}}).asClass();export{later as badge};\n",
    'src/Usage.svelte':
      "<script>import{badge}from'./definition';const attrs=badge.attrs({tone:'loud'});</script><div {...attrs}></div>\n",
    'src/Known.svelte':
      "<script>import{badge}from'./Definition';const attrs=badge.attrs({tone:'quiet'});</script><div {...attrs}></div>\n",
  } satisfies Record<string, string>;
  mkdirSync(join(root, 'src'));
  for (const [path, source] of Object.entries(sources)) {
    writeFileSync(join(root, path), source);
  }
  const opensVariant =
    existsSync(join(root, 'src', 'definition.ts')) &&
    !readdirSync(join(root, 'src')).includes('definition.ts');

  const ingested = await ingestSourceEntries(
    Object.entries(sources).map(([path, source]) => ({ path, source })),
    { extractFacts: (filesJson) => v2.extractFacts(filesJson), rootDir: root }
  );
  const engine = new v2.ExtractEngine({
    analysisContextJson: analysisContextJson({ openings: ingested.openings }),
  });
  const filesJson = JSON.stringify(ingested.analysisEntries);
  const prepared = JSON.parse(engine.prepare(filesJson));
  const evidence = gatherProbeEvidence(
    root,
    new Set(ingested.analysisEntries.map((entry) => entry.path)),
    undefined
  )(prepared.bases, prepared.identity);
  const manifest = JSON.parse(engine.analyze(filesJson, evidence));
  rmSync(root, { recursive: true, force: true });
  // The badge the loud call reaches: `Definition.ts`'s where the
  // filesystem opens the variant, else the exact `definition.tsx`'s.
  const components: Record<string, { file: string; class_name: string }> =
    manifest.components;
  const reached = Object.values(components).find(
    (component) =>
      component.file ===
      (opensVariant ? 'src/Definition.ts' : 'src/definition.tsx')
  );

  expect({
    loud:
      reached !== undefined &&
      manifest.css.includes(`.${reached.class_name}--tone-loud`),
    mismatch: manifest.diagnostics.some(
      (d: { code?: string }) => d.code === 'animus.resolve.case-mismatch'
    ),
  }).toEqual({ loud: true, mismatch: opensVariant });
});

// Contract: the probe stops at the host's first candidate (spec §2.2 A8).
// Under an order that tries `.json` first, `./a` beside `a.json` and `a.ts`
// ends at `a.json`, which the host loads as opaque JSON: the child is never
// linked to `a.ts`, and the skipped source is reported, since analysis would
// otherwise have read `a.ts`. The same for an asset, `a.png` before `a.tsx`.
// Under the default order `a.ts` is the parent. A host-classified asset with
// no later analysed candidate ends a probe with no finding.
test.each([
  ['a.json', 'a.ts', ['.json', '.ts', '.js'], null, 1],
  ['a.png', 'a.tsx', ['.png', '.tsx', '.ts'], null, 1],
  ['a.json', 'a.ts', undefined, 'a.ts::Parent', 0],
])(
  "analysis stops './a' at %s before %s where the host order %j stops",
  (opaque, module, appended, parent, skipped) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-skipped-')));
    const analysed = {
      [module]: "export const Parent = ds.styles({ p: 9 }).asElement('div');\n",
      'app.tsx':
        "import { Parent } from './a';\nimport logo from './logo.png';\nexport const Child = Parent.extend().styles({ m: 1 }).asElement('div');\nexport const App = () => <Child data-logo={logo} />;\n",
    } satisfies Record<string, string>;
    for (const [path, source] of Object.entries(analysed)) {
      writeFileSync(join(root, path), source);
    }
    writeFileSync(join(root, opaque), '{ "p": 4 }\n');
    writeFileSync(join(root, 'logo.png'), '');
    const order =
      appended === undefined
        ? undefined
        : { appended, nodeNext: [], alias: [] };
    const files = Object.entries(analysed).map(([path, source]) => ({
      path,
      source,
    }));
    const filesJson = JSON.stringify(files);
    const engine = new v2.ExtractEngine(
      order === undefined
        ? {}
        : { analysisContextJson: JSON.stringify({ extensions: order }) }
    );
    const prepared = JSON.parse(engine.prepare(filesJson));
    const evidence = gatherProbeEvidence(
      root,
      new Set(Object.keys(analysed)),
      order,
      { isAsset: builtInAssetClassification('noHost').isAsset }
    )(prepared.bases, prepared.identity);
    const manifest = JSON.parse(engine.analyze(filesJson, evidence));
    rmSync(root, { recursive: true, force: true });

    expect({
      parent: manifest.components['app.tsx::Child']?.extends_from ?? null,
      skipped: manifest.diagnostics.filter(
        (d: { code?: string; message: string }) =>
          d.code === 'animus.resolve.skipped-source' &&
          d.message.includes(opaque) &&
          d.message.includes(module)
      ).length,
      resolve: manifest.diagnostics.filter((d: { code?: string }) =>
        d.code?.startsWith('animus.resolve.')
      ).length,
    }).toEqual({ parent, skipped, resolve: skipped });
  }
);

// Contract: a Svelte resolver call stops at the host's first candidate too
// (spec §2.2 A8). Under an order that tries `.json` first, Usage's
// `./badge` opens `badge.json`, which analysis never reads: the call is
// attributed to no module, never to the later `badge.ts`, and is reported
// as a skipped source.
test('a Svelte resolver call stops at an unanalysed host-first file', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-svelte-skip-')));
  const sources = {
    'src/badge.ts':
      "export const badge=ds.styles({}).variant({prop:'tone',defaultVariant:'quiet',variants:{quiet:{color:'blue'},loud:{color:'red'}}}).asClass();\n",
    'src/Known.svelte':
      "<script>import{badge}from'./badge.ts';const attrs=badge.attrs({tone:'quiet'});</script><div {...attrs}></div>\n",
    'src/Usage.svelte':
      "<script>import{badge}from'./badge';const attrs=badge.attrs({tone:'loud'});</script><div {...attrs}></div>\n",
  } satisfies Record<string, string>;
  mkdirSync(join(root, 'src'));
  for (const [path, source] of Object.entries(sources)) {
    writeFileSync(join(root, path), source);
  }
  writeFileSync(join(root, 'src', 'badge.json'), '{}\n');
  const order = { appended: ['.json', '.ts'], nodeNext: [], alias: [] };

  const ingested = await ingestSourceEntries(
    Object.entries(sources).map(([path, source]) => ({ path, source })),
    {
      extractFacts: (filesJson) => v2.extractFacts(filesJson),
      rootDir: root,
      extensions: order,
    }
  );
  const engine = new v2.ExtractEngine({
    analysisContextJson: JSON.stringify({
      extensions: order,
      openings: ingested.openings ?? [],
    }),
  });
  const manifest = JSON.parse(
    engine.analyze(JSON.stringify(ingested.analysisEntries))
  );
  rmSync(root, { recursive: true, force: true });

  expect({
    attributed:
      ingested.analysisEntries
        .find((entry) => entry.path === 'src/Usage.svelte.instance.tsx')
        ?.source.includes('<badge') ?? false,
    skipped: manifest.diagnostics.filter(
      (d: { code?: string; message: string }) =>
        d.code === 'animus.resolve.skipped-source' &&
        d.message.includes('badge.json')
    ).length,
  }).toEqual({ attributed: false, skipped: 1 });
});

// Contract: a bindingless import is probed like any other (spec §2.2 A8):
// the host loads it for its effects. Under the CLI's built-in
// classification, a file it opens that analysis never reads (`.data`, a
// `.js` with a query that keeps it code) leaves usage incomplete, so R's
// `lg`, which only that file could render, keeps its CSS, and the import is
// reported: no opening stops pruning silently. A stylesheet, JSON, an SVG,
// or a file `?raw` loads as a string, is opaque, and `lg` is pruned.
test.each([
  ['./selected.data', true],
  ['./selected.js?foo', true],
  ['./selected.js?raw', false],
  ['./globals.css', false],
  ['./data.json', false],
  ['./logo.svg', false],
])("a bindingless import of '%s' keeps lg: %s", (specifier, kept) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-bindingless-')));
  const analysed = {
    'r.ts':
      "export const R = ds.styles({}).variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: { padding: '1px' }, lg: { padding: '99px' } } }).asElement('div');\n",
    'app.tsx': `import { R } from './r';\nimport '${specifier}';\nexport const App = () => <R size="sm" />;\n`,
  } satisfies Record<string, string>;
  for (const [path, source] of Object.entries(analysed)) {
    writeFileSync(join(root, path), source);
  }
  writeFileSync(join(root, 'selected.data'), "R.render({ size: 'lg' });\n");
  writeFileSync(join(root, 'selected.js'), "R.render({ size: 'lg' });\n");
  writeFileSync(join(root, 'globals.css'), 'body { margin: 0; }\n');
  writeFileSync(join(root, 'data.json'), '{ "size": "lg" }\n');
  writeFileSync(
    join(root, 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>\n'
  );
  const filesJson = JSON.stringify(
    Object.entries(analysed).map(([path, source]) => ({ path, source }))
  );
  const engine = new v2.ExtractEngine({});
  const prepared = JSON.parse(engine.prepare(filesJson));
  const evidence = gatherProbeEvidence(
    root,
    new Set(Object.keys(analysed)),
    undefined,
    { isAsset: builtInAssetClassification('noHost').isAsset }
  )(prepared.bases, prepared.identity);
  const manifest = JSON.parse(engine.analyze(filesJson, evidence));
  rmSync(root, { recursive: true, force: true });

  expect({
    sm: manifest.css.includes('padding: 1px'),
    lg: manifest.css.includes('padding: 99px'),
    warned: manifest.diagnostics.filter(
      (d: { code?: string }) => d.code === 'animus.resolve.unanalysed-import'
    ).length,
  }).toEqual({ sm: true, lg: kept, warned: kept ? 1 : 0 });
});

// Contract: a default-bound JSON import is opaque data (spec §2.2 A8): it
// stops no pruning, and its values are never read statically, so a prop it
// feeds keeps every option.
test.each([
  ['<R size="sm" data-cfg={cfg} />', false],
  ['<R size={cfg.size} />', true],
])('a JSON import rendered as %s keeps lg: %s', (render, kept) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-json-')));
  const analysed = {
    'r.ts':
      "export const R = ds.styles({}).variant({ prop: 'size', defaultVariant: 'sm', variants: { sm: { padding: '1px' }, lg: { padding: '99px' } } }).asElement('div');\n",
    'app.tsx': `import { R } from './r';\nimport cfg from './data.json';\nexport const App = () => ${render};\n`,
  } satisfies Record<string, string>;
  for (const [path, source] of Object.entries(analysed)) {
    writeFileSync(join(root, path), source);
  }
  writeFileSync(join(root, 'data.json'), '{ "size": "lg" }\n');
  const filesJson = JSON.stringify(
    Object.entries(analysed).map(([path, source]) => ({ path, source }))
  );
  const engine = new v2.ExtractEngine({});
  const prepared = JSON.parse(engine.prepare(filesJson));
  const evidence = gatherProbeEvidence(
    root,
    new Set(Object.keys(analysed)),
    undefined,
    { isAsset: builtInAssetClassification('noHost').isAsset }
  )(prepared.bases, prepared.identity);
  const manifest = JSON.parse(engine.analyze(filesJson, evidence));
  rmSync(root, { recursive: true, force: true });

  expect({
    sm: manifest.css.includes('padding: 1px'),
    lg: manifest.css.includes('padding: 99px'),
  }).toEqual({ sm: true, lg: kept });
});

// Contract: a registry package reaches no app source except through an alias
// or a declared dependency (spec §6.3). A load of `@reg/pkg` keeps `pad`
// extractable when the host finds the package installed from a registry,
// in a pnpm store too, and declaring no local package; a workspace link, a
// `file:` copy, a local package it declares directly, through a registry
// dependency or as a `file:` copy under node_modules, or a `react` alias onto
// the module that holds `pad` keeps the opening.
test.each([
  ['installed from a registry', {}, 'tokens.ts', true],
  ['in a pnpm store', { store: true }, 'tokens.ts', true],
  ['linked from the workspace', { linked: true }, 'tokens.ts', false],
  ['copied in by a file: dependency', { copied: true }, 'tokens.ts', false],
  ['declaring the local kit', { declares: true }, 'kit/tokens.ts', false],
  [
    'whose dependency declares the local kit',
    { through: true },
    'kit/tokens.ts',
    false,
  ],
  [
    'declaring a file: copy of a local package',
    { copiesKit: true },
    'node_modules/@local/copy/tokens.ts',
    false,
  ],
  ['beside a local kit it does not declare', {}, 'kit/tokens.ts', true],
  ['with react aliased onto the module', { aliased: true }, 'tokens.ts', false],
] as const)(
  'a package %s keeps pad extractable as expected',
  (
    _row,
    layout: {
      store?: boolean;
      linked?: boolean;
      copied?: boolean;
      declares?: boolean;
      through?: boolean;
      copiesKit?: boolean;
      aliased?: boolean;
    },
    tokens,
    extracts
  ) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-registry-')));
    const manifest = (dir: string, name: string, dependencies = {}) => {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(
        join(root, dir, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', dependencies })
      );
    };
    const link = (from: string, to: string) => {
      mkdirSync(join(root, from, '..'), { recursive: true });
      symlinkSync(join(root, to), join(root, from));
    };
    manifest('.', 'app', {
      '@reg/pkg': layout.copied ? 'file:./proxy' : '1.0.0',
      '@local/kit': 'workspace:*',
    });
    manifest('kit', '@local/kit');
    link('node_modules/@local/kit', 'kit');
    manifest('node_modules/@local/copy', '@local/copy');
    const registry = layout.declares
      ? { '@local/kit': '1.0.0' }
      : layout.through
        ? { '@reg/dep': '1.0.0' }
        : layout.copiesKit
          ? { '@local/copy': 'file:../../kit' }
          : {};
    if (layout.linked) {
      manifest('proxy', '@reg/pkg');
      link('node_modules/@reg/pkg', 'proxy');
    } else if (layout.store) {
      manifest(
        'node_modules/.pnpm/@reg+pkg@1.0.0/node_modules/@reg/pkg',
        '@reg/pkg',
        registry
      );
      link(
        'node_modules/@reg/pkg',
        'node_modules/.pnpm/@reg+pkg@1.0.0/node_modules/@reg/pkg'
      );
    } else {
      manifest('node_modules/@reg/pkg', '@reg/pkg', registry);
    }
    manifest('node_modules/@reg/dep', '@reg/dep', { '@local/kit': '1.0.0' });
    const tokensImport = './' + tokens.replace(/\.ts$/, '');
    const analysed = {
      [tokens]: 'export const pad = { padding: 4 };\n',
      'app.tsx': `import { pad } from '${tokensImport}';\nexport const load = () => import('@reg/pkg');\nexport const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n`,
    } satisfies Record<string, string>;
    for (const [path, source] of Object.entries(analysed)) {
      writeFileSync(join(root, path), source);
    }
    const filesJson = JSON.stringify(
      Object.entries(analysed).map(([path, source]) => ({ path, source }))
    );
    const aliases = {
      aliases: [{ pattern: 'react', replacement: 'tokens', type: 'exact' }],
    };
    const engine = new v2.ExtractEngine(
      layout.aliased ? { pathAliasesJson: JSON.stringify(aliases) } : {}
    );
    const prepared = JSON.parse(engine.prepare(filesJson));
    const evidence = gatherProbeEvidence(
      root,
      new Set(Object.keys(analysed)),
      undefined
    )(prepared.bases, prepared.identity, prepared.loads, prepared.packages);
    const css = JSON.parse(engine.analyze(filesJson, evidence)).css;
    rmSync(root, { recursive: true, force: true });

    expect(css.includes('padding')).toBe(extracts);
  }
);

// Contract: the same, across analyses in one process. A registry package
// that gains a declared local dependency between two analyses, with the
// lockfile unchanged, reaches it in the second.
test('a registry package that gains a local dependency reaches it in the next analysis', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'animus-registry-')));
  const manifest = (dir: string, name: string, dependencies = {}) => {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(
      join(root, dir, 'package.json'),
      JSON.stringify({ name, version: '1.0.0', dependencies })
    );
  };
  manifest('.', 'app', { '@reg/pkg': '1.0.0', '@local/kit': 'workspace:*' });
  writeFileSync(join(root, 'bun.lock'), '{}\n');
  manifest('kit', '@local/kit');
  mkdirSync(join(root, 'node_modules/@local'), { recursive: true });
  symlinkSync(join(root, 'kit'), join(root, 'node_modules/@local/kit'));
  manifest('node_modules/@reg/pkg', '@reg/pkg');
  const analysed = {
    'kit/tokens.ts': 'export const pad = { padding: 4 };\n',
    'app.tsx':
      "import { pad } from './kit/tokens';\nexport const load = () => import('@reg/pkg');\nexport const C = ds.styles({ ...pad }).asElement('div');\nexport const App = () => <C />;\n",
  } satisfies Record<string, string>;
  for (const [path, source] of Object.entries(analysed)) {
    writeFileSync(join(root, path), source);
  }
  const filesJson = JSON.stringify(
    Object.entries(analysed).map(([path, source]) => ({ path, source }))
  );
  const analyse = () => {
    const engine = new v2.ExtractEngine({});
    const prepared = JSON.parse(engine.prepare(filesJson));
    const evidence = gatherProbeEvidence(
      root,
      new Set(Object.keys(analysed)),
      undefined
    )(prepared.bases, prepared.identity, prepared.loads, prepared.packages);
    return JSON.parse(engine.analyze(filesJson, evidence)).css.includes(
      'padding'
    );
  };
  const before = analyse();
  manifest('node_modules/@reg/pkg', '@reg/pkg', { '@local/kit': '1.0.0' });
  const after = analyse();
  rmSync(root, { recursive: true, force: true });

  expect({ before, after }).toEqual({ before: true, after: false });
});
