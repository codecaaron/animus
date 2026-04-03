/**
 * Tests for ThemeBuilder v3: nested storage, dot-path, type-state chain.
 *
 * These catch regressions in:
 * - Nested storage (colors, scales, modes stored as raw inputs)
 * - Build-time flattening (manifest, serialize produce correct flat output)
 * - Composition via from() and spreading
 * - varRef() accessor
 * - Non-enumerable boundary methods
 */
import { describe, expect, it, spyOn } from 'bun:test';

import { createTheme } from '../src';

// ─── Fixtures ────────────────────────────────────────────────

const breakpoints = { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 } as const;

/**
 * Representative theme chain matching showcase complexity:
 * scales + colors + color modes + nested color objects
 */
function buildTestTheme() {
  return createTheme()
    .addBreakpoints(breakpoints)
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
        muted: 'gray.300',
      },
      light: {
        primary: 'void',
        bg: 'bone',
        muted: 'gray.600',
      },
    })
    .build();
}

// ─── Tests: Nested Storage ──────────────────────────────────

describe('ThemeBuilder nested storage', () => {
  const theme = buildTestTheme();

  it('colors are stored nested after build', () => {
    // Runtime stores nested objects; type is LiteralPaths (flat dot-paths)
    expect(theme.colors as unknown).toEqual({
      void: '#000000',
      ember: '#ff2800',
      bone: '#e8e0d0',
      gray: { 300: '#666666', 600: '#333333' },
    });
  });

  it('scales are stored as raw values after build', () => {
    expect(theme.space).toEqual({
      0: '0',
      4: '0.25rem',
      8: '0.5rem',
      16: '1rem',
    });
    expect(theme.fontSizes).toEqual({
      14: '0.875rem',
      16: '1rem',
      24: '1.5rem',
    });
  });

  it('modes are stored as raw alias maps after build', () => {
    // @ts-expect-error — modes is runtime-only, not on BuiltTheme type
    expect(theme.modes).toEqual({
      dark: { primary: 'ember', bg: 'void', muted: 'gray.300' },
      light: { primary: 'void', bg: 'bone', muted: 'gray.600' },
    });
  });

  it('mode key is stored', () => {
    // @ts-expect-error — mode is runtime-only, not on BuiltTheme type
    expect(theme.mode).toBe('dark');
  });

  it('breakpoints are stored as-is', () => {
    expect(theme.breakpoints).toEqual(breakpoints);
  });

  it('no _variables on theme', () => {
    expect((theme as Record<string, unknown>)._variables).toBeUndefined();
  });

  it('no _tokens on theme', () => {
    expect((theme as Record<string, unknown>)._tokens).toBeUndefined();
  });

  it('nested scale values preserved (not flattened)', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'test',
        values: { nested: { a: '1px', b: '2px' } },
      })
      .build();

    // Runtime stores nested objects; type is LiteralPaths (flat dot-paths)
    expect(theme.test as unknown).toEqual({ nested: { a: '1px', b: '2px' } });
  });
});

// ─── Tests: Build-Time Flatten (Manifest) ───────────────────

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

  it('manifest.tokenMap includes scales with dot-path keys', () => {
    const tokenMap = theme.manifest.tokenMap;
    expect(tokenMap['space.4']).toBe('0.25rem');
    expect(tokenMap['fontSizes.16']).toBe('1rem');
  });

  it('manifest.tokenMap includes colors as var() refs with dot-path keys', () => {
    const tokenMap = theme.manifest.tokenMap;
    expect(tokenMap['colors.ember']).toBe('var(--color-ember)');
    expect(tokenMap['colors.gray.300']).toBe('var(--color-gray-300)');
    expect(tokenMap['colors.void']).toBe('var(--color-void)');
  });

  it('manifest.tokenMap includes semantic aliases as var() refs', () => {
    const tokenMap = theme.manifest.tokenMap;
    expect(tokenMap['colors.primary']).toBe('var(--color-primary)');
    expect(tokenMap['colors.bg']).toBe('var(--color-bg)');
    expect(tokenMap['colors.muted']).toBe('var(--color-muted)');
  });

  it('manifest.variableMap maps dot-path to dash-join CSS var names', () => {
    const variableMap = theme.manifest.variableMap;
    expect(variableMap['colors.ember']).toBe('--color-ember');
    expect(variableMap['colors.gray.300']).toBe('--color-gray-300');
    expect(variableMap['colors.primary']).toBe('--color-primary');
    expect(variableMap['breakpoints.xs']).toBeUndefined();
  });

  it('manifest.variableCss contains :root and mode blocks', () => {
    const css = theme.manifest.variableCss;
    expect(css).toContain(':root {');
    expect(css).toContain('--color-ember: #ff2800');
    expect(css).toContain('--color-void: #000000');
    expect(css).toContain('[data-color-mode="dark"]');
    expect(css).toContain('[data-color-mode="light"]');
  });

  it('manifest.modes contains resolved raw values', () => {
    const modes = theme.manifest.modes;
    expect(modes.dark).toBeDefined();
    expect(modes.light).toBeDefined();
    expect(modes.dark['colors.primary']).toBe('#ff2800'); // ember
    expect(modes.dark['colors.bg']).toBe('#000000'); // void
    expect(modes.light['colors.primary']).toBe('#000000'); // void
    expect(modes.light['colors.bg']).toBe('#e8e0d0'); // bone
  });
});

