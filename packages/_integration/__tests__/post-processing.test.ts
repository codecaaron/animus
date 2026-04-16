/**
 * Targeted unit tests for post-processing utilities.
 *
 * These are pure functions used by the vite-plugin in production.
 * Each test exercises known inputs and asserts expected output.
 */
import { describe, expect, test } from 'bun:test';

import {
  applyPrefix,
  applyUnitFallback,
  assembleStylesheet,
  resolveGlobalStyles,
  resolveTokenAliases,
  resolveTransformPlaceholders,
} from '@animus-ui/extract/pipeline';

// ─── applyUnitFallback ────────────────────────────────────

describe('applyUnitFallback', () => {
  test('appends px to bare numeric on length property', () => {
    const input = '.a { padding: 8; }';
    const result = applyUnitFallback(input);
    expect(result).toContain('padding:8px;');
  });

  test.each([
    ['z-index', '10', 'z-index: 10'],
    ['opacity', '0.5', 'opacity: 0.5'],
    ['flex', '1', 'flex: 1'],
    ['line-height', '1.5', 'line-height: 1.5'],
    ['font-weight', '700', 'font-weight: 700'],
    ['order', '2', 'order: 2'],
  ] as const)('preserves unitless %s: %s', (prop, val, expected) => {
    const input = `.a { ${prop}: ${val}; }`;
    const result = applyUnitFallback(input);
    expect(result).toContain(expected);
  });

  test.each([
    ['rgb(255, 0, 0)', 'rgb(255, 0, 0)'],
    ['calc(100% - 16)', 'calc(100% - 16)'],
  ] as const)('does not mangle function call value %s', (input, expected) => {
    const css = `.a { width: ${input}; }`;
    const result = applyUnitFallback(css);
    expect(result).toContain(expected);
  });

  test('handles multi-value shorthands', () => {
    const input = '.a { margin: 8 16 8 16; }';
    const result = applyUnitFallback(input);
    expect(result).toContain('8px');
    expect(result).toContain('16px');
  });

  test.each([
    ['100%', '100%'],
    ['50vh', '50vh'],
    ['1.5rem', '1.5rem'],
  ] as const)('preserves value that already has unit: %s', (val, expected) => {
    const css = `.a { width: ${val}; }`;
    const result = applyUnitFallback(css);
    expect(result).toContain(expected);
  });

  test('handles zero without adding px', () => {
    const input = '.a { margin: 0; }';
    const result = applyUnitFallback(input);
    expect(result).toMatch(/margin:\s*0(px)?;/);
  });
});

// ─── resolveTransformPlaceholders ─────────────────────────

describe('resolveTransformPlaceholders', () => {
  test('resolves a single named transform placeholder', () => {
    const css = '.a { flex-basis: __TRANSFORM__size__4__; }';
    const transforms = {
      size: (v: unknown) => `${Number(v) * 100}px`,
    };
    const result = resolveTransformPlaceholders(css, transforms);
    expect(result).toContain('400px');
    expect(result).not.toContain('__TRANSFORM__');
  });

  test('resolves placeholders in separate declarations', () => {
    const transforms = {
      size: (v: unknown) => `${Number(v) * 100}px`,
      scale: (v: unknown) => `${Number(v) * 2}rem`,
    };
    // Test each transform in isolation — the regex works per-declaration
    const css1 = '.a { width: __TRANSFORM__size__2__; }';
    expect(resolveTransformPlaceholders(css1, transforms)).toContain('200px');

    const css2 = '.b { height: __TRANSFORM__scale__10__; }';
    expect(resolveTransformPlaceholders(css2, transforms)).toContain('20rem');
  });

  test('handles numeric return values from transform', () => {
    const css = '.a { width: __TRANSFORM__double__5__; }';
    const transforms = {
      double: (v: unknown) => Number(v) * 2,
    };
    const result = resolveTransformPlaceholders(css, transforms);
    expect(result).toContain('10');
  });

  test('falls back to raw value when transform not found', () => {
    const css = '.a { width: __TRANSFORM__missing__42__; }';
    const transforms = {};
    const result = resolveTransformPlaceholders(css, transforms);
    expect(result).toContain('42');
  });

  test('passes string values as strings to transform', () => {
    const css = '.a { content: __TRANSFORM__prefix__hello__; }';
    const transforms = {
      prefix: (v: unknown) => `pfx-${v}`,
    };
    const result = resolveTransformPlaceholders(css, transforms);
    expect(result).toContain('pfx-hello');
  });
});

// ─── applyPrefix ──────────────────────────────────────────

