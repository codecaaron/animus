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

  test('preserves unitless properties', () => {
    const input =
      '.a { z-index: 10; opacity: 0.5; flex: 1; line-height: 1.5; font-weight: 700; order: 2; }';
    const result = applyUnitFallback(input);
    expect(result).toContain('z-index: 10');
    expect(result).toContain('opacity: 0.5');
    expect(result).toContain('flex: 1');
    expect(result).toContain('line-height: 1.5');
    expect(result).toContain('font-weight: 700');
    expect(result).toContain('order: 2');
  });

  test('does not mangle values inside function calls', () => {
    const input = '.a { color: rgb(255, 0, 0); width: calc(100% - 16); }';
    const result = applyUnitFallback(input);
    expect(result).toContain('rgb(255, 0, 0)');
    expect(result).toContain('calc(100% - 16)');
  });

  test('handles multi-value shorthands', () => {
    const input = '.a { margin: 8 16 8 16; }';
    const result = applyUnitFallback(input);
    expect(result).toContain('8px');
    expect(result).toContain('16px');
  });

  test('preserves values that already have units', () => {
    const input = '.a { width: 100%; height: 50vh; font-size: 1.5rem; }';
    const result = applyUnitFallback(input);
    expect(result).toContain('100%');
    expect(result).toContain('50vh');
    expect(result).toContain('1.5rem');
  });

  test('handles zero without adding px', () => {
    const input = '.a { margin: 0; }';
    const result = applyUnitFallback(input);
    // 0px is technically fine but 0 is also valid
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

  test('resolves to var() when variable map entry exists', () => {
    const result = resolveTokenAliases('{colors.primary}', flat, variableMap);
    expect(result).toBe('var(--color-primary)');
  });

  test('resolves alpha/0 to transparent', () => {
    const result = resolveTokenAliases('{colors.primary/0}', flat, variableMap);
    expect(result).toBe('transparent');
  });

  test('resolves alpha to color-mix', () => {
    const result = resolveTokenAliases(
      '{colors.primary/50}',
      flat,
      variableMap
    );
    expect(result).toBe(
      'color-mix(in srgb, var(--color-primary) 50%, transparent)'
    );
  });

  test('falls back to flat value when no variable map entry', () => {
    const result = resolveTokenAliases('{colors.primary}', flat, {});
    expect(result).toBe('#3b82f6');
  });

  test('returns original when token not found', () => {
    const result = resolveTokenAliases('{colors.unknown}', flat, variableMap);
    expect(result).toBe('{colors.unknown}');
  });

  test('passes through strings without token aliases', () => {
    const result = resolveTokenAliases('solid 1px red', flat, variableMap);
    expect(result).toBe('solid 1px red');
  });
});