// ─── Tests: Serialization ───────────────────────────────────

describe('theme.serialize()', () => {
  const theme = buildTestTheme();

  it('returns all 4 JSON strings', () => {
    const result = theme.serialize();
    expect(typeof result.scalesJson).toBe('string');
    expect(typeof result.variableMapJson).toBe('string');
    expect(typeof result.variableCss).toBe('string');
    expect(typeof result.contextualVarsJson).toBe('string');
  });

  it('scalesJson parses to dot-path keyed token map with breakpoints', () => {
    const scales = JSON.parse(theme.serialize().scalesJson);
    expect(scales['space.4']).toBe('0.25rem');
    expect(scales['space.8']).toBe('0.5rem');
    expect(scales['fontSizes.16']).toBe('1rem');
    expect(scales['colors.ember']).toBe('var(--color-ember)');
    expect(scales['colors.gray.300']).toBe('var(--color-gray-300)');
    expect(scales['breakpoints.xs']).toBe('480');
  });

  it('variableMapJson maps dot-path keys to dash-join CSS var names', () => {
    const varMap = JSON.parse(theme.serialize().variableMapJson);
    expect(varMap['colors.ember']).toBe('--color-ember');
    expect(varMap['colors.gray.300']).toBe('--color-gray-300');
    expect(varMap['colors.primary']).toBe('--color-primary');
    expect(varMap['breakpoints.xs']).toBeUndefined();
  });

  it('variableCss contains :root with dash-join CSS var names', () => {
    const css = theme.serialize().variableCss;
    expect(css).toContain(':root {');
    expect(css).toContain('--color-ember: #ff2800');
    expect(css).toContain('--breakpoint-sm: 768px');
  });

  it('contextualVarsJson is empty object when none declared', () => {
    expect(theme.serialize().contextualVarsJson).toBe('{}');
  });

  it('contextualVarsJson includes declared vars', () => {
    const withCtx = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ bg: '#000' })
      .addColorModes('dark', {
        dark: { text: 'bg' },
        light: { text: 'bg' },
      })
      .declareContextualVars({ colors: ['background-current'] })
      .build();
    const ctx = JSON.parse(withCtx.serialize().contextualVarsJson);
    expect(ctx.colors).toEqual(['background-current']);
  });

  it('serialize is non-enumerable', () => {
    const spread = { ...theme };
    expect('serialize' in spread).toBe(false);
    expect(Object.keys(theme)).not.toContain('serialize');
  });

  it('manifest is non-enumerable', () => {
    const spread = { ...theme };
    expect('manifest' in spread).toBe(false);
    expect(Object.keys(theme)).not.toContain('manifest');
  });
});

// ─── Tests: addBreakpoints & createTheme ────────────────────

describe('createTheme & addBreakpoints', () => {
  it('zero-arg createTheme builds minimal theme', () => {
    const theme = createTheme().addBreakpoints(breakpoints).build();
    expect(theme.breakpoints).toEqual(breakpoints);
  });

  it('addBreakpoints validates non-negative numbers', () => {
    expect(() => createTheme().addBreakpoints({ bad: -1 })).toThrow(
      /non-negative/
    );
  });
});

// ─── Tests: addScale ────────────────────────────────────────

describe('addScale', () => {
  it('stores raw values for non-emitted scales', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'space', values: { 0: '0', 8: '0.5rem' } })
      .build();

    expect(theme.space[0]).toBe('0');
    expect(theme.space[8]).toBe('0.5rem');
  });

  it('emit: true tracks scale as emitted in manifest', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'sizes',
        emit: true,
        values: { navHeight: '48px', sidebarWidth: '200px' },
      })
      .build();

    // Raw values preserved on theme
    expect(theme.sizes.navHeight).toBe('48px');
    expect(theme.sizes.sidebarWidth).toBe('200px');

    // Manifest has var() refs
    expect(theme.manifest.tokenMap['sizes.navHeight']).toBe(
      'var(--sizes-navHeight)'
    );
    expect(theme.manifest.variableMap['sizes.navHeight']).toBe(
      '--sizes-navHeight'
    );
  });
});

// ─── Tests: Token Ref Resolution ────────────────────────────

