/**
 * Tests for the late-binding theme reference resolver (openspec change:
 * first-class-extension, increment 03 — spec `theme-composition`, D4).
 *
 * Scenario mapping (spec header → test):
 * - "Late-binding reference resolution over the merged theme" ›
 *   "Declaration order is not observable" → 'G3: reversed declaration order
 *   produces byte-identical tokenMap and variableCss' (+ the forward-refs
 *   resolution check)
 * - … › "Emitted and inlined forms agree" → 'G1: emitted and inlined forms
 *   of the same scale resolve every path to the same value' + the
 *   mode-block witness beside it (inc 04 closure of the review-registered
 *   G1 blind spot: the original witness covered the base mode only)
 * - … › "Reference cycle fails the build" → the three cycle tests
 * - … › "Override recolors source-internal references" → mechanism witness
 *   're-resolves kit-authored references against later overrides' (the
 *   `.extend()`-spelled form of this scenario landed with increment 04 in
 *   theme-extend.test.ts; the late-binding mechanism it depends on is
 *   witnessed here through `from()`)
 * - "Emitted scale references resolve in emitted CSS" › "Cross-scale
 *   reference in an emitted scale" → 'G2: cross-scale reference in an
 *   emitted scale resolves to a var() chain'
 *
 * Boundary pinned elsewhere: unresolvable references stay warn-and-literal
 * (supported kit pattern — dangling-reference ERRORS belong to increment 04
 * with the explicit replacement form); the warn-once discipline is covered
 * below.
 */
import { describe, expect, it, vi } from 'vitest';

import { createTheme } from '../src';

const breakpoints = { sm: 768 } as const;

// ─── Helpers: var() chasing for emission-parity comparison ───

/**
 * Custom-property declarations of the block that opens at or after `start`.
 * A `start` of -1 yields an empty map, so each caller keeps its own
 * block-not-found policy.
 */
function blockVariables(css: string, start: number) {
  const map: Record<string, string> = {};
  if (start === -1) return map;
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  for (const line of css.slice(open + 1, close).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('--')) continue;
    const colonIdx = trimmed.indexOf(':');
    map[trimmed.slice(0, colonIdx)] = trimmed
      .slice(colonIdx + 1)
      .replace(/;$/, '')
      .trim();
  }
  return map;
}

/** Parse the `:root` block's custom-property declarations into a map. */
function rootVariables(css: string) {
  return blockVariables(css, css.indexOf(':root {'));
}

/**
 * Substitute `var(--x)` occurrences from `vars` to a fixpoint — the cascade's
 * late binding, replayed textually. This is what makes emitted and inlined
 * forms comparable: both must chase to the same final value.
 */
function chaseVars(value: string, vars: Record<string, string>): string {
  let current = value;
  for (let i = 0; i < 32; i++) {
    const next = current.replace(/var\((--[^)]+)\)/g, (match, name: string) =>
      vars[name] !== undefined ? vars[name] : match
    );
    if (next === current) return current;
    current = next;
  }
  throw new Error(`var() chase did not terminate for: ${value}`);
}

// ─── G3: declaration order is not observable ─────────────────

/**
 * Forward references in BOTH directions plus reversed key order inside a
 * scale: under the old single-pass resolver the reversed build left
 * `{base.unit}` literal (verified by execution during exploration).
 */
function buildForwardDeclared() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addScale({ name: 'base', values: { unit: '4px', double: '8px' } })
    .addScale({ name: 'mid', values: { gap: 'calc({base.unit} * 2)' } })
    .addScale({
      name: 'top',
      values: { pad: 'calc({mid.gap} + {base.unit})' },
    })
    .addScale({ name: 'hues', emit: true, values: { red: '#ff2800' } })
    .addScale({
      name: 'paints',
      emit: true,
      values: { brand: '{hues.red}', flat: '#ffffff' },
    })
    .build();
}

function buildReverseDeclared() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addScale({
      name: 'paints',
      emit: true,
      values: { flat: '#ffffff', brand: '{hues.red}' },
    })
    .addScale({ name: 'hues', emit: true, values: { red: '#ff2800' } })
    .addScale({
      name: 'top',
      values: { pad: 'calc({mid.gap} + {base.unit})' },
    })
    .addScale({ name: 'mid', values: { gap: 'calc({base.unit} * 2)' } })
    .addScale({ name: 'base', values: { double: '8px', unit: '4px' } })
    .build();
}

