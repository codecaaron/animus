/**
 * Tests for manifest v2 foundation (openspec change: multi-theme-support,
 * increment 01 — envelope specs `theme-variable-emission` /
 * `system-serialization`, plus the fragment byte-fidelity half of
 * `named-theme-variants` § "Composition of variant-enabled themes and legacy
 * manifests" and the strengthened `theme-composition` § "Round-trip fidelity").
 *
 * Scenario mapping (spec header → test):
 * - theme-variable-emission › Zero-variant emission parity › "Existing
 *   fixtures diff empty" → 'pins the exact variableCss of the reference
 *   fixture...' (plus `vp run verify:parity`, G1)
 * - theme-variable-emission › Zero-variant emission parity › "System-enabled
 *   theme is unchanged" → 'pins the exact variableCss of the system-enabled
 *   registered fixture...'
 * - theme-variable-emission › Zero-variant emission parity › "No variant
 *   constructs leak into variant-less output" → 'introduces no variant
 *   construct into variant-less output'
 * - named-theme-variants › Composition… › "Unaugmented round trip is
 *   byte-identical" (fragment half) → 'unmutated round-trip reproduces
 *   variableCss and every fragment byte-exactly'
 * - named-theme-variants › Composition… › "Augmentation preserves untouched
 *   fragments" (registrations half) → 'augmentation preserves the untouched
 *   registrations fragment byte-exactly'
 * - named-theme-variants › Composition… › "Legacy manifest produces a
 *   targeted error" → increment 03 (NOT covered here); this increment covers
 *   the v1 pass-through half → 'a v1-shaped source round-trips with NO
 *   fabricated v2 fields'
 * - system-serialization › Theme self-serialization → wire stays FOUR keys in
 *   this increment: 'serialize() still returns exactly the four legacy keys'
 *   (the fifth-key scenario is increment 05's obligation)
 */
import { describe, expect, it } from 'vitest';

import { createTheme } from '../src';

// ─── Fixtures (factories — `merge` adopts and mutates source literals) ──────

const breakpoints = { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 } as const;

/** Mirrors theme.test.ts buildTestTheme() — the reference fixture style. */
function buildReferenceFixture() {
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
      dark: { primary: 'ember', bg: 'void', muted: 'gray.300' },
      light: { primary: 'void', bg: 'bone', muted: 'gray.600' },
    })
    .build();
}

/**
 * System-enabled + `@property`-registered fixture (system-scheme-emission
 * style): produces BOTH fragment kinds and the guarded media blocks that must
 * stay INSIDE the `base` fragment on the legacy path.
 */
function buildSystemRegisteredFixture() {
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
    .declareContextualVars(
      { colors: ['current-bg'] },
      {
        'current-bg': {
          syntax: '<color>',
          inherits: true,
          initialValue: 'transparent',
        },
      }
    )
    .build();
}

/**
 * Hand-construct a v1-built-theme facsimile from a real built theme: same raw
 * data, manifest limited to the v1 field set (no manifestVersion
 * discriminant), non-enumerable exactly like build() defines it.
 */
function buildV1Facsimile(
  real: ReturnType<typeof buildReferenceFixture>
): Record<string, unknown> {
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
  return v1Source;
}

/** Authored-graph fixture: literal, plain ref, and opacity ref side by side. */
function buildAuthoredGraphFixture() {
  return createTheme()
    .addBreakpoints({ sm: 768 })
    .addColors({ ink: '#101014', ember: '#ff2800', gray: { 300: '#666666' } })
    .addColorModes('dark', {
      dark: { primary: 'ember', muted: 'gray.300' },
      light: { primary: 'ink', muted: 'gray.300' },
    })
    .addScale({
      name: 'shadows',
      values: { glow: '0 0 12px {colors.primary}' },
    })
    .addScale({ name: 'overlays', values: { dim: '{colors.ember/50}' } })
    .addScale({ name: 'space', values: { 8: '0.5rem' } })
    .build();
}

// ─── Task 01.2: authored graph capture ──────────────────────