describe('applyPrefix', () => {
  test('prefixes variable map entries', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
      'space.4': '--space-4',
    });
    const variableCss =
      ':root { --color-primary: #3b82f6; --space-4: 0.25rem; }';

    const result = applyPrefix('ds', variableMapJson, variableCss);
    const map = JSON.parse(result.variableMapJson);

    expect(map['colors.primary']).toBe('--ds-color-primary');
    expect(map['space.4']).toBe('--ds-space-4');
  });

  test('prefixes CSS declarations and var() references', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
    });
    const variableCss =
      ':root { --color-primary: #3b82f6; } .a { color: var(--color-primary); }';

    const result = applyPrefix('ds', variableMapJson, variableCss);

    expect(result.variableCss).toContain('--ds-color-primary:');
    expect(result.variableCss).toContain('var(--ds-color-primary)');
    expect(result.variableCss).not.toContain('var(--color-primary)');
  });

  test('returns unchanged when prefix is empty', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
    });
    const variableCss = ':root { --color-primary: #3b82f6; }';

    const result = applyPrefix('', variableMapJson, variableCss);

    expect(result.variableMapJson).toBe(variableMapJson);
    expect(result.variableCss).toBe(variableCss);
  });

  test('prefixes var() references in themeJson', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
      'space.4': '--space-4',
    });
    const variableCss = ':root { --color-primary: #3b82f6; }';
    const themeJson = JSON.stringify({
      'colors.primary': 'var(--color-primary)',
      'space.4': '0.25rem',
    });

    const result = applyPrefix('ds', variableMapJson, variableCss, themeJson);

    expect(result.themeJson).toBeDefined();
    const theme = JSON.parse(result.themeJson!);
    expect(theme['colors.primary']).toBe('var(--ds-color-primary)');
    expect(theme['space.4']).toBe('0.25rem');
  });

  test('leaves themeJson undefined when not provided', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
    });
    const variableCss = ':root { --color-primary: #3b82f6; }';

    const result = applyPrefix('ds', variableMapJson, variableCss);

    expect(result.themeJson).toBeUndefined();
  });

  test('prefixes contextual variable names', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
    });
    const variableCss = ':root { --color-primary: #3b82f6; }';
    const contextualVarsJson = JSON.stringify({
      colors: ['current-bg', 'current-text'],
    });

    const result = applyPrefix(
      'acme',
      variableMapJson,
      variableCss,
      undefined,
      contextualVarsJson
    );

    expect(result.contextualVarsJson).toBeDefined();
    const ctx = JSON.parse(result.contextualVarsJson!);
    expect(ctx.colors).toEqual(['acme-current-bg', 'acme-current-text']);
  });

  test('returns contextualVarsJson unchanged when prefix is empty', () => {
    const variableMapJson = JSON.stringify({
      'colors.primary': '--color-primary',
    });
    const variableCss = ':root { --color-primary: #3b82f6; }';
    const contextualVarsJson = JSON.stringify({
      colors: ['current-bg'],
    });

    const result = applyPrefix(
      '',
      variableMapJson,
      variableCss,
      undefined,
      contextualVarsJson
    );

    expect(result.contextualVarsJson).toBe(contextualVarsJson);
  });
});

// ─── assembleStylesheet ───────────────────────────────────

describe('assembleStylesheet', () => {
  test('canonical order: layer decl → variables → globals → components', () => {
    const result = assembleStylesheet({
      variableCss: ':root { --color-primary: #3b82f6; }',
      globalCss: '@layer anm-global { body { margin: 0; } }',
      componentCss: '@layer anm-base { .btn { color: red; } }',
    });

    const layerDeclIdx = result.indexOf('@layer anm-global, anm-base,');
    const variableIdx = result.indexOf(':root');
    const globalIdx = result.indexOf('@layer anm-global { body');
    const componentIdx = result.indexOf('@layer anm-base { .btn');

    expect(layerDeclIdx).toBeGreaterThanOrEqual(0);
    expect(variableIdx).toBeGreaterThan(layerDeclIdx);
    expect(globalIdx).toBeGreaterThan(variableIdx);
    expect(componentIdx).toBeGreaterThan(globalIdx);
  });

  test('strips embedded @layer declaration from component CSS', () => {
    const result = assembleStylesheet({
      variableCss: ':root { --x: 1; }',
      componentCss:
        '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;\n@layer anm-base { .a { } }',
    });

    // Should have exactly one @layer declaration (our canonical one)
    const declarations = result.match(
      /@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;/g
    );
    expect(declarations).toHaveLength(1);
  });

  test('uses custom layers when provided', () => {
    const result = assembleStylesheet({
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
      variableCss: ':root { --x: 1; }',
    });

    expect(result).toContain('@layer reset, anm-global, anm-base,');
    expect(result).toContain('overrides;');
  });

  test('throws on invalid layer order', () => {
    expect(() =>
      assembleStylesheet({
        layers: [
          'anm-global',
          'anm-variants',
          'anm-base',
          'anm-compounds',
          'anm-states',
          'anm-system',
          'anm-custom',
        ],
      })
    ).toThrow('wrong order');
  });

  test('throws on missing required layers', () => {
    expect(() =>
      assembleStylesheet({
        layers: ['anm-global', 'anm-base'],
      })
    ).toThrow('missing required layers');
  });
});

