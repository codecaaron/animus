import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, test } from 'vitest';

import { probeAbsolutePathSpecifier } from '../pipeline/discover-packages';
import {
  extensionPolicyJson,
  viteExtensionPolicy,
} from '../pipeline/host-extensions';
import { gatherProbeEvidence } from '../pipeline/probe-evidence';

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
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
  });

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
      '@layer base, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, utilities;'
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
      '@layer reset, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, overrides;'
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
    expect(declaration).toContain('@layer anm-global, anm-base');
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
