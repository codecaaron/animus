/**
 * Builder-state isolation for ThemeBuilder: `merge` adopts nested source
 * objects by reference and mutates them on later folds, so every builder
 * step must deep-copy before merging. Without that, branching a builder
 * cross-contaminates the branches AND the parent, build() outputs keep
 * mutating after the fact, and from() corrupts the consumed kit's exported
 * theme for every other consumer in the process (an SSR worker, a
 * multi-environment build, a second ds.ts in one test file).
 *
 * Also pins the composition-boundary halves of the same review family: the
 * canonical `theme` bundle spelling on from(), structural (not reference)
 * equality for array-valued tokens in the sibling-conflict gate, and the
 * transitive withholding of a synthesized mode-alias `var()` whose target
 * declaration was itself withheld.
 */
import { describe, expect, it, vi } from 'vitest';

import { createTheme } from '../src';

describe('ThemeBuilder state isolation', () => {
  it('branching a builder never cross-contaminates branches or the parent', () => {
    const base = createTheme().addColors({ brand: { primary: '#111111' } });
    const branchA = base.addColors({ onlyA: { x: '#222222' } });
    const branchB = base.addColors({ onlyB: { x: '#333333' } });

    const builtA = branchA.build();
    const builtB = branchB.build();
    const builtBase = base.build();

    // Exact objects: an isolation failure is a leakage failure, so the whole
    // value is the claim — extra keys must fail, not just missing ones.
    expect(builtA.colors).toEqual({
      brand: { primary: '#111111' },
      onlyA: { x: '#222222' },
    });
    expect(builtB.colors).toEqual({
      brand: { primary: '#111111' },
      onlyB: { x: '#333333' },
    });
    expect(builtBase.colors).toEqual({ brand: { primary: '#111111' } });
  });

  it('build() output is a snapshot — later builder calls never mutate it', () => {
    const builder = createTheme().addColors({ z: { a: '#333333' } });
    const built = builder.build();

    builder.addColors({ z: { b: '#444444' } });

    // Whole-object: a leaked mutation would show up as an extra `z.b` here.
    expect(built.colors).toEqual({ z: { a: '#333333' } });
  });

  it('from() never mutates the consumed built theme', () => {
    const kit = createTheme()
      .addColors({ kitc: { a: '#111111' } })
      .build();

    createTheme()
      .from(kit)
      .addColors({ kitc: { b: '#999999' } });

    expect(kit.colors).toEqual({ kitc: { a: '#111111' } });
  });

  it('extend() never mutates the consumed built theme through later augmentation', () => {
    const kit = createTheme()
      .addColors({ kitc: { a: '#111111' } })
      .build();

    createTheme()
      .extend(kit)
      .addColors({ kitc: { b: '#999999' } });

    expect(kit.colors).toEqual({ kitc: { a: '#111111' } });
  });
});

describe('from() bundle-half resolution', () => {
  it('consumes the canonical `theme` spelling of a library bundle', () => {
    const kitTheme = createTheme()
      .addColors({ kitc: { a: '#111111' } })
      .build();
    const bundle = { system: { toConfig: () => ({}) }, theme: kitTheme };

    const built = createTheme().from(bundle).build();

    expect(built.colors).toEqual({ kitc: { a: '#111111' } });
    expect(built.serialize().scalesJson).toContain('kitc');
  });
});

describe('extend() array-valued token coalescing', () => {
  it('repeated extension of one kit with an array-valued token coalesces', () => {
    const kitLike = { fonts: { stack: ['Inter', 'sans-serif'] } };

    expect(() => createTheme().extend(kitLike).extend(kitLike)).not.toThrow();
  });

  it('structurally equal arrays from two sibling kits coalesce', () => {
    const kitA = { fonts: { stack: ['Inter', 'sans-serif'] } };
    const kitB = { fonts: { stack: ['Inter', 'sans-serif'] } };

    expect(() => createTheme().extend(kitA).extend(kitB)).not.toThrow();
  });

  it('divergent array-valued tokens still fail loud naming the path', () => {
    expect(() =>
      createTheme()
        .extend({ fonts: { stack: ['Inter', 'sans-serif'] } })
        .extend({ fonts: { stack: ['Roboto', 'sans-serif'] } })
    ).toThrow(/fonts\.stack/);
  });
});

describe('mode-alias declarations with withheld targets', () => {
  it('withholds a synthesized alias var() whose target was itself withheld', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const built = createTheme()
        .addScale({
          name: 'colors',
          values: { accent: '{colors.missing}', ink: '#000000' },
          emit: true,
        })
        .addColorModes('light', { light: { primary: 'accent' } })
        .build();

      const css = built.serialize().variableCss;
      // The unresolvable target is withheld (pre-existing behavior)…
      expect(css).not.toContain('--color-accent:');
      // …and the alias pointing at it must not ship a dangling var().
      expect(css).not.toContain('var(--color-accent)');
      expect(css).not.toContain('--color-primary:');
      // Healthy declarations still emit.
      expect(css).toContain('--color-ink:');
      // Both drops are named in the aggregated omission warning.
      const warned = warn.mock.calls.map((call) => String(call[0])).join('\n');
      expect(warned).toContain('--color-accent');
      expect(warned).toContain('--color-primary');
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });
});