describe('declaration-order independence (G3)', () => {
  it('G3: reversed declaration order produces byte-identical tokenMap and variableCss', () => {
    const forward = buildForwardDeclared().serialize();
    const reversed = buildReverseDeclared().serialize();
    expect(reversed.scalesJson).toBe(forward.scalesJson);
    expect(reversed.variableCss).toBe(forward.variableCss);
  });

  it('resolves forward references fully in both declaration orders', () => {
    for (const theme of [buildForwardDeclared(), buildReverseDeclared()]) {
      expect(theme.manifest.tokenMap['mid.gap']).toBe('calc(4px * 2)');
      expect(theme.manifest.tokenMap['top.pad']).toBe(
        'calc(calc(4px * 2) + 4px)'
      );
      expect(theme.serialize().variableCss).toContain(
        '--paints-brand: var(--hues-red);'
      );
    }
  });
});

// ─── G1: emitted and inlined forms agree ─────────────────────

describe('emission parity (G1)', () => {
  function buildEmitFlipped(emit: boolean) {
    return createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'palette',
        emit,
        values: { ink: '#101014', accent: '{palette.ink}' },
      })
      .addScale({
        name: 'shadows',
        values: {
          glow: '0 0 12px {palette.ink/40}',
          rim: '0 0 2px {palette.accent}',
        },
      })
      .build();
  }

  it('G1: emitted and inlined forms of the same scale resolve every path to the same value', () => {
    const emitted = buildEmitFlipped(true);
    const inlined = buildEmitFlipped(false);
    const vars = rootVariables(emitted.serialize().variableCss);
    const emittedResolved = Object.fromEntries(
      Object.entries(emitted.manifest.tokenMap).map(([path, value]) => [
        path,
        chaseVars(value, vars),
      ])
    );
    expect(emittedResolved).toEqual(inlined.manifest.tokenMap);
  });

  // ── Mode-block coverage (inc 04 — closes the registered G1 blind spot:
  // the witness above covers the base mode on one fixture only) ──

  /** Parse the declarations of the `[data-color-mode="X"]` block. */
  function modeBlockVariables(css: string, mode: string) {
    const start = css.indexOf(`[data-color-mode="${mode}"]`);
    if (start === -1) throw new Error(`mode block '${mode}' not found`);
    return blockVariables(css, start);
  }

  /**
   * A moded theme whose color values are REFERENCES into another scale, with
   * the colors scale's emission flipped — under the pre-inc-04 emitter the
   * mode blocks carried the raw `{palette.…}` strings verbatim.
   */
  function buildModedEmitFlipped(emit: boolean) {
    return createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'palette',
        values: { fire: '#ff2800', ice: '#0044ff' },
      })
      .addScale({
        name: 'colors',
        emit,
        values: { ember: '{palette.fire}', frost: '{palette.ice}' },
      })
      .addColorModes('warm', {
        warm: { primary: 'ember' },
        cool: { primary: 'frost' },
      })
      .build();
  }

  it('G1: mode-block declarations chase to identical values under an emit flip', () => {
    const emitted = buildModedEmitFlipped(true);
    const inlined = buildModedEmitFlipped(false);
    for (const mode of ['warm', 'cool']) {
      const chase = (theme: ReturnType<typeof buildModedEmitFlipped>) => {
        const css = theme.serialize().variableCss;
        const scope = {
          ...rootVariables(css),
          ...modeBlockVariables(css, mode),
        };
        return Object.fromEntries(
          Object.entries(modeBlockVariables(css, mode)).map(([name, value]) => [
            name,
            chaseVars(value, scope),
          ])
        );
      };
      expect(chase(emitted)).toEqual(chase(inlined));
    }
    // The manifest's mode value maps agree across the flip as well.
    expect(emitted.manifest.modes).toEqual(inlined.manifest.modes);
  });
});

// ─── G2: references inside emitted scales resolve into CSS ───

describe('emitted-scale reference resolution (G2)', () => {
  it('G2: cross-scale reference in an emitted scale resolves to a var() chain', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ember: '#ff2800' })
      .addScale({
        name: 'shadows',
        emit: true,
        values: { glow: '0 0 12px {colors.ember}' },
      })
      .build();
    const css = theme.serialize().variableCss;
    expect(css).toContain('--shadows-glow: 0 0 12px var(--color-ember);');
    expect(css).not.toMatch(/\{[a-zA-Z0-9_.]+\}/);
    // The tokenMap keeps the emitted indirection.
    expect(theme.manifest.tokenMap['shadows.glow']).toBe('var(--shadows-glow)');
  });

  it('omits emitted declarations that transitively depend on a missing token', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'missing',
        emit: true,
        values: { base: '{ghost.x}' },
      })
      .addScale({
        name: 'consumer',
        emit: true,
        values: { use: '{missing.base}' },
      })
      .build();

    expect(theme.serialize().variableCss).not.toContain('--missing-base:');
    expect(theme.serialize().variableCss).not.toContain('--consumer-use:');
    warnSpy.mockRestore();
  });
});

// ─── Same-scale references are legal DAG edges ───────────────

