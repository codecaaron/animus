import { join } from 'path';
import { describe, expect, test } from 'vitest';

/**
 * verify:canary — v2 NAPI boundary snapshot tests.
 *
 * Since retire-extract-v1 the canary exercises the v2 engine's native boundary
 * only (`index-v2.js`). Engine extraction/parity behavior is owned by
 * verify:parity (committed baselines) and verify:integration (full pipeline);
 * this tier proves the v2 binary loads and its `loadSystemModule` NAPI function
 * evaluates a real SystemInstance module across the FFI boundary. The
 * `assembleStylesheet` blocks below cover the pure TS pipeline export (no
 * engine involvement) and require a fresh `dist/`.
 */
const v2 = require('../index-v2.js');

describe('v2 system loader NAPI boundary', () => {
  const root = join(__dirname, '../../..');
  const systemPath = join(__dirname, 'test-system.ts');

  test('loadSystemModule returns a fully-populated NapiSystemConfig', () => {
    const config = v2.loadSystemModule(systemPath, root);

    // Required string fields (NAPI snake_case → camelCase auto-conversion).
    // Explicit picks: NAPI class instances expose fields as getters, not own
    // enumerable properties, so toMatchObject(config) cannot see them.
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

    // The JSON-bearing fields must parse.
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

// ---------------------------------------------------------------------------
// assembleStylesheet: canonical anm- layer names (pure TS pipeline export)
// ---------------------------------------------------------------------------
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

// assembleStylesheet: @property registration split contract (rehomed from
// packages/vite-plugin/tests/property-registration-split.test.ts — the suite
// exercises the shared pipeline export, not any Vite seam, so the extract
// owner is its home). typed-property-registration: "@property rules SHALL
// appear in the variables part of the assembled stylesheet, before any
// @layer block."
describe('assembleStylesheet: @property registration split', () => {
  const { assembleStylesheet: assemble } = require('../dist/index.mjs');

  // Exactly the shape createTheme's serialize().variableCss produces for a
  // registered contextual var (see packages/system/__tests__/theme.test.ts).
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
    // declaration remains only the @layer ordering statement.
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
    // @property sits in the variables part, after the ordering declaration
    // line but before any component @layer block.
    expect(propIdx).toBeGreaterThan(declIdx);
    expect(layerBaseIdx).toBeGreaterThan(propIdx);
  });
});