describe('manifest v2 authored token definitions', () => {
  it('distinguishes literal, reference, and opacity-reference authored forms', () => {
    const defs = buildAuthoredGraphFixture().manifest.tokenDefinitions;
    expect(defs).toBeDefined();
    expect(defs?.['space.8']).toEqual({ kind: 'literal', value: '0.5rem' });
    expect(defs?.['shadows.glow']).toEqual({
      kind: 'reference',
      value: '0 0 12px {colors.primary}',
      references: [{ path: 'colors.primary' }],
    });
    expect(defs?.['overlays.dim']).toEqual({
      kind: 'reference',
      value: '{colors.ember/50}',
      references: [{ path: 'colors.ember', opacity: '50' }],
    });
  });

  it('captures palette colors as authored literals', () => {
    const defs = buildAuthoredGraphFixture().manifest.tokenDefinitions;
    expect(defs?.['colors.ember']).toEqual({
      kind: 'literal',
      value: '#ff2800',
    });
    expect(defs?.['colors.gray.300']).toEqual({
      kind: 'literal',
      value: '#666666',
    });
  });

  it('records AUTHORED mode alias dot-paths, never resolved raw values', () => {
    const modeAliases =
      buildAuthoredGraphFixture().manifest.modeAliasDefinitions;
    expect(modeAliases).toEqual({
      dark: { primary: 'ember', muted: 'gray.300' },
      light: { primary: 'ink', muted: 'gray.300' },
    });
    // The discarded-string hazard: the capture must be the colorRef, not the
    // value `flatColors[colorRef]` resolves it to.
    expect(modeAliases?.dark.primary).not.toBe('#ff2800');
    expect(modeAliases?.dark.muted).not.toBe('#666666');
  });
});

// ─── Task 01.3: version, hash, fragments ────────────────────