describe('same-scale references', () => {
  it('resolves same-scale references in a non-emitted scale without warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'space',
        values: { gutter: '16px', page: 'calc({space.gutter} * 2)' },
      })
      .build();
    expect(theme.manifest.tokenMap['space.page']).toBe('calc(16px * 2)');
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('resolves same-scale references in an emitted scale to a var() chain', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'palette',
        emit: true,
        values: { ink: '#101014', accent: '{palette.ink}' },
      })
      .build();
    expect(theme.serialize().variableCss).toContain(
      '--palette-accent: var(--palette-ink);'
    );
  });
});

// ─── Chains through emitted AND inlined targets ──────────────

describe('mixed-emission reference chains', () => {
  it('resolves chains that pass through both emitted and inlined targets', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ember: '#ff2800' })
      .addScale({
        name: 'edges',
        values: { hot: '1px solid {colors.ember}' },
      })
      .addScale({ name: 'frames', emit: true, values: { card: '{edges.hot}' } })
      .addScale({ name: 'composed', values: { hero: '{frames.card}' } })
      .build();

    // inlined → emitted target: var() substitution
    expect(theme.manifest.tokenMap['edges.hot']).toBe(
      '1px solid var(--color-ember)'
    );
    // emitted → inlined target: the resolved literal lands in the declaration
    expect(theme.serialize().variableCss).toContain(
      '--frames-card: 1px solid var(--color-ember);'
    );
    // inlined → emitted target again: the var() chain, never the raw ref
    expect(theme.manifest.tokenMap['composed.hero']).toBe('var(--frames-card)');
  });

  it('resolves opacity chains through non-emitted intermediates', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ember: '#ff2800' })
      .addScale({ name: 'tints', values: { soft: '{colors.ember/20}' } })
      .addScale({ name: 'overlays', values: { dim: '{tints.soft/50}' } })
      .build();
    expect(theme.manifest.tokenMap['tints.soft']).toBe(
      'color-mix(in srgb, var(--color-ember) 20%, transparent)'
    );
    expect(theme.manifest.tokenMap['overlays.dim']).toBe(
      'color-mix(in srgb, color-mix(in srgb, var(--color-ember) 20%, transparent) 50%, transparent)'
    );
  });

  it('degrades empty or non-numeric opacity modifiers to the unmodified base', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'p', values: { base: '#123456' } })
      .addScale({
        name: 'q',
        values: { odd: '{p.base/}', bad: '{p.base/abc}' },
      })
      .build();
    expect(theme.manifest.tokenMap['q.odd']).toBe('#123456');
    expect(theme.manifest.tokenMap['q.bad']).toBe('#123456');
  });
});

// ─── Cycles: hard error naming the cycle ─────────────────────

describe('reference cycles', () => {
  it('fails the build naming both tokens of a reference cycle', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({ name: 'loop', values: { a: '{loop.b}', b: '{loop.a}' } })
        .build()
    ).toThrow(/token reference cycle — 'loop\.a' → 'loop\.b' → 'loop\.a'/);
  });

  it('fails the build on a self-referential token', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({ name: 'loop', values: { a: '{loop.a}' } })
        .build()
    ).toThrow(/'loop\.a' → 'loop\.a'/);
  });

  it('fails a cyclic theme identically when the scale is emitted (emission-invariant)', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({
          name: 'loop',
          emit: true,
          values: { a: '{loop.b}', b: '{loop.a}' },
        })
        .build()
    ).toThrow(/token reference cycle/);
  });
});

// ─── Unresolvable references: warn once, keep literal ────────

describe('unresolvable references (supported kit pattern)', () => {
  it('warns once per missing path and keeps the literal', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'a', values: { one: '{ghost.token}' } })
      .addScale({ name: 'b', values: { two: 'solid {ghost.token}' } })
      .build();
    expect(theme.manifest.tokenMap['a.one']).toBe('{ghost.token}');
    expect(theme.manifest.tokenMap['b.two']).toBe('solid {ghost.token}');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[animus] Token ref {ghost.token} — path 'ghost.token' not found in token map"
    );
    warnSpy.mockRestore();
  });
});

// ─── Late binding over the merged map ────────────────────────

describe('late binding over the composed theme', () => {
  it('re-resolves kit-authored references against later overrides', () => {
    const kit = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'palette', values: { ember: '#ff2800' } })
      .addScale({
        name: 'shadows',
        values: { glow: '0 0 12px {palette.ember}' },
      })
      .build();
    const composed = createTheme()
      .from(kit)
      .addScale({ name: 'palette', values: { ember: '#7c3aed' } })
      .build();
    // The kit's authored reference survives composition raw and resolves
    // against the FINAL merged map — the consumer's override wins.
    expect(composed.manifest.tokenMap['shadows.glow']).toBe('0 0 12px #7c3aed');
  });
});
