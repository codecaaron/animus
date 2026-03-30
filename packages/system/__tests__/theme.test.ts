/**
 * Snapshot tests for the ThemeBuilder's load-bearing return shapes.
 *
 * These catch regressions in:
 * - _variables (CSS variable declarations for :root, color modes, breakpoints)
 * - _tokens (raw values for color mode resolution)
 * - serializeTokens (token→var() reference + variable map generation)
 * - The full .build() shape
 *
 * If a snapshot changes, verify the extraction pipeline still produces
 * correct CSS variables: `bun run verify:showcase`
 */
import { describe, expect, it, spyOn } from 'bun:test';

import { createTheme } from '../src';
import { serializeTokens } from '../src/theme/serializeTokens';

// ─── Fixtures ────────────────────────────────────────────────

const base = {
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
} as const;

/**
 * Representative theme chain matching showcase complexity:
 * scales + colors + color modes + nested color objects
 */
function buildTestTheme() {
  return createTheme(base)
    .addScale({
      name: 'space',
      values: { 0: '0', 4: '0.25rem', 8: '0.5rem', 16: '1rem' },
    })
    .addScale({
      name: 'fontSizes',
      values: { 14: '0.875rem', 16: '1rem', 24: '1.5rem' },
    })
    .addScale({
      name: 'fonts',
      values: { body: 'Georgia, serif', mono: 'monospace' },
    })
    .addColors({
      void: '#000000',
      ember: '#ff2800',
      bone: '#e8e0d0',
      gray: { 300: '#666666', 600: '#333333' },
    })
    .addColorModes('dark', {
      dark: {
        primary: 'ember',
        bg: 'void',
        muted: 'gray-300',
      },
      light: {
        primary: 'void',
        bg: 'bone',
        muted: 'gray-600',
      },
    })
    .build();
}

// ─── Tests ───────────────────────────────────────────────────

describe('ThemeBuilder.build() shape', () => {
  const theme = buildTestTheme();

  it('produces _variables with root, mode, and breakpoints', () => {
    expect(theme._variables).toMatchInlineSnapshot(`
      {
        "breakpoints": {
          "--breakpoint-lg": "1200px",
          "--breakpoint-md": "1024px",
          "--breakpoint-sm": "768px",
          "--breakpoint-xl": "1440px",
          "--breakpoint-xs": "480px",
        },
        "mode": {
          "--color-bg": "var(--color-void)",
          "--color-muted": "var(--color-gray-300)",
          "--color-primary": "var(--color-ember)",
        },
        "root": {
          "--color-bone": "#e8e0d0",
          "--color-ember": "#ff2800",
          "--color-gray-300": "#666666",
          "--color-gray-600": "#333333",
          "--color-void": "#000000",
        },
      }
    `);
  });

  it('produces _tokens with raw color values and mode mappings', () => {
    expect(theme._tokens).toMatchInlineSnapshot(`
      {
        "colors": {
          "bone": "#e8e0d0",
          "ember": "#ff2800",
          "gray-300": "#666666",
          "gray-600": "#333333",
          "void": "#000000",
        },
        "modes": {
          "dark": {
            "bg": "#000000",
            "muted": "#666666",
            "primary": "#ff2800",
          },
          "light": {
            "bg": "#e8e0d0",
            "muted": "#333333",
            "primary": "#000000",
          },
        },
      }
    `);
  });

  it('produces color references as CSS var() calls', () => {
    expect(theme.colors).toMatchInlineSnapshot(`
      {
        "bg": "var(--color-bg)",
        "bone": "var(--color-bone)",
        "ember": "var(--color-ember)",
        "gray-300": "var(--color-gray-300)",
        "gray-600": "var(--color-gray-600)",
        "muted": "var(--color-muted)",
        "primary": "var(--color-primary)",
        "void": "var(--color-void)",
      }
    `);
  });

  it('produces complete build output', () => {
    // Exclude _getColorValue (function) for snapshot stability
    const { _getColorValue, ...snapshotSafe } = theme;
    expect(snapshotSafe).toMatchInlineSnapshot(`
      {
        "_tokens": {
          "colors": {
            "bone": "#e8e0d0",
            "ember": "#ff2800",
            "gray-300": "#666666",
            "gray-600": "#333333",
            "void": "#000000",
          },
          "modes": {
            "dark": {
              "bg": "#000000",
              "muted": "#666666",
              "primary": "#ff2800",
            },
            "light": {
              "bg": "#e8e0d0",
              "muted": "#333333",
              "primary": "#000000",
            },
          },
        },
        "_variables": {
          "breakpoints": {
            "--breakpoint-lg": "1200px",
            "--breakpoint-md": "1024px",
            "--breakpoint-sm": "768px",
            "--breakpoint-xl": "1440px",
            "--breakpoint-xs": "480px",
          },
          "mode": {
            "--color-bg": "var(--color-void)",
            "--color-muted": "var(--color-gray-300)",
            "--color-primary": "var(--color-ember)",
          },
          "root": {
            "--color-bone": "#e8e0d0",
            "--color-ember": "#ff2800",
            "--color-gray-300": "#666666",
            "--color-gray-600": "#333333",
            "--color-void": "#000000",
          },
        },
        "breakpoints": {
          "lg": 1200,
          "md": 1024,
          "sm": 768,
          "xl": 1440,
          "xs": 480,
        },
        "colors": {
          "bg": "var(--color-bg)",
          "bone": "var(--color-bone)",
          "ember": "var(--color-ember)",
          "gray-300": "var(--color-gray-300)",
          "gray-600": "var(--color-gray-600)",
          "muted": "var(--color-muted)",
          "primary": "var(--color-primary)",
          "void": "var(--color-void)",
        },
        "fontSizes": {
          "14": "0.875rem",
          "16": "1rem",
          "24": "1.5rem",
        },
        "fonts": {
          "body": "Georgia, serif",
          "mono": "monospace",
        },
        "mode": "dark",
        "modes": {
          "dark": {
            "bg": "void",
            "muted": "gray-300",
            "primary": "ember",
          },
          "light": {
            "bg": "bone",
            "muted": "gray-600",
            "primary": "void",
          },
        },
        "space": {
          "0": "0",
          "16": "1rem",
          "4": "0.25rem",
          "8": "0.5rem",
        },
      }
    `);
  });
});

