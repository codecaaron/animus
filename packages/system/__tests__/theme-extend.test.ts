/**
 * Tests for ThemeBuilder.extend() (openspec change: first-class-extension,
 * increment 04 — spec `theme-composition`, resolving D2/D5/D6).
 *
 * Scenario mapping (spec header → test):
 * - "extend() composition entry point" › "Local values win over the extended
 *   source" → 'local addColors wins over the extended source value'
 * - … › "Inherit-first is type-enforced" → types.test-d.tsx §17 (type half;
 *   no runtime gate exists on purpose)
 * - … › "Bundle object feeds the theme half" → 'a bundle feeds the theme
 *   half (theme preferred, tokens accepted) and ignores the rest'
 * - … › "Sibling themes conflict loudly" → 'sibling themes defining one path
 *   divergently fail loud naming both sources, order-independent' (+ the
 *   equal-value coalesce and NS-4 override tests)
 * - "Late-binding reference resolution over the merged theme" › "Override
 *   recolors source-internal references" — the `.extend()`-spelled scenario,
 *   previously witnessed only through from() (theme-resolver.test.ts) →
 *   'extend(): consumer override recolors kit-authored references'
 * - "Structural progressivity of inherited tokens" › "Wholesale replacement
 *   is explicit" → 'addScale without replace keeps inherited keys'
 * - … › "Dangling reference fails at build" → 'explicit replacement dropping
 *   a referenced key fails build() naming referencer, call, and dropped keys'
 * - "Deep merge semantics on augmentation" › "addColors deep merges" /
 *   "addScale merges by key" / "Explicit replacement replaces wholesale" /
 *   "addColorModes merges modes" → the 'deep merge semantics (MODIFIED)'
 *   describe block
 * - "Mode extension declares its base" › "Declared base fills coverage gaps"
 *   / "Missing base with gaps fails" → the 'mode bases (D6)' describe block
 * - "Round-trip fidelity" › "Full round-trip" → 'extend(lib) with no
 *   augmentation serializes identically to the source'
 * - "from() composition entry point" (MODIFIED) › "from() precedence is
 *   unchanged during the window" / "Deprecation is visible to consumers" →
 *   the 'from() freeze (G6)' describe block
 *
 * Determinism closures (inc 03 review-registered blind spots, journal
 * 2026-08-04 15:04): reversed-declaration byte-identity now spanning mode
 * blocks, breakpoint lines, and the variableMapJson wire (G3); emitted
 * declarations with never-defined targets omitted with one aggregated
 * warning (G2); mode-override declarations routed through the resolver
 * (G2 — the review's executed probe); v1-manifest taint preserved through
 * extend() (D8). The G1 mode-block witness lives in theme-resolver.test.ts
 * beside the base-mode witness it extends.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { createTheme } from '../src';

const breakpoints = { sm: 768 } as const;

/** Declaration lines (trimmed) inside the block whose header matches `header`. */
function blockDeclarations(css: string, header: string): string[] {
  const start = css.indexOf(header);
  if (start === -1) throw new Error(`block '${header}' not found in:\n${css}`);
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return css
    .slice(open + 1, close)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Kit fixture: emitted colors, modes, a non-emitted scale, and a reference. */
function buildKitTheme() {
  return createTheme()
    .addBreakpoints({ sm: 768, lg: 1200 })
    .addColors({ ember: '#ff2800', void: '#000000', bone: '#e8e0d0' })
    .addColorModes('dark', {
      dark: { primary: 'ember', bg: 'void', muted: 'bone' },
      light: { primary: 'void', bg: 'bone', muted: 'ember' },
    })
    .addScale({
      name: 'space',
      values: { 0: '0', 4: '0.25rem', 8: '0.5rem' },
    })
    .addScale({
      name: 'shadows',
      values: { glow: '0 0 12px {colors.ember}' },
    })
    .build();
}

// ─── extend() composition entry point ────────────────────────

describe('ThemeBuilder extend() composition', () => {
  // Scenario: "Local values win over the extended source" (D2 —
  // base-then-local-wins, the mirror of from()'s source-wins).
  it('local addColors wins over the extended source value', () => {
    const composed = createTheme()
      .extend(buildKitTheme())
      .addColors({ ember: '#7c3aed' })
      .build();
    // Runtime reads go through a cast: intersecting the kit's literal color
    // type with the override's reduces the conflicting key to `never` at the
    // type level (the same admission-typing limitation from() has).
    const colors = composed.colors as unknown as Record<string, string>;
    expect(colors.ember).toBe('#7c3aed');
    // Non-conflicting kit values survive as the base.
    expect(colors.void).toBe('#000000');
    expect(composed.space[8]).toBe('0.5rem');
  });

  // Scenario: "Bundle object feeds the theme half" — D9 `theme` preferred,
  // pre-D9 `tokens` accepted, the system half ignored.
  it('a bundle feeds the theme half (theme preferred, tokens accepted) and ignores the rest', () => {
    const kit = buildKitTheme();
    const kitSystem = { toConfig: () => ({}) };
    const direct = createTheme().extend(kit).build();
    const viaTheme = createTheme()
      .extend({ system: kitSystem, theme: kit })
      .build();
    const viaTokens = createTheme()
      .extend({ system: kitSystem, tokens: kit })
      .build();

    expect(viaTheme.serialize()).toEqual(direct.serialize());
    expect(viaTokens.serialize()).toEqual(direct.serialize());
    // `theme` wins over `tokens` when both are present (D9 naming).
    const decoyTokens = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ember: '#123456' })
      .build();
    const preferred = createTheme()
      .extend({ system: kitSystem, theme: kit, tokens: decoyTokens })
      .build();
    expect(preferred.colors.ember).toBe('#ff2800');
    // The bundle's other halves never leak into the theme.
    expect((viaTheme as Record<string, unknown>).system).toBeUndefined();
    expect((viaTheme as Record<string, unknown>).theme).toBeUndefined();
  });

  // Scenario: "Sibling themes conflict loudly" (D3/G4) — positional origin
  // labels are the accepted form until DEF-4's provenance artifact.
  it('sibling themes defining one path divergently fail loud naming both sources, order-independent', () => {
    const kitA = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: '#ff2800' })
      .build();
    const kitB = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: '#7c3aed' })
      .build();

    expect(() => createTheme().extend(kitA).extend(kitB)).toThrow(
      /path 'colors\.primary' is defined divergently by extended theme #1 \("#ff2800"\) and extended theme #2 \("#7c3aed"\)/
    );
    expect(() => createTheme().extend(kitB).extend(kitA)).toThrow(
      /path 'colors\.primary'.*extended theme #1.*extended theme #2/s
    );
  });

  // Review F1 (executed probe): one sibling authors a LEAF where the other
  // authors a nested BRANCH at the same path — per-leaf value provenance
  // alone silently picked an order-dependent winner. Both orders must fail
  // naming the path and both positional sources.
  it('sibling branch-vs-leaf structural divergence fails loud naming both sources, order-independent', () => {
    const leafKit = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: '#ff2800' })
      .build();
    const branchKit = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: { 500: '#7c3aed' } })
      .build();

    expect(() => createTheme().extend(leafKit).extend(branchKit)).toThrow(
      /path 'colors\.primary' is defined divergently by extended theme #1 \(a leaf value\) and extended theme #2 \(a nested branch\)/
    );
    expect(() => createTheme().extend(branchKit).extend(leafKit)).toThrow(
      /path 'colors\.primary' is defined divergently by extended theme #1 \(a nested branch\) and extended theme #2 \(a leaf value\)/
    );
  });

  it('coalesces sibling paths with equal values silently', () => {
    const makeKit = () =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors({ primary: '#ff2800' })
        .build();
    const merged = createTheme().extend(makeKit()).extend(makeKit()).build();
    expect(merged.colors.primary).toBe('#ff2800');
  });

  // NS-4: app-over-kit resolves silently — only kit-beside-kit is loud.
  it('lets the consumer override a sibling-shared value silently after extends', () => {
    const kitA = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ primary: '#ff2800' })
      .build();
    const composed = createTheme()
      .extend(kitA)
      .addColors({ primary: '#123456' })
      .build();
    expect((composed.colors as unknown as Record<string, string>).primary).toBe(
      '#123456'
    );
  });

  it('never mutates the consumed kit theme during composition', () => {
    const kit = buildKitTheme();
    const colorsBefore = JSON.parse(JSON.stringify(kit.colors));
    const spaceBefore = JSON.parse(JSON.stringify(kit.space));
    createTheme()
      .extend(kit)
      .addColors({ ember: '#7c3aed' })
      .addScale({ name: 'space', values: { 12: '0.75rem' } })
      .build();
    expect(kit.colors).toEqual(colorsBefore);
    expect(kit.space).toEqual(spaceBefore);
  });

  // "Late-binding …" › "Override recolors source-internal references" —
  // the `.extend()`-spelled form (mechanism witnessed via from() in
  // theme-resolver.test.ts; this claims the previously-unclaimed spelling).
  it('extend(): consumer override recolors kit-authored references', () => {
    const kit = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'palette', values: { ember: '#ff2800' } })
      .addScale({
        name: 'shadows',
        values: { glow: '0 0 12px {palette.ember}' },
      })
      .build();
    const composed = createTheme()
      .extend(kit)
      .addScale({ name: 'palette', values: { ember: '#7c3aed' } })
      .build();
    expect(composed.manifest.tokenMap['shadows.glow']).toBe('0 0 12px #7c3aed');
  });

  it('preserves the v1-manifest fail-closed taint through extend() (D8)', () => {
    const real = buildKitTheme();
    // v1 facsimile: same raw data, manifest limited to the v1 field set.
    const v1Source: Record<string, unknown> = {};
    for (const key of Object.keys(real)) {
      v1Source[key] = (real as Record<string, unknown>)[key];
    }
    Object.defineProperty(v1Source, 'manifest', {
      value: {
        tokenMap: real.manifest.tokenMap,
        variableMap: real.manifest.variableMap,
        modes: real.manifest.modes,
        variableCss: real.manifest.variableCss,
      },
      enumerable: false,
    });

    const rebuilt = createTheme().extend(v1Source).build();
    expect(rebuilt.serialize().variableCss).toBe(real.manifest.variableCss);
    expect(rebuilt.manifest.manifestVersion).toBeUndefined();
    expect(rebuilt.manifest.tokenDefinitions).toBeUndefined();
    expect(rebuilt.manifest.modeAliasDefinitions).toBeUndefined();
    expect(rebuilt.manifest.registrations).toBeUndefined();
    expect(rebuilt.manifest.contractHash).toBeUndefined();
    expect(rebuilt.manifest.cssFragments).toBeUndefined();
  });
});

