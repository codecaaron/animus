import { describe, expect, test } from 'vitest';

import { createTheme } from '../src/theme/createTheme';

describe('addColors validation', () => {
  test('accepts hex colors', () => {
    expect(() =>
      createTheme().addColors({ a: '#fff', b: '#FF2800', c: '#00000080' })
    ).not.toThrow();
  });

  test('accepts rgb/rgba', () => {
    expect(() =>
      createTheme().addColors({
        a: 'rgb(255, 0, 0)',
        b: 'rgba(0, 0, 0, 0.5)',
      })
    ).not.toThrow();
  });

  test('accepts hsl/hsla', () => {
    expect(() =>
      createTheme().addColors({
        a: 'hsl(120, 50%, 50%)',
        b: 'hsla(0, 0%, 0%, 0.3)',
      })
    ).not.toThrow();
  });

  test('accepts oklch/oklab', () => {
    expect(() =>
      createTheme().addColors({
        a: 'oklch(0.7 0.15 30)',
        b: 'oklab(0.5 0.1 -0.1)',
      })
    ).not.toThrow();
  });

  test('accepts transparent and currentColor', () => {
    expect(() =>
      createTheme().addColors({ a: 'transparent', b: 'currentColor' })
    ).not.toThrow();
  });

  test('accepts named CSS colors', () => {
    expect(() =>
      createTheme().addColors({ a: 'red', b: 'navy', c: 'rebeccapurple' })
    ).not.toThrow();
  });

  test('accepts color-mix()', () => {
    expect(() =>
      createTheme().addColors({ a: 'color-mix(in oklch, red 50%, blue)' })
    ).not.toThrow();
  });

  test('rejects gradients with key name in error', () => {
    expect(() =>
      createTheme().addColors({
        gradient: 'linear-gradient(90deg, red, blue)',
      })
    ).toThrow(/gradient/);
  });

  test('rejects arbitrary strings', () => {
    expect(() => createTheme().addColors({ bad: 'not-a-color' })).toThrow(
      /bad/
    );
  });

  test('rejects objects', () => {
    expect(() =>
      /** @ts-expect-error */
      createTheme().addColors({ nested: { deep: { invalid: 123 as any } } })
    ).toThrow();
  });

  test('error message includes accepted formats', () => {
    expect(() => createTheme().addColors({ x: '123invalid' })).toThrow(
      /hex.*rgb.*hsl.*oklch/i
    );
  });
});

describe('addColorModes validation', () => {
  test('accepts valid aliases', () => {
    expect(() =>
      createTheme()
        .addColors({ ember: '#FF2800', scorch: '#C1121F' })
        .addColorModes('dark', {
          dark: { primary: 'ember' },
          light: { primary: 'scorch' },
        })
    ).not.toThrow();
  });

  test('rejects unknown color aliases', () => {
    expect(() =>
      createTheme()
        .addColors({ ember: '#FF2800' })
        .addColorModes('dark', { dark: { primary: 'nonexistent' } })
    ).toThrow(/nonexistent/);
  });

  test('error includes mode name and alias', () => {
    expect(() =>
      createTheme()
        .addColors({ ember: '#FF2800' })
        .addColorModes('dark', { dark: { primary: 'missing' } })
    ).toThrow(/dark.*missing|missing.*dark/);
  });

  test('error includes available colors', () => {
    expect(() =>
      createTheme()
        .addColors({ ember: '#FF2800', scorch: '#C1121F' })
        .addColorModes('dark', { dark: { primary: 'nope' } })
    ).toThrow(/ember/);
  });
});

describe('ThemeManifest', () => {
  test('build() attaches non-enumerable manifest', () => {
    const tokens = createTheme().addColors({ ember: '#FF2800' }).build();

    // manifest exists
    expect((tokens as any).manifest).toBeDefined();
    // non-enumerable — not in spread
    const spread = { ...tokens };
    expect((spread as any).manifest).toBeUndefined();
  });

  test('manifest.tokenMap contains flattened scales', () => {
    const tokens = createTheme()
      .addScale({ name: 'space', values: { 8: '0.5rem', 16: '1rem' } })
      .addColors({ ember: '#FF2800' })
      .build();

    const manifest = (tokens as any).manifest;
    expect(manifest.tokenMap['space.8']).toBe('0.5rem');
    expect(manifest.tokenMap['space.16']).toBe('1rem');
  });

  test('manifest.variableMap contains CSS variable names', () => {
    const tokens = createTheme().addColors({ ember: '#FF2800' }).build();

    const manifest = (tokens as any).manifest;
    expect(manifest.variableMap['colors.ember']).toBe('--color-ember');
  });

  test('manifest.variableMap excludes static scales', () => {
    const tokens = createTheme()
      .addScale({ name: 'space', values: { 8: '0.5rem' } })
      .build();

    const manifest = (tokens as any).manifest;
    expect(manifest.variableMap['space.8']).toBeUndefined();
    expect(manifest.tokenMap['space.8']).toBe('0.5rem');
  });

  test('manifest.variableCss contains :root block', () => {
    const tokens = createTheme().addColors({ ember: '#FF2800' }).build();

    const manifest = (tokens as any).manifest;
    expect(manifest.variableCss).toContain(':root');
    expect(manifest.variableCss).toContain('--color-ember');
  });

  test('manifest.modes contains resolved values', () => {
    const tokens = createTheme()
      .addColors({ ember: '#FF2800', scorch: '#C1121F' })
      .addColorModes('dark', {
        dark: { primary: 'ember' },
        light: { primary: 'scorch' },
      })
      .build();

    const manifest = (tokens as any).manifest;
    expect(manifest.modes.dark['colors.primary']).toBe('#FF2800');
    expect(manifest.modes.light['colors.primary']).toBe('#C1121F');
  });
});