describe('ThemeBuilder._variables structure', () => {
  const theme = buildTestTheme();

  it('root contains color variable declarations', () => {
    expect(Object.keys(theme._variables.root).length).toBeGreaterThan(0);
    // Every root key is a CSS custom property
    for (const key of Object.keys(theme._variables.root)) {
      expect(key).toMatch(/^--/);
    }
  });

  it('mode contains semantic color aliases as var() references', () => {
    expect(Object.keys(theme._variables.mode).length).toBeGreaterThan(0);
    for (const value of Object.values(theme._variables.mode)) {
      expect(value).toMatch(/^var\(--/);
    }
  });

  it('breakpoints contains px-suffixed values', () => {
    expect(Object.keys(theme._variables.breakpoints)).toHaveLength(5);
    for (const value of Object.values(theme._variables.breakpoints)) {
      expect(value).toMatch(/px$/);
    }
  });
});

describe('serializeTokens', () => {
  it('produces token references and variable declarations', () => {
    const result = serializeTokens({ red: '#f00', blue: '#00f' }, 'color', {
      breakpoints: base.breakpoints,
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "tokens": {
          "blue": "var(--color-blue)",
          "red": "var(--color-red)",
        },
        "variables": {
          "--color-blue": "#00f",
          "--color-red": "#f00",
        },
      }
    `);
  });

  it('handles nested/flattened color objects', () => {
    const result = serializeTokens(
      { 'gray-300': '#666', 'gray-600': '#333' },
      'color',
      { breakpoints: base.breakpoints }
    );
    expect(result).toMatchInlineSnapshot(`
      {
        "tokens": {
          "gray-300": "var(--color-gray-300)",
          "gray-600": "var(--color-gray-600)",
        },
        "variables": {
          "--color-gray-300": "#666",
          "--color-gray-600": "#333",
        },
      }
    `);
  });
});

describe('createTheme minimal', () => {
  it('breakpoints-only theme has _variables.breakpoints', () => {
    const theme = createTheme(base).build();
    expect(theme._variables).toMatchInlineSnapshot(`
      {
        "breakpoints": {
          "--breakpoint-lg": "1200px",
          "--breakpoint-md": "1024px",
          "--breakpoint-sm": "768px",
          "--breakpoint-xl": "1440px",
          "--breakpoint-xs": "480px",
        },
      }
    `);
  });
});

describe('addScale config object', () => {
  it('produces correct theme shape with config object', () => {
    const theme = createTheme(base)
      .addScale({
        name: 'space',
        values: { 0: '0', 4: '0.25rem', 8: '0.5rem' },
      })
      .build();

    expect(theme.space).toEqual({
      0: '0',
      4: '0.25rem',
      8: '0.5rem',
    });
  });

  it('emit: true produces CSS variable declarations and var() references', () => {
    const theme = createTheme(base)
      .addScale({
        name: 'sizes',
        emit: true,
        values: { navHeight: '48px', sidebarWidth: '200px' },
      })
      .build();

    // Values replaced with var() references
    expect(theme.sizes.navHeight).toBe('var(--sizes-navHeight)');
    expect(theme.sizes.sidebarWidth).toBe('var(--sizes-sidebarWidth)');

    // CSS variable declarations in _variables
    expect(theme._variables.sizes).toEqual({
      '--sizes-navHeight': '48px',
      '--sizes-sidebarWidth': '200px',
    });

    // Raw values preserved in _tokens
    expect(theme._tokens.sizes).toEqual({
      navHeight: '48px',
      sidebarWidth: '200px',
    });
  });

  it('emit: false (default) produces raw values with no CSS variables', () => {
    const theme = createTheme(base)
      .addScale({
        name: 'space',
        values: { 0: '0', 8: '0.5rem' },
      })
      .build();

    expect(theme.space[0]).toBe('0');
    expect(theme.space[8]).toBe('0.5rem');
    expect(theme._variables.space).toBeUndefined();
  });

  it('nested scale values are flattened correctly', () => {
    const theme = createTheme(base)
      .addScale({
        name: 'test',
        values: { nested: { a: '1px', b: '2px' } },
      })
      .build();

    expect(theme.test['nested-a']).toBe('1px');
    expect(theme.test['nested-b']).toBe('2px');
  });
});

describe('token ref resolution in scale values', () => {
  it('resolves {colors.key} to var(--color-key) in scale values', () => {
    const theme = createTheme(base)
      .addColors({ ember: '#ff2800' })
      .addColorModes('dark', {
        dark: { text: 'ember' },
        light: { text: 'ember' },
      })
      .addScale({
        name: 'shadows',
        values: { glow: '0 0 12px {colors.text}' },
      })
      .build();

    // {colors.text} should resolve to the theme's colors.text value (a var() ref)
    expect(theme.shadows.glow).toContain('var(--color-text)');
    expect(theme.shadows.glow).toBe('0 0 12px var(--color-text)');
  });

  it('resolves {scale.key} to var(--scale-key) for emitted scales', () => {
    const theme = createTheme(base)
      .addScale({
        name: 'sizes',
        emit: true,
        values: { navHeight: '48px' },
      })
      .addScale({
        name: 'layout',
        values: { stickyTop: 'calc({sizes.navHeight} + 16px)' },
      })
      .build();

    expect(theme.layout.stickyTop).toBe('calc(var(--sizes-navHeight) + 16px)');
  });

  it('leaves unresolvable refs unchanged and warns', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const theme = createTheme(base)
      .addScale({
        name: 'test',
        values: { val: '{bogus.key}' },
      })
      .build();

    expect(theme.test.val).toBe('{bogus.key}');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe('ThemeManifest', () => {
  const theme = buildTestTheme();

  it('manifest.tokenMap includes breakpoints', () => {
    const tokenMap = theme.manifest.tokenMap;
    expect(tokenMap['breakpoints.xs']).toBe('480');
    expect(tokenMap['breakpoints.sm']).toBe('768');
    expect(tokenMap['breakpoints.md']).toBe('1024');
    expect(tokenMap['breakpoints.lg']).toBe('1200');
    expect(tokenMap['breakpoints.xl']).toBe('1440');
  });

  it('manifest.tokenMap includes scales and colors', () => {
    const tokenMap = theme.manifest.tokenMap;
    expect(tokenMap['space.4']).toBe('0.25rem');
    expect(tokenMap['fontSizes.16']).toBe('1rem');
    expect(tokenMap['colors.ember']).toBe('var(--color-ember)');
  });

  it('manifest.variableMap maps token paths to CSS var names', () => {
    const variableMap = theme.manifest.variableMap;
    expect(variableMap['colors.ember']).toBe('--color-ember');
    expect(variableMap['colors.primary']).toBe('--color-primary');
    // Breakpoints are not CSS variables — they should not be in variableMap
    expect(variableMap['breakpoints.xs']).toBeUndefined();
  });
});

describe('theme.serialize()', () => {
  const theme = buildTestTheme();

  it('returns all 4 JSON strings', () => {
    const result = theme.serialize();
    expect(typeof result.scalesJson).toBe('string');
    expect(typeof result.variableMapJson).toBe('string');
    expect(typeof result.variableCss).toBe('string');
    expect(typeof result.contextualVarsJson).toBe('string');
  });

  it('scalesJson parses to flattened token map with breakpoints', () => {
    const scales = JSON.parse(theme.serialize().scalesJson);
    expect(scales['space.4']).toBe('0.25rem');
    expect(scales['space.8']).toBe('0.5rem');
    expect(scales['fontSizes.16']).toBe('1rem');
    expect(scales['colors.ember']).toBe('var(--color-ember)');
    expect(scales['breakpoints.xs']).toBe('480');
    expect(scales['breakpoints.sm']).toBe('768');
    expect(scales['breakpoints.md']).toBe('1024');
  });

  it('variableMapJson parses to token-to-CSS-var mapping', () => {
    const varMap = JSON.parse(theme.serialize().variableMapJson);
    expect(varMap['colors.ember']).toBe('--color-ember');
    expect(varMap['colors.primary']).toBe('--color-primary');
    // Breakpoints should not appear (they're not CSS variables)
    expect(varMap['breakpoints.xs']).toBeUndefined();
  });

  it('variableCss contains :root and color mode blocks', () => {
    const css = theme.serialize().variableCss;
    expect(css).toContain(':root {');
    expect(css).toContain('--color-ember: #ff2800');
    expect(css).toContain('[data-color-mode="dark"]');
    expect(css).toContain('[data-color-mode="light"]');
  });

  it('contextualVarsJson is empty object when none declared', () => {
    expect(theme.serialize().contextualVarsJson).toBe('{}');
  });

  it('contextualVarsJson includes declared vars', () => {
    const withCtx = createTheme(base)
      .addColors({ bg: '#000' })
      .addColorModes('dark', {
        dark: { text: 'bg' },
        light: { text: 'bg' },
      })
      .addContextualVars({ colors: ['background-current'] })
      .build();
    const ctx = JSON.parse(withCtx.serialize().contextualVarsJson);
    expect(ctx.colors).toEqual(['background-current']);
  });

  it('evaluate is non-enumerable', () => {
    const spread = { ...theme };
    expect('evaluate' in spread).toBe(false);
    expect(Object.keys(theme)).not.toContain('evaluate');
  });

  it('scalesJson matches legacy flatten output', () => {
    // Replicate legacy evaluateThemeObjectLegacy flattening
    const flat: Record<string, string> = {};

    function legacyFlatten(
      target: Record<string, string>,
      prefix: string,
      obj: Record<string, unknown>,
      parentKey = ''
    ): void {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = parentKey ? `${parentKey}-${key}` : key;
        if (
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          legacyFlatten(
            target,
            prefix,
            value as Record<string, unknown>,
            fullKey
          );
        } else {
          target[`${prefix}.${fullKey}`] = String(value);
        }
      }
    }

    for (const [scaleName, scaleValue] of Object.entries(theme)) {
      if (scaleName.startsWith('_')) continue;
      if (scaleName === 'mode' || scaleName === 'modes') continue;
      if (typeof scaleValue === 'function') continue;
      if (
        typeof scaleValue === 'object' &&
        scaleValue !== null &&
        !Array.isArray(scaleValue)
      ) {
        legacyFlatten(flat, scaleName, scaleValue as Record<string, unknown>);
      }
    }

    const legacyScalesJson = JSON.stringify(flat);
    expect(theme.serialize().scalesJson).toBe(legacyScalesJson);
  });

  it('variableMapJson matches legacy var() extraction', () => {
    const scales = JSON.parse(theme.serialize().scalesJson);
    const legacyVarMap: Record<string, string> = {};
    for (const [tokenPath, value] of Object.entries(scales)) {
      if (
        typeof value === 'string' &&
        value.startsWith('var(') &&
        value.endsWith(')')
      ) {
        legacyVarMap[tokenPath] = value.slice(4, -1);
      }
    }
    expect(theme.serialize().variableMapJson).toBe(
      JSON.stringify(legacyVarMap)
    );
  });

  it('contextualVarsJson matches legacy extraction', () => {
    const withCtx = createTheme(base)
      .addColors({ bg: '#000' })
      .addColorModes('dark', {
        dark: { text: 'bg' },
        light: { text: 'bg' },
      })
      .addContextualVars({ colors: ['background-current'] })
      .build();

    // Legacy path reads _contextualVars directly
    const legacyCtx =
      (withCtx as Record<string, unknown>)._contextualVars &&
      typeof (withCtx as Record<string, unknown>)._contextualVars === 'object'
        ? (withCtx as Record<string, unknown>)._contextualVars
        : {};
    expect(withCtx.serialize().contextualVarsJson).toBe(
      JSON.stringify(legacyCtx)
    );
  });
});