// ─── Round-trip fidelity (MODIFIED) ──────────────────────────

describe('extend() round-trip fidelity', () => {
  /** Rich source: system options + @property registration + emitted refs. */
  function buildRichSource() {
    return createTheme()
      .addBreakpoints({ sm: 768, lg: 1200 })
      .addColors({ ink: '#101014', bone: '#f5f2ea', ash: '#8a8a8a' })
      .addColorModes(
        'paper',
        {
          paper: { fg: 'ink', bg: 'bone', muted: 'ash' },
          midnight: { fg: 'bone', bg: 'ink', muted: 'ash' },
        },
        {
          systemPreference: { light: 'paper', dark: 'midnight' },
          browserColorScheme: { paper: 'light', midnight: 'dark' },
        }
      )
      .addScale({
        name: 'shadows',
        emit: true,
        values: { glow: '0 0 12px {colors.fg}' },
      })
      .declareContextualVars(
        { colors: ['current-bg'] },
        { 'current-bg': { syntax: '<color>', inherits: true } }
      )
      .build();
  }

  // Scenario: "Full round-trip".
  it('extend(lib) with no augmentation serializes identically to the source', () => {
    const lib = buildRichSource();
    const rebuilt = createTheme().extend(lib).build();
    expect(rebuilt.serialize()).toEqual(lib.serialize());
    expect(rebuilt.manifest.contractHash).toBe(lib.manifest.contractHash);
    expect(rebuilt.manifest.registrations).toEqual(lib.manifest.registrations);
  });

  // D6 exemption: a kit's OWN mode asymmetry is pre-existing behavior — the
  // coverage gate applies to consumer-declared modes only, so the
  // asymmetric source still round-trips.
  it('round-trips a source whose own modes are asymmetric without a coverage error', () => {
    const asymmetric = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ink: '#101014', bone: '#f5f2ea' })
      .addColorModes('dark', {
        dark: { primary: 'ink', extra: 'bone' },
        light: { primary: 'bone' },
      })
      .build();
    const rebuilt = createTheme().extend(asymmetric).build();
    expect(rebuilt.serialize()).toEqual(asymmetric.serialize());
  });

  it('does not infer scale emission from synthetic mode-alias variables', () => {
    const source = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'colors',
        values: { primary: '#001122', red: '#ff0000' },
      })
      .addColorModes('light', { light: { primary: 'red' } })
      .build();
    expect(source.manifest.variableMap).not.toHaveProperty('colors.red');
    expect(source.manifest.variableMap).toHaveProperty('colors.primary');

    const rebuilt = createTheme().extend(source).build();
    expect(rebuilt.serialize()).toEqual(source.serialize());
    expect(rebuilt.manifest.variableMap).not.toHaveProperty('colors.red');
  });

  it('preserves emission for an empty source scale before local extension', () => {
    const source = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'space', emit: true, values: {} })
      .build();

    const rebuilt = createTheme()
      .extend(source)
      .extendScale('space', () => ({ md: '8px' }))
      .build();

    expect(source.manifest.emittedScales).toContain('space');
    expect(rebuilt.manifest.variableMap['space.md']).toBe('--space-md');
    expect(rebuilt.manifest.tokenMap['space.md']).toBe('var(--space-md)');
  });

  it('resolves a same-path palette token and semantic alias without a self-reference', () => {
    const source = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'colors', values: { primary: '#ff0000' } })
      .addColorModes('light', { light: { primary: 'primary' } })
      .build();

    expect(source.manifest.variableCss).toContain('--color-primary: #ff0000;');
    expect(source.manifest.variableCss).not.toContain(
      '--color-primary: var(--color-primary);'
    );
    expect(source.manifest.modes.light['colors.primary']).toBe('#ff0000');
  });

  it('unions contextual variables from sibling extensions', () => {
    const buildSource = (name: string) =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({ name: 'space', values: { sm: '4px' } })
        .declareContextualVars({ space: [name] })
        .build();

    const theme = createTheme()
      .extend(buildSource('gap'))
      .extend(buildSource('pad'))
      .build();
    expect(theme.manifest.contextualVars?.space).toEqual(['gap', 'pad']);
  });

  it('preserves repeated contextual-variable entries on a no-op extension', () => {
    const source = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'space', values: { sm: '4px' } })
      .declareContextualVars({ space: ['gap', 'gap'] })
      .build();

    expect(createTheme().extend(source).build().serialize()).toEqual(
      source.serialize()
    );
  });

  it('rejects divergent registrations for one contextual variable', () => {
    const buildSource = (inherits: boolean) =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({ name: 'space', values: { sm: '4px' } })
        .declareContextualVars(
          { space: ['gap'] },
          { gap: { syntax: '<length>', inherits } }
        )
        .build();

    expect(() =>
      createTheme().extend(buildSource(true)).extend(buildSource(false))
    ).toThrow(/contextual variable 'gap'.*divergent/);
  });
});