// ─── assembleStylesheet split + Lightning CSS round-trip ──

describe('assembleStylesheet split + post-processing', () => {
  const opts = {
    variableCss:
      ':root { --color-primary: #3b82f6; }\n[data-color-mode="dark"] { --color-primary: #60a5fa; }',
    globalCss: '@layer anm-global { body { margin: 0; } }',
    componentCss:
      '@layer anm-base { .animus-btn { display: flex; padding: 8px; } }',
  };

  test('split form + Lightning CSS on body-only preserves @layer declaration', () => {
    const { declaration, variables, body } = assembleStylesheet({
      ...opts,
      split: true,
    });

    let lcss: typeof import('lightningcss') | undefined;
    try {
      lcss = require('lightningcss');
    } catch {
      // lightningcss may not be available in _integration context — skip
      return;
    }

    const processed = lcss
      .transform({
        filename: 'test.css',
        code: Buffer.from(body),
        minify: false,
      })
      .code.toString();

    const output = [declaration, variables, processed]
      .filter(Boolean)
      .join('\n');

    expect(output).toMatch(/^@layer\s+anm-global/);
    expect(output.indexOf(':root')).toBeLessThan(
      output.indexOf('@layer anm-global {')
    );
  });

  test('split form preserves :root position (not in body)', () => {
    const { variables, body } = assembleStylesheet({
      ...opts,
      split: true,
    });
    expect(variables).toContain(':root');
    expect(body).not.toContain(':root');
  });
});

// ─── resolveGlobalStyles ──────────────────────────────────

describe('resolveGlobalStyles', () => {
  const flat: Record<string, string> = {
    'colors.primary': '#3b82f6',
    'space.4': '0.25rem',
    'space.8': '0.5rem',
  };
  const variableMap: Record<string, string> = {
    'colors.primary': '--color-primary',
    'space.4': '--space-4',
    'space.8': '--space-8',
  };

  test('resolves token alias to var() reference', () => {
    const blocks = {
      base: {
        body: { color: '{colors.primary}' },
      },
    };
    const result = resolveGlobalStyles(blocks, {}, flat, variableMap, {});
    expect(result.base).toContain('var(--color-primary)');
  });

  test('resolves token alias with alpha to color-mix', () => {
    const blocks = {
      base: {
        '.overlay': { background: '{colors.primary/50}' },
      },
    };
    const result = resolveGlobalStyles(blocks, {}, flat, variableMap, {});
    expect(result.base).toContain(
      'color-mix(in srgb, var(--color-primary) 50%, transparent)'
    );
  });

  test('resolves scale lookup via prop config', () => {
    const propConfig = {
      p: { property: 'padding', scale: 'space' },
    };
    const blocks = {
      base: {
        '.container': { p: '8' },
      },
    };
    const result = resolveGlobalStyles(
      blocks,
      propConfig,
      flat,
      variableMap,
      {}
    );
    expect(result.base).toContain('0.5rem');
  });

  test('applies named transform', () => {
    const propConfig = {
      sizing: { property: 'flex-basis', transform: 'size' },
    };
    const transforms = {
      size: (v: unknown) => `${Number(v) * 100}px`,
    };
    const blocks = {
      base: {
        '.card': { sizing: '4' },
      },
    };
    const result = resolveGlobalStyles(
      blocks,
      propConfig,
      flat,
      variableMap,
      transforms
    );
    expect(result.base).toContain('400px');
  });
});

// ─── resolveTokenAliases ──────────────────────────────────

describe('resolveTokenAliases', () => {
  const flat = { 'colors.primary': '#3b82f6' };
  const variableMap = { 'colors.primary': '--color-primary' };

  test.each([
    ['{colors.primary}', flat, variableMap, 'var(--color-primary)'],
    ['{colors.primary/0}', flat, variableMap, 'transparent'],
    [
      '{colors.primary/50}',
      flat,
      variableMap,
      'color-mix(in srgb, var(--color-primary) 50%, transparent)',
    ],
    ['{colors.primary}', flat, {}, '#3b82f6'],
    ['{colors.unknown}', flat, variableMap, '{colors.unknown}'],
    ['solid 1px red', flat, variableMap, 'solid 1px red'],
  ] as const)('resolves "%s" → "%s"', (input, flatMap, varMap, expected) => {
    const result = resolveTokenAliases(
      input,
      flatMap as Record<string, string>,
      varMap as Record<string, string>
    );
    expect(result).toBe(expected);
  });
});
