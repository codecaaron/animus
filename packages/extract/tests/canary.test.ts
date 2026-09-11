import { join } from 'path';
import { describe, expect, test } from 'vitest';

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