describe('manifest v2 version, contract hash, and CSS fragments', () => {
  it('carries manifestVersion 2 and an emitter version on every fresh build', () => {
    const manifest = buildReferenceFixture().manifest;
    expect(manifest.manifestVersion).toBe(2);
    expect(typeof manifest.emitterVersion).toBe('number');
  });

  it('computes an identical contractHash for two identically authored builds', () => {
    const first = buildSystemRegisteredFixture().manifest.contractHash;
    const second = buildSystemRegisteredFixture().manifest.contractHash;
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('computes the same contractHash regardless of authored insertion order', () => {
    // Evidences canonicalize()'s at-every-depth key sort: without it these two
    // builds would digest differently-ordered JSON. Deliberate semantics this
    // increment — the hash identifies the authored token GRAPH, not the
    // emitted wire (declaration order does affect CSS; increment 05 owns
    // deciding whether wire identity needs a broader digest).
    const forward = createTheme()
      .addBreakpoints({ sm: 768 })
      .addScale({ name: 'space', values: { 4: '0.25rem' } })
      .addScale({ name: 'radii', values: { sm: '2px' } })
      .build();
    const reversed = createTheme()
      .addBreakpoints({ sm: 768 })
      .addScale({ name: 'radii', values: { sm: '2px' } })
      .addScale({ name: 'space', values: { 4: '0.25rem' } })
      .build();

    expect(forward.manifest.contractHash).toBeDefined();
    expect(reversed.manifest.contractHash).toBe(forward.manifest.contractHash);
  });

  it('computes an identical contractHash when node:crypto is unavailable (pure fallback)', () => {
    // sha256Hex reads `globalThis.process.getBuiltinModule` at call time;
    // removing it forces the pure FIPS 180-4 fallback that non-Node runtimes
    // use (built themes execute inside client bundles). Cross-environment
    // composition identity requires both paths to digest identically.
    const nodeCryptoHash = buildSystemRegisteredFixture().manifest.contractHash;
    const proc = (
      globalThis as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    expect(proc?.getBuiltinModule).toBeDefined();
    const original = proc!.getBuiltinModule;
    let fallbackHash: string | undefined;
    try {
      proc!.getBuiltinModule = undefined;
      fallbackHash = buildSystemRegisteredFixture().manifest.contractHash;
    } finally {
      proc!.getBuiltinModule = original;
    }

    expect(nodeCryptoHash).toBeDefined();
    expect(fallbackHash).toBe(nodeCryptoHash);
  });

  it('computes an identical contractHash without node:crypto or TextEncoder (QuickJS)', () => {
    // The Rust system-loader evaluates the system bundle in QuickJS, which
    // provides ES built-ins only — no Node globals and no WHATWG APIs
    // (rust-system-loader spec). The fallback must digest without either.
    const nodeCryptoHash = buildSystemRegisteredFixture().manifest.contractHash;
    const proc = (
      globalThis as {
        process?: { getBuiltinModule?: (id: string) => unknown };
      }
    ).process;
    expect(proc?.getBuiltinModule).toBeDefined();
    const originalGetBuiltin = proc!.getBuiltinModule;
    const originalTextEncoder = (globalThis as { TextEncoder?: unknown })
      .TextEncoder;
    expect(originalTextEncoder).toBeDefined();
    let fallbackHash: string | undefined;
    try {
      proc!.getBuiltinModule = undefined;
      (globalThis as { TextEncoder?: unknown }).TextEncoder = undefined;
      fallbackHash = buildSystemRegisteredFixture().manifest.contractHash;
    } finally {
      proc!.getBuiltinModule = originalGetBuiltin;
      (globalThis as { TextEncoder?: unknown }).TextEncoder =
        originalTextEncoder;
    }

    expect(nodeCryptoHash).toBeDefined();
    expect(fallbackHash).toBe(nodeCryptoHash);
  });

  it('changes the contractHash when one authored literal changes', () => {
    const base = createTheme()
      .addBreakpoints({ sm: 768 })
      .addColors({ ember: '#ff2800' })
      .build();
    const changed = createTheme()
      .addBreakpoints({ sm: 768 })
      .addColors({ ember: '#ff2801' })
      .build();
    expect(base.manifest.contractHash).toBeDefined();
    expect(changed.manifest.contractHash).not.toBe(base.manifest.contractHash);
  });

  it('records registrations and base fragments holding the composed strings', () => {
    const theme = buildSystemRegisteredFixture();
    const fragments = theme.manifest.cssFragments;
    expect(fragments?.map((fragment) => fragment.kind)).toEqual([
      'registrations',
      'base',
    ]);
    // The fragments RECORD what build() composed — variableCss is still the
    // independent join of exactly those strings (zero-delta contract).
    expect(`${fragments?.[0].cssText}\n\n${fragments?.[1].cssText}`).toBe(
      theme.manifest.variableCss
    );
  });

  it('emits no registrations fragment and no @property for an unregistered theme', () => {
    const theme = buildReferenceFixture();
    const fragments = theme.manifest.cssFragments;
    expect(fragments?.map((fragment) => fragment.kind)).toEqual(['base']);
    expect(fragments?.[0].cssText).toBe(theme.manifest.variableCss);
    expect(theme.manifest.variableCss).not.toContain('@property');
  });
});

// ─── Task 01.4: from() copy-on-write ────────────────────────

describe('manifest v2 from() copy-on-write fidelity', () => {
  it('unmutated round-trip reproduces variableCss and every fragment byte-exactly', () => {
    const source = buildSystemRegisteredFixture();
    const rebuilt = createTheme().from(source).build();

    expect(rebuilt.serialize().variableCss).toBe(
      source.serialize().variableCss
    );
    const sourceFragments = source.manifest.cssFragments;
    const rebuiltFragments = rebuilt.manifest.cssFragments;
    expect(sourceFragments?.length).toBeGreaterThan(0);
    expect(rebuiltFragments?.length).toBe(sourceFragments?.length);
    sourceFragments?.forEach((fragment, index) => {
      expect(rebuiltFragments?.[index].cssText).toBe(fragment.cssText);
      expect(rebuiltFragments?.[index].id).toBe(fragment.id);
      expect(rebuiltFragments?.[index].kind).toBe(fragment.kind);
    });
  });

  it('carries tokenDefinitions, modeAliasDefinitions, emitterVersion, and contractHash through from()', () => {
    const source = buildSystemRegisteredFixture();
    const rebuilt = createTheme().from(source).build();

    expect(rebuilt.manifest.manifestVersion).toBe(2);
    expect(rebuilt.manifest.tokenDefinitions).toEqual(
      source.manifest.tokenDefinitions
    );
    expect(rebuilt.manifest.modeAliasDefinitions).toEqual(
      source.manifest.modeAliasDefinitions
    );
    expect(rebuilt.manifest.emitterVersion).toBe(
      source.manifest.emitterVersion
    );
    expect(rebuilt.manifest.contractHash).toBe(source.manifest.contractHash);
  });

  it('keeps @property registration metadata across from() and re-emits the same rules', () => {
    const source = buildSystemRegisteredFixture();
    const rebuilt = createTheme().from(source).build();

    expect(rebuilt.manifest.registrations).toEqual({
      'current-bg': {
        syntax: '<color>',
        inherits: true,
        initialValue: 'transparent',
      },
    });
    expect(rebuilt.serialize().variableCss).toContain(
      '@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }'
    );
  });

  it('augmentation preserves the untouched registrations fragment byte-exactly', () => {
    const source = buildSystemRegisteredFixture();
    const sourceRegistrations = source.manifest.cssFragments?.find(
      (fragment) => fragment.kind === 'registrations'
    );
    const augmented = createTheme()
      .from(source)
      .addScale({ name: 'radii', emit: true, values: { sm: '2px' } })
      .build();
    const augmentedRegistrations = augmented.manifest.cssFragments?.find(
      (fragment) => fragment.kind === 'registrations'
    );

    // The mutated section (base) regenerates and picks up the new scale…
    expect(
      augmented.manifest.cssFragments?.find(
        (fragment) => fragment.kind === 'base'
      )?.cssText
    ).toContain('--radii-sm: 2px;');
    // …while the untouched registrations section passes through byte-exactly.
    expect(augmentedRegistrations?.cssText).toBe(sourceRegistrations?.cssText);
  });

  it('a v1-shaped source round-trips with NO fabricated v2 fields', () => {
    const real = buildReferenceFixture();
    const rebuilt = createTheme().from(buildV1Facsimile(real)).build();

    // Round-trips unchanged…
    expect(rebuilt.serialize().variableCss).toBe(real.manifest.variableCss);
    // …and gains NO fabricated v2 fields (D8: the authored graph behind a v1
    // manifest is unknowable — never inferred from resolved values).
    expect(rebuilt.manifest.manifestVersion).toBeUndefined();
    expect(rebuilt.manifest.tokenDefinitions).toBeUndefined();
    expect(rebuilt.manifest.modeAliasDefinitions).toBeUndefined();
    expect(rebuilt.manifest.registrations).toBeUndefined();
    expect(rebuilt.manifest.emitterVersion).toBeUndefined();
    expect(rebuilt.manifest.contractHash).toBeUndefined();
    expect(rebuilt.manifest.cssFragments).toBeUndefined();
  });

  it('suppresses v2 fields on a MUTATED legacy composition chain', () => {
    // The v1 taint is fail-closed: it must survive copyState through every
    // later phase call, not just the unmutated round-trip — the genuinely
    // authored additions below still sit atop an unknowable v1 graph (D8).
    const real = buildReferenceFixture();
    const mutated = createTheme()
      .from(buildV1Facsimile(real))
      .addColors({ neon: '#39ff14' })
      .addScale({ name: 'radii', emit: true, values: { sm: '2px' } })
      .build();

    expect(mutated.serialize().variableCss).toContain('--radii-sm: 2px;');
    expect(mutated.manifest.manifestVersion).toBeUndefined();
    expect(mutated.manifest.tokenDefinitions).toBeUndefined();
    expect(mutated.manifest.contractHash).toBeUndefined();
    expect(mutated.manifest.cssFragments).toBeUndefined();
  });
});

// ─── Task 01.5: zero-variant emission parity pins + wire lock ─

/**
 * Captured from the PRE-increment emitter (2026-08-03, branch
 * feat/color-system, clean tree) for the reference fixture above. Manifest v2
 * is metadata-only: this string may NEVER change while the fixture stands
 * (G1 — zero-variant themes emit byte-identical CSS).
 */
const REFERENCE_FIXTURE_VARIABLE_CSS = `:root {
  --color-void: #000000;
  --color-ember: #ff2800;
  --color-bone: #e8e0d0;
  --color-gray-300: #666666;
  --color-gray-600: #333333;
  --color-primary: var(--color-ember);
  --color-bg: var(--color-void);
  --color-muted: var(--color-gray-300);
  --breakpoint-xs: 480px;
  --breakpoint-sm: 768px;
  --breakpoint-md: 1024px;
  --breakpoint-lg: 1200px;
  --breakpoint-xl: 1440px;
}

[data-color-mode="dark"] {
  --color-primary: #ff2800;
  --color-bg: #000000;
  --color-muted: #666666;
}

[data-color-mode="light"] {
  --color-primary: #000000;
  --color-bg: #e8e0d0;
  --color-muted: #333333;
}`;

/** Same capture for the system-enabled registered fixture (both fragments). */
const SYSTEM_FIXTURE_VARIABLE_CSS = `@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }

:root {
  --color-ink: #101014;
  --color-bone: #f5f2ea;
  --color-ash: #8a8a8a;
  --color-fg: var(--color-ink);
  --color-bg: var(--color-bone);
  --color-muted: var(--color-ash);
  --breakpoint-sm: 768px;
  --breakpoint-lg: 1200px;
  color-scheme: light;
}

@media (prefers-color-scheme: light) {
  :root:not([data-color-mode]) {
    --color-fg: #101014;
    --color-bg: #f5f2ea;
    --color-muted: #8a8a8a;
    color-scheme: light;
  }
}

@media (prefers-color-scheme: dark) {
  :root:not([data-color-mode]) {
    --color-fg: #f5f2ea;
    --color-bg: #101014;
    --color-muted: #8a8a8a;
    color-scheme: dark;
  }
}

[data-color-mode="paper"] {
  --color-fg: #101014;
  --color-bg: #f5f2ea;
  --color-muted: #8a8a8a;
  color-scheme: light;
}

[data-color-mode="midnight"] {
  --color-fg: #f5f2ea;
  --color-bg: #101014;
  --color-muted: #8a8a8a;
  color-scheme: dark;
}`;

describe('zero-variant emission parity (G1 pin)', () => {
  it('pins the exact variableCss of the reference fixture and carries manifestVersion 2', () => {
    const theme = buildReferenceFixture();
    expect(theme.serialize().variableCss).toBe(REFERENCE_FIXTURE_VARIABLE_CSS);
    expect(theme.manifest.manifestVersion).toBe(2);
  });

  it('pins the exact variableCss of the system-enabled registered fixture', () => {
    const theme = buildSystemRegisteredFixture();
    expect(theme.serialize().variableCss).toBe(SYSTEM_FIXTURE_VARIABLE_CSS);
    expect(theme.manifest.manifestVersion).toBe(2);
  });

  it('introduces no variant construct into variant-less output', () => {
    for (const theme of [
      buildReferenceFixture(),
      buildSystemRegisteredFixture(),
    ]) {
      const css = theme.serialize().variableCss;
      expect(css).not.toContain('@layer');
      expect(css).not.toContain('@scope');
      expect(css).not.toContain('data-animus-theme');
    }
  });

  it('serialize() still returns exactly the four legacy keys', () => {
    // Cross-change lock (change:system-color-scheme G5): the fifth key
    // (themeCssPlanJson) belongs to increment 05 and must NOT appear here.
    expect(Object.keys(buildSystemRegisteredFixture().serialize())).toEqual([
      'scalesJson',
      'variableMapJson',
      'variableCss',
      'contextualVarsJson',
    ]);
  });
});