describe('token ref resolution', () => {
  it('resolves {colors.key} to var(--color-key) in manifest', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
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

    // Token ref resolves in manifest tokenMap
    expect(theme.manifest.tokenMap['shadows.glow']).toContain(
      'var(--color-text)'
    );
  });

  it('resolves {scale.key} to var(--scale-key) for emitted scales', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
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

    expect(theme.manifest.tokenMap['layout.stickyTop']).toBe(
      'calc(var(--sizes-navHeight) + 16px)'
    );
  });

  it('leaves unresolvable refs unchanged and warns', () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'test',
        values: { val: '{bogus.key}' },
      })
      .build();

    expect(theme.manifest.tokenMap['test.val']).toBe('{bogus.key}');
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('resolves opacity modifier with emitted scale var() reference', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: '#6366f1' })
      .addScale({
        name: 'overlays',
        values: { dim: '{colors.primary/40}' },
      })
      .build();

    expect(theme.manifest.tokenMap['overlays.dim']).toBe(
      'color-mix(in srgb, var(--color-primary) 40%, transparent)'
    );
  });

  it('resolves opacity modifier with raw value from non-emitted scale', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'rawColors',
        values: { brand: '#6366f1' },
      })
      .addScale({
        name: 'overlays',
        values: { dim: '{rawColors.brand/50}' },
      })
      .build();

    expect(theme.manifest.tokenMap['overlays.dim']).toBe(
      'color-mix(in srgb, #6366f1 50%, transparent)'
    );
  });

  it('resolves zero opacity to transparent', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: '#6366f1' })
      .addScale({
        name: 'overlays',
        values: { invisible: '{colors.primary/0}' },
      })
      .build();

    expect(theme.manifest.tokenMap['overlays.invisible']).toBe('transparent');
  });
});

// ─── Tests: varRef ──────────────────────────────────────────

describe('varRef', () => {
  const theme = buildTestTheme();

  it('returns var() for emitted color', () => {
    expect(theme.varRef('colors.ember')).toBe('var(--color-ember)');
  });

  it('returns var() for nested emitted color', () => {
    expect(theme.varRef('colors.gray.300')).toBe('var(--color-gray-300)');
  });

  it('returns raw value for non-emitted scale', () => {
    expect(theme.varRef('space.8')).toBe('0.5rem');
  });

  it('returns undefined for unknown path', () => {
    expect(theme.varRef('colors.nonexistent')).toBeUndefined();
  });

  it('is non-enumerable', () => {
    const spread = { ...theme };
    expect('varRef' in spread).toBe(false);
    expect(Object.keys(theme)).not.toContain('varRef');
  });
});

// ─── Tests: Composition ─────────────────────────────────────

describe('theme composition via from()', () => {
  const libTokens = buildTestTheme();

  it('round-trip: from() with no changes produces matching serialize', () => {
    const consumer = createTheme().from(libTokens).build();
    // Both should produce the same scalesJson
    expect(consumer.serialize().scalesJson).toBe(
      libTokens.serialize().scalesJson
    );
  });

  it('from() + addColors merges new colors', () => {
    const consumer = createTheme()
      .from(libTokens)
      .addColors({ brand: { 500: '#cc5500' } })
      .build();

    // Library colors preserved
    expect(consumer.colors.ember).toBe('#ff2800');
    // New color added
    expect((consumer.colors as Record<string, unknown>).brand).toEqual({
      500: '#cc5500',
    });
  });

  it('selective spread: only library colors', () => {
    const consumer = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ...libTokens.colors } as Record<
        string,
        string | Record<string, string>
      >)
      .build();

    // @ts-expect-error — cast to Record widened away specific keys
    expect(consumer.colors.ember).toBe('#ff2800');
    // No space scale (not spread)
    expect((consumer as Record<string, unknown>).space).toBeUndefined();
  });
});

// ─── Tests: declareContextualVars ───────────────────────────

describe('declareContextualVars', () => {
  it('validates scale exists', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        // @ts-expect-error — type correctly rejects: colors not added yet
        .declareContextualVars({ colors: ['bg'] })
    ).toThrow(/scale 'colors' not found/);
  });

  it('declared vars appear in manifest', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ bg: '#000' })
      .declareContextualVars({ colors: ['current-bg'] })
      .build();

    expect(theme.manifest.contextualVars).toEqual({
      colors: ['current-bg'],
    });
  });
});

// ─── Tests: extendScale ─────────────────────────────────────

describe('extendScale', () => {
  it('extends scale with computed values', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'fonts',
        values: { body: 'Georgia, serif' },
      })
      .extendScale('fonts', ({ body }) => ({
        bodyFallback: `${body}, Montserrat`,
      }))
      .build();

    expect(theme.fonts.body).toBe('Georgia, serif');
    expect(theme.fonts.bodyFallback).toBe('Georgia, serif, Montserrat');
  });
});
