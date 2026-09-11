import { describe, expect, it } from 'vitest';

import { createTheme } from '../src';

// Fixtures are factories: `merge` deep-merges into its source literals in
// place, so one shared literal would couple unrelated tests.

const breakpoints = { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 } as const;

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

type BuiltReferenceTheme = ReturnType<typeof buildReferenceFixture>;

type V1Manifest = Pick<
  BuiltReferenceTheme['manifest'],
  'tokenMap' | 'variableMap' | 'modes' | 'variableCss'
>;

/**
 * build() attaches manifest, serialize, and varRef as non-enumerable own
 * properties, so a key copy reproduces exactly a v1 build's data half.
 */
interface V1Facsimile extends Omit<
  BuiltReferenceTheme,
  '__emitted' | 'manifest' | 'serialize' | 'varRef'
> {
  manifest: V1Manifest;
}

function buildV1Facsimile(real: BuiltReferenceTheme): V1Facsimile {
  const v1Manifest: V1Manifest = {
    tokenMap: real.manifest.tokenMap,
    variableMap: real.manifest.variableMap,
    modes: real.manifest.modes,
    variableCss: real.manifest.variableCss,
  };
  return Object.defineProperty({ ...real }, 'manifest', {
    value: v1Manifest,
    enumerable: false,
  });
}

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
    expect(modeAliases?.dark.primary).not.toBe('#ff2800');
    expect(modeAliases?.dark.muted).not.toBe('#666666');
  });
});

type BuiltinModuleLookup = (id: string) => object | undefined;

interface HashingAmbients {
  process?: Omit<NodeJS.Process, 'getBuiltinModule'> & {
    getBuiltinModule?: BuiltinModuleLookup;
  };
  TextEncoder?: typeof globalThis.TextEncoder;
}

const ambients: HashingAmbients = globalThis;