// ─── Deep merge semantics (MODIFIED) ─────────────────────────

describe('deep merge semantics on augmentation (MODIFIED)', () => {
  // Scenario: "addColors deep merges".
  it('addColors deep merges: later caller wins on conflict, base preserved on non-conflict', () => {
    const base = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ gray: { 50: '#fafafa', 100: '#f0f0f0' } })
      .build();
    const composed = createTheme()
      .extend(base)
      .addColors({ gray: { 50: '#ffffff' } })
      .build();
    // Runtime storage is nested; the type surface is flat dot-paths.
    expect(
      (composed.colors as unknown as Record<string, unknown>).gray
    ).toEqual({
      50: '#ffffff',
      100: '#f0f0f0',
    });
  });

  // Scenario: "addScale merges by key" — the MODIFIED spec supersedes the
  // old replace-by-name scenario (which the v3 runtime never implemented:
  // `merge` has always deep-merged same-named scales by key).
  it('addScale merges by key: union of keys, consumer value on conflict', () => {
    const composed = createTheme()
      .extend(buildKitTheme())
      .addScale({ name: 'space', values: { 4: '0.3rem', 12: '0.75rem' } })
      .build();
    expect(composed.space as unknown).toEqual({
      0: '0',
      4: '0.3rem',
      8: '0.5rem',
      12: '0.75rem',
    });
  });

  // Scenario: "Explicit replacement replaces wholesale".
  it('addScale replace: true replaces wholesale — exactly the consumer keys remain', () => {
    const kit = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'radii', values: { sm: '2px', lg: '8px' } })
      .build();
    const replaced = createTheme()
      .extend(kit)
      .addScale({ name: 'radii', values: { pill: '999px' }, replace: true })
      .build();
    expect(replaced.radii as unknown).toEqual({ pill: '999px' });
    expect(replaced.manifest.tokenMap['radii.sm']).toBeUndefined();
  });

  // Scenario: "addColorModes merges modes".
  it('addColorModes merges modes: base modes plus the consumer mode', () => {
    const composed = createTheme()
      .extend(buildKitTheme())
      .addColorModes('dark', {
        custom: { primary: 'bone', bg: 'ember', muted: 'void' },
      })
      .build();
    expect(Object.keys(composed.manifest.modes).sort()).toEqual([
      'custom',
      'dark',
      'light',
    ]);
  });
});