describe('manifest v2 version, contract hash, and CSS fragments', () => {
  it('carries manifestVersion 2 and an emitter version on every fresh build', () => {
    const manifest = buildReferenceFixture().manifest;
    expect(manifest.manifestVersion).toBe(2);
    expect(manifest.emitterVersion).toEqual(expect.any(Number));
    expect(manifest.emittedScales).toEqual(['colors']);
  });

  it('includes the exact emitted-scale set in the contract hash', () => {
    const inline = createTheme()
      .addScale({ name: 'space', values: { sm: '4px' } })
      .build();
    const emitted = createTheme()
      .addScale({ name: 'space', emit: true, values: { sm: '4px' } })
      .build();

    expect(inline.manifest.emittedScales).toEqual([]);
    expect(emitted.manifest.emittedScales).toEqual(['space']);
    expect(emitted.manifest.contractHash).not.toBe(
      inline.manifest.contractHash
    );
  });

  it('computes an identical contractHash for two identically authored builds', () => {
    const first = buildSystemRegisteredFixture().manifest.contractHash;
    const second = buildSystemRegisteredFixture().manifest.contractHash;
    expect(first).toBeDefined();
    expect(second).toBe(first);
  });

  it('computes the same contractHash regardless of authored insertion order', () => {
    // The hash identifies the authored token graph, not the emitted wire:
    // canonicalization sorts keys at every depth.
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
    // sha256Hex reads process.getBuiltinModule at call time; removing it forces
    // the pure fallback non-Node runtimes take, which must digest identically.
    const nodeCryptoHash = buildSystemRegisteredFixture().manifest.contractHash;
    const proc = ambients.process;
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
    // The Rust system-loader runs the bundle in QuickJS: ES built-ins only, no
    // Node globals and no WHATWG APIs, so the fallback needs neither.
    const nodeCryptoHash = buildSystemRegisteredFixture().manifest.contractHash;
    const proc = ambients.process;
    expect(proc?.getBuiltinModule).toBeDefined();
    const originalGetBuiltin = proc!.getBuiltinModule;
    const originalTextEncoder = ambients.TextEncoder;
    expect(originalTextEncoder).toBeDefined();
    let fallbackHash: string | undefined;
    try {
      proc!.getBuiltinModule = undefined;
      ambients.TextEncoder = undefined;
      fallbackHash = buildSystemRegisteredFixture().manifest.contractHash;
    } finally {
      proc!.getBuiltinModule = originalGetBuiltin;
      ambients.TextEncoder = originalTextEncoder;
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

  it('carries tokenDefinitions, emittedScales, modeAliasDefinitions, emitterVersion, and contractHash through from()', () => {
    const source = buildSystemRegisteredFixture();
    const rebuilt = createTheme().from(source).build();

    expect(rebuilt.manifest.manifestVersion).toBe(2);
    expect(rebuilt.manifest.tokenDefinitions).toEqual(
      source.manifest.tokenDefinitions
    );
    expect(rebuilt.manifest.emittedScales).toEqual(
      source.manifest.emittedScales
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

    expect(
      augmented.manifest.cssFragments?.find(
        (fragment) => fragment.kind === 'base'
      )?.cssText
    ).toContain('--radii-sm: 2px;');
    expect(augmentedRegistrations?.cssText).toBe(sourceRegistrations?.cssText);
  });

  it('a v1-shaped source round-trips with NO fabricated v2 fields', () => {
    const real = buildReferenceFixture();
    const rebuilt = createTheme().from(buildV1Facsimile(real)).build();

    expect(rebuilt.serialize().variableCss).toBe(real.manifest.variableCss);
    // The authored graph behind a v1 manifest is unknowable, so v2 fields are
    // never inferred from resolved values.
    expect(rebuilt.manifest.manifestVersion).toBeUndefined();
    expect(rebuilt.manifest.tokenDefinitions).toBeUndefined();
    expect(rebuilt.manifest.modeAliasDefinitions).toBeUndefined();
    expect(rebuilt.manifest.registrations).toBeUndefined();
    expect(rebuilt.manifest.emitterVersion).toBeUndefined();
    expect(rebuilt.manifest.contractHash).toBeUndefined();
    expect(rebuilt.manifest.cssFragments).toBeUndefined();
  });

  it('suppresses v2 fields on a MUTATED legacy composition chain', () => {
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

/**
 * Pinned emission for the reference fixture: zero-variant themes emit
 * byte-identical CSS, so a diff is a failure rather than a pin to regenerate.
 */
const REFERENCE_FIXTURE_VARIABLE_CSS = `:root {
  --color-bg: var(--color-void);
  --color-bone: #e8e0d0;
  --color-ember: #ff2800;
  --color-gray-300: #666666;
  --color-gray-600: #333333;
  --color-muted: var(--color-gray-300);
  --color-primary: var(--color-ember);
  --color-void: #000000;
  --breakpoint-lg: 1200px;
  --breakpoint-md: 1024px;
  --breakpoint-sm: 768px;
  --breakpoint-xl: 1440px;
  --breakpoint-xs: 480px;
}

[data-color-mode="dark"] {
  --color-bg: #000000;
  --color-muted: #666666;
  --color-primary: #ff2800;
}

[data-color-mode="light"] {
  --color-bg: #e8e0d0;
  --color-muted: #333333;
  --color-primary: #000000;
}`;

const SYSTEM_FIXTURE_VARIABLE_CSS = `@property --current-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }

:root {
  --color-ash: #8a8a8a;
  --color-bg: var(--color-bone);
  --color-bone: #f5f2ea;
  --color-fg: var(--color-ink);
  --color-ink: #101014;
  --color-muted: var(--color-ash);
  --breakpoint-lg: 1200px;
  --breakpoint-sm: 768px;
  color-scheme: light;
}

@media (prefers-color-scheme: light) {
  :root:not([data-color-mode]) {
    --color-bg: #f5f2ea;
    --color-fg: #101014;
    --color-muted: #8a8a8a;
    color-scheme: light;
  }
}

@media (prefers-color-scheme: dark) {
  :root:not([data-color-mode]) {
    --color-bg: #101014;
    --color-fg: #f5f2ea;
    --color-muted: #8a8a8a;
    color-scheme: dark;
  }
}

[data-color-mode="midnight"] {
  --color-bg: #101014;
  --color-fg: #f5f2ea;
  --color-muted: #8a8a8a;
  color-scheme: dark;
}

[data-color-mode="paper"] {
  --color-bg: #f5f2ea;
  --color-fg: #101014;
  --color-muted: #8a8a8a;
  color-scheme: light;
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
    expect(Object.keys(buildSystemRegisteredFixture().serialize())).toEqual([
      'scalesJson',
      'variableMapJson',
      'variableCss',
      'contextualVarsJson',
    ]);
  });
});