// ─── Structural progressivity (D5) ───────────────────────────

describe('structural progressivity of inherited tokens (D5)', () => {
  function buildReferencingKit() {
    return createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'shadows', values: { glow: '0 0 12px #ffffff' } })
      .addScale({ name: 'effects', values: { halo: '{shadows.glow} inset' } })
      .build();
  }

  // Scenario: "Wholesale replacement is explicit".
  it('addScale without replace keeps inherited keys present', () => {
    const composed = createTheme()
      .extend(buildKitTheme())
      .addScale({ name: 'space', values: { 12: '0.75rem' } })
      .build();
    expect(composed.space[0]).toBe('0');
    expect(composed.space[4]).toBe('0.25rem');
    expect(composed.space[8]).toBe('0.5rem');
  });

  // Scenario: "Dangling reference fails at build" — unconditional on usage
  // (no component uses `effects.halo` anywhere; the build still fails).
  it('explicit replacement dropping a referenced key fails build() naming referencer, call, and dropped keys', () => {
    expect(() =>
      createTheme()
        .extend(buildReferencingKit())
        .addScale({
          name: 'shadows',
          values: { rim: '0 0 2px #000000' },
          replace: true,
        })
        .build()
    ).toThrow(
      /build: dangling token reference\(s\) after explicit scale replacement — 'effects\.halo' \(extended theme #1\) references '\{shadows\.glow\}', dropped by addScale\(\{ name: 'shadows', replace: true \}\)\. Dropped keys: shadows\.glow\./
    );
  });

  it('a re-added key after replacement makes the reference resolve again', () => {
    const rebuilt = createTheme()
      .extend(buildReferencingKit())
      .addScale({
        name: 'shadows',
        values: { rim: '0 0 2px #000000' },
        replace: true,
      })
      .addScale({ name: 'shadows', values: { glow: '0 0 9px #123456' } })
      .build();
    expect(rebuilt.manifest.tokenMap['effects.halo']).toBe(
      '0 0 9px #123456 inset'
    );
  });

  it('references to paths never defined anywhere keep warn-and-literal (kit pattern)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const composed = createTheme()
      .extend(buildKitTheme())
      .addScale({ name: 'accents', values: { ring: '{colors.brandTint}' } })
      .build();
    expect(composed.manifest.tokenMap['accents.ring']).toBe(
      '{colors.brandTint}'
    );
    expect(warnSpy).toHaveBeenCalledWith(
      "[animus] Token ref {colors.brandTint} — path 'colors.brandTint' not found in token map"
    );
    warnSpy.mockRestore();
  });
});

// ─── Mode bases (D6) ─────────────────────────────────────────

describe('mode extension declares its base (D6)', () => {
  // Scenario: "Declared base fills coverage gaps".
  it('a declared base fills coverage gaps with one aggregated diagnostic', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const composed = createTheme()
      .extend(buildKitTheme())
      .addColorModes(
        'dark',
        { 'high-contrast': { primary: 'void' } },
        { basedOn: { 'high-contrast': 'light' } }
      )
      .build();

    const css = composed.serialize().variableCss;
    const block = blockDeclarations(css, '[data-color-mode="high-contrast"]');
    // Overridden alias uses the consumer's value…
    expect(block).toContain('--color-primary: #000000;');
    // …and the uncovered aliases resolve through the declared base (light).
    expect(block).toContain('--color-bg: #e8e0d0;');
    expect(block).toContain('--color-muted: #ff2800;');
    // ONE aggregated report, never per-token spam.
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      "[animus] Mode 'high-contrast': 2 alias(es) inherit from 'light'"
    );
    infoSpy.mockRestore();
  });

  // Scenario: "Missing base with gaps fails".
  it('a consumer mode with uncovered inherited aliases and no base fails listing them', () => {
    expect(() =>
      createTheme()
        .extend(buildKitTheme())
        .addColorModes('dark', { 'high-contrast': { primary: 'void' } })
        .build()
    ).toThrow(
      /build: mode 'high-contrast' leaves 2 inherited alias\(es\) uncovered and declares no base — uncovered: bg, muted/
    );
  });

  it('resolves uncovered aliases through a multi-level basedOn chain, one diagnostic per mode', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const composed = createTheme()
      .extend(buildKitTheme())
      .addColorModes(
        'dark',
        {
          hc: { primary: 'void', bg: 'ember' },
          hcDim: { primary: 'bone' },
        },
        { basedOn: { hc: 'light', hcDim: 'hc' } }
      )
      .build();
    const block = blockDeclarations(
      composed.serialize().variableCss,
      '[data-color-mode="hcDim"]'
    );
    // hcDim's own override…
    expect(block).toContain('--color-primary: #e8e0d0;');
    // …bg resolves through hc (one hop)…
    expect(block).toContain('--color-bg: #ff2800;');
    // …muted resolves through hc → light (two hops).
    expect(block).toContain('--color-muted: #ff2800;');
    expect(infoSpy).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalledWith(
      "[animus] Mode 'hc': 1 alias(es) inherit from 'light'"
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "[animus] Mode 'hcDim': 2 alias(es) inherit from 'hc'"
    );
    infoSpy.mockRestore();
  });

  it('rejects a basedOn entry naming an unknown base mode', () => {
    expect(() =>
      createTheme()
        .extend(buildKitTheme())
        .addColorModes(
          'dark',
          { 'high-contrast': { primary: 'void' } },
          { basedOn: { 'high-contrast': 'nocturne' } }
        )
    ).toThrow(
      /addColorModes: basedOn\['high-contrast'\] references unknown base mode 'nocturne'/
    );
  });

  it('rejects a basedOn self-base and a basedOn cycle', () => {
    expect(() =>
      createTheme()
        .extend(buildKitTheme())
        .addColorModes(
          'dark',
          { hc: { primary: 'void' } },
          { basedOn: { hc: 'hc' } }
        )
    ).toThrow(/cannot base a mode on itself/);

    expect(() =>
      createTheme()
        .extend(buildKitTheme())
        .addColorModes(
          'dark',
          { hcA: { primary: 'void' }, hcB: { primary: 'bone' } },
          { basedOn: { hcA: 'hcB', hcB: 'hcA' } }
        )
    ).toThrow(/basedOn chain cycles/);
  });

  it('a consumer mode covering every inherited alias needs no base', () => {
    const composed = createTheme()
      .extend(buildKitTheme())
      .addColorModes('dark', {
        custom: { primary: 'bone', bg: 'ember', muted: 'void' },
      })
      .build();
    expect(
      blockDeclarations(
        composed.serialize().variableCss,
        '[data-color-mode="custom"]'
      )
    ).toEqual([
      '--color-bg: #ff2800;',
      '--color-muted: #000000;',
      '--color-primary: #e8e0d0;',
    ]);
  });
});

// ─── Determinism closures (inc 03 review register) ───────────

describe('determinism closures (G2/G3)', () => {
  // G3: reversed declarations — including breakpoint keys, color keys, mode
  // config order, alias order, and scale order — are byte-identical across
  // the WHOLE emitted CSS and the serialized wire.
  function buildForwardDeclared() {
    return createTheme()
      .addBreakpoints({ sm: 768, lg: 1200, md: 1024 })
      .addScale({ name: 'space', values: { edge: '1rem', gutter: '2rem' } })
      .addColors({ ink: '#101014', bone: '#f5f2ea', ash: '#8a8a8a' })
      .addColorModes('paper', {
        paper: { fg: 'ink', bg: 'bone', muted: 'ash' },
        midnight: { fg: 'bone', bg: 'ink', muted: 'ash' },
      })
      .build();
  }
  function buildReverseDeclared() {
    return createTheme()
      .addBreakpoints({ md: 1024, lg: 1200, sm: 768 })
      .addColors({ ash: '#8a8a8a', bone: '#f5f2ea', ink: '#101014' })
      .addColorModes('paper', {
        midnight: { muted: 'ash', bg: 'ink', fg: 'bone' },
        paper: { muted: 'ash', bg: 'bone', fg: 'ink' },
      })
      .addScale({ name: 'space', values: { gutter: '2rem', edge: '1rem' } })
      .build();
  }

  it('G3: reversed declarations are byte-identical across CSS, scalesJson, and variableMapJson', () => {
    const forward = buildForwardDeclared().serialize();
    const reversed = buildReverseDeclared().serialize();
    expect(reversed.variableCss).toBe(forward.variableCss);
    expect(reversed.scalesJson).toBe(forward.scalesJson);
    expect(reversed.variableMapJson).toBe(forward.variableMapJson);
    expect(reversed.contextualVarsJson).toBe(forward.contextualVarsJson);
  });

  // G2 (review probe, journal 2026-08-04 15:04): mode-override declarations
  // previously carried RAW flattened values, leaking `{…}` into
  // [data-color-mode] blocks when colors was a reference-valued addScale.
  it('G2: mode-override declarations resolve through the resolver', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'palette',
        values: { fire: '#ff2800', ice: '#0044ff' },
      })
      .addScale({
        name: 'colors',
        values: { ember: '{palette.fire}', frost: '{palette.ice}' },
      })
      .addColorModes('warm', {
        warm: { primary: 'ember' },
        cool: { primary: 'frost' },
      })
      .build();
    const css = theme.serialize().variableCss;
    expect(css).not.toMatch(/\{[a-zA-Z0-9_.]+\}/);
    expect(blockDeclarations(css, '[data-color-mode="warm"]')).toContain(
      '--color-primary: #ff2800;'
    );
    expect(blockDeclarations(css, '[data-color-mode="cool"]')).toContain(
      '--color-primary: #0044ff;'
    );
    expect(theme.manifest.modes.warm['colors.primary']).toBe('#ff2800');
  });

  // G2: an emitted declaration whose reference target is never defined
  // anywhere is OMITTED from emitted CSS with one aggregated warning — a
  // literal `{…}` in shipped CSS is worse than an absent declaration.
  it('G2: omits emitted declarations with never-defined targets, one aggregated warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({
        name: 'shadows',
        emit: true,
        values: { glow: '0 0 12px {colors.brandTint}', rim: '0 0 1px #000000' },
      })
      .build();
    const css = theme.serialize().variableCss;
    expect(css).not.toContain('--shadows-glow');
    expect(css).toContain('--shadows-rim: 0 0 1px #000000;');
    expect(css).not.toMatch(/\{[a-zA-Z0-9_.]+\}/);
    // ONE aggregated omission warning naming the omitted var (plus the
    // resolver's existing once-per-missing-path warning).
    const omissionCalls = warnSpy.mock.calls.filter(([message]) =>
      String(message).startsWith('[animus] Omitted')
    );
    expect(omissionCalls).toEqual([
      [
        '[animus] Omitted 1 CSS declaration(s) whose token references never resolved: --shadows-glow',
      ],
    ]);
    warnSpy.mockRestore();
  });

  it('G2: omission covers TRANSITIVE never-defined targets reaching an emitted declaration', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addScale({ name: 'edges', values: { hot: '1px solid {ghost.color}' } })
      .addScale({ name: 'frames', emit: true, values: { card: '{edges.hot}' } })
      .build();
    const css = theme.serialize().variableCss;
    expect(css).not.toContain('--frames-card');
    expect(css).not.toMatch(/\{[a-zA-Z0-9_.]+\}/);
    // The aggregated warning names the transitively-omitted var (review F6).
    const omissionCalls = warnSpy.mock.calls.filter(([message]) =>
      String(message).startsWith('[animus] Omitted')
    );
    expect(omissionCalls).toEqual([
      [
        '[animus] Omitted 1 CSS declaration(s) whose token references never resolved: --frames-card',
      ],
    ]);
    // The non-emitted surface keeps warn-and-literal (supported kit pattern).
    expect(theme.manifest.tokenMap['edges.hot']).toBe(
      '1px solid {ghost.color}'
    );
    warnSpy.mockRestore();
  });
});

// ─── from() freeze (G6) ──────────────────────────────────────

describe('from() freeze during the deprecation window (G6)', () => {
  // Scenario: "from() precedence is unchanged during the window" — source
  // WINS over prior builder state, and from() stays callable after
  // augmentation calls (no stage gate).
  it('keeps from() source-wins and callable after augmentation', () => {
    const lib = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ember: '#ff2800' })
      .build();
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors({ ember: '#00ff00' })
      .from(lib)
      .build();
    expect((theme.colors as unknown as Record<string, string>).ember).toBe(
      '#ff2800'
    );
  });

  // Scenario: "Deprecation is visible to consumers" — the published types
  // are emitted from this docblock, so the source-level tag is the witness.
  it('marks theme from() as deprecated pointing at extend()', () => {
    const builderSource = readFileSync(
      resolve(fileURLToPath(import.meta.url), '../../src/theme/createTheme.ts'),
      'utf8'
    );
    expect(builderSource).toMatch(/@deprecated Use `extend\(source\)`/);
  });
});
