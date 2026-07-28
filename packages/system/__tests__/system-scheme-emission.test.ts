/**
 * Tests for system-scheme emission (openspec change: system-color-scheme,
 * increment 01 — spec `system-scheme-emission`).
 *
 * Requirement headers covered here:
 * - "System preference mapping configuration"
 * - "Guarded system fallback emission"
 * - "Zero-configuration byte parity"
 * - "Browser color-scheme classification"
 *
 * Emission-level scope note: the spec's OS/computed-style scenarios are
 * verified against the emitted CSS artifact (selector guard, block order,
 * declaration identity). No browser harness exists in this workspace
 * (design.md §Guardrail Register, G1), so those scenarios are covered by the
 * static CSS mechanism that produces the behavior, not by a computed-style
 * measurement.
 */
import { describe, expect, it } from 'vitest';

import { createTheme } from '../src';

const breakpoints = { sm: 768, lg: 1200 } as const;

/**
 * Fixtures are FACTORIES, not shared consts, on purpose: `merge` adopts source
 * objects by reference and deep-merges into them in place, so composing a theme
 * mutates the mode-config literal it was built from (see the finding reported
 * with this increment). Sharing one literal across two themes would couple
 * unrelated tests through that mutation.
 */
const makeColors = () =>
  ({
    ink: '#101014',
    bone: '#f5f2ea',
    ash: '#8a8a8a',
  }) as const;

const makeModes = () => ({
  paper: { fg: 'ink', bg: 'bone', muted: 'ash' },
  midnight: { fg: 'bone', bg: 'ink', muted: 'ash' },
});

/** Theme WITHOUT the new options — the byte-parity fixture. */
function buildUnconfiguredTheme() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addColors(makeColors())
    .addColorModes('paper', makeModes())
    .build();
}

/** Theme with systemPreference only. */
function buildSystemTheme() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addColors(makeColors())
    .addColorModes('paper', makeModes(), {
      systemPreference: { light: 'paper', dark: 'midnight' },
    })
    .build();
}

/** Theme with systemPreference + browserColorScheme. */
function buildFullyConfiguredTheme() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addColors(makeColors())
    .addColorModes('paper', makeModes(), {
      systemPreference: { light: 'paper', dark: 'midnight' },
      browserColorScheme: { paper: 'light', midnight: 'dark' },
    })
    .build();
}

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

// ─── Requirement: System preference mapping configuration ────

describe('system preference mapping configuration', () => {
  // Scenario: Valid mapping accepted
  it('records the mapped light and dark mode names on the manifest', () => {
    const theme = buildSystemTheme();
    expect(theme.manifest.systemPreference).toEqual({
      light: 'paper',
      dark: 'midnight',
    });
  });

  // Scenario: Valid mapping accepted (absence half — parity precondition)
  it('omits the manifest fields when no options are supplied', () => {
    const theme = buildUnconfiguredTheme();
    expect(theme.manifest.systemPreference).toBeUndefined();
    expect(theme.manifest.browserColorScheme).toBeUndefined();
  });

  // Scenario: Unknown mode rejected
  it('rejects a mapping naming an undeclared mode, listing available modes', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          systemPreference: {
            light: 'paper',
            // @ts-expect-error — undeclared mode is a type error AND a build error
            dark: 'nocturne',
          },
        })
        .build()
    ).toThrow(/nocturne[\s\S]*Available modes: paper, midnight/);
  });

  // Scenario: Reserved name rejected (declared mode)
  it('rejects a declared mode named system even without options', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('system', { system: { fg: 'ink' } })
        .build()
    ).toThrow(/'system' is a reserved mode name/);
  });

  // Scenario: Reserved name rejected (mapping value)
  it('rejects a mapping value of system', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          systemPreference: {
            light: 'paper',
            // @ts-expect-error — 'system' is never a declared mode name
            dark: 'system',
          },
        })
        .build()
    ).toThrow(/reserved/);
  });

  // Validation rule (packet §Validation rules): both axes required.
  it('rejects a mapping missing the dark axis', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          systemPreference: { light: 'paper' } as {
            light: 'paper';
            dark: 'midnight';
          },
        })
        .build()
    ).toThrow(/systemPreference requires both/);
  });

  // Code-map invariant: new option keys must never become phantom scales.
  it('does not flatten the option objects into token or variable maps', () => {
    const theme = buildFullyConfiguredTheme();
    const tokenKeys = Object.keys(theme.manifest.tokenMap);
    const variableKeys = Object.keys(theme.manifest.variableMap);
    expect(tokenKeys.some((k) => k.startsWith('systemPreference.'))).toBe(
      false
    );
    expect(tokenKeys.some((k) => k.startsWith('browserColorScheme.'))).toBe(
      false
    );
    expect(variableKeys.some((k) => k.startsWith('systemPreference.'))).toBe(
      false
    );
    expect(variableKeys.some((k) => k.startsWith('browserColorScheme.'))).toBe(
      false
    );
  });
});

// ─── Requirement: Guarded system fallback emission ───────────

describe('guarded system fallback emission', () => {
  // GUARDRAIL G2 — every prefers-color-scheme block carries the guard.
  it('emits every prefers-color-scheme block under :root:not([data-color-mode])', () => {
    const css = buildFullyConfiguredTheme().serialize().variableCss;
    const blocks = css.split('@media (prefers-color-scheme:').slice(1);
    expect(blocks.length).toBe(2);
    for (const block of blocks) {
      const selector = block
        .slice(
          block.indexOf('{') + 1,
          block.indexOf('{', block.indexOf('{') + 1)
        )
        .trim();
      expect(selector).toBe(':root:not([data-color-mode])');
    }
  });

  // Scenario: OS preference applies without an attribute
  it('applies the mapped dark mode declarations under the dark media block', () => {
    const css = buildSystemTheme().serialize().variableCss;
    const mediaDark = blockDeclarations(
      css,
      '@media (prefers-color-scheme: dark)'
    );
    // The media block's own declarations live one level deeper; take the inner block.
    const inner = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    const declarations = blockDeclarations(
      inner,
      ':root:not([data-color-mode])'
    );
    expect(mediaDark[0]).toBe(':root:not([data-color-mode]) {');
    expect(declarations).toEqual([
      '--color-fg: #f5f2ea;',
      '--color-bg: #101014;',
      '--color-muted: #8a8a8a;',
    ]);
  });

  // Scenario: OS preference applies without an attribute (light twin) +
  // packet Step 4: media declarations equal the mapped attribute block's.
  //
  // NAMED WITNESS for "Live OS preference change needs no script": the media
  // block carries the mapped mode's COMPLETE declaration set, so a UA re-applies
  // it on an OS flip with nothing scripted. The browser-observed half of that
  // scenario belongs to increment 04 (no browser harness here; design.md G1).
  it('duplicates the mapped modes attribute-block declarations verbatim', () => {
    const css = buildSystemTheme().serialize().variableCss;
    for (const [scheme, modeName] of [
      ['light', 'paper'],
      ['dark', 'midnight'],
    ] as const) {
      const attributeDecls = blockDeclarations(
        css,
        `[data-color-mode="${modeName}"]`
      );
      const mediaSlice = css.slice(
        css.indexOf(`@media (prefers-color-scheme: ${scheme})`)
      );
      const mediaDecls = blockDeclarations(
        mediaSlice,
        ':root:not([data-color-mode])'
      );
      expect(mediaDecls).toEqual(attributeDecls);
    }
  });

  // Scenario: Explicit attribute wins over OS preference
  it('keeps the explicit mode block alongside the guarded media blocks', () => {
    const css = buildSystemTheme().serialize().variableCss;
    expect(css).toContain('[data-color-mode="paper"] {');
    expect(blockDeclarations(css, '[data-color-mode="paper"]')).toEqual([
      '--color-fg: #101014;',
      '--color-bg: #f5f2ea;',
      '--color-muted: #8a8a8a;',
    ]);
    // The guard is the attribute-wins mechanism: the media rule stops matching
    // as soon as any data-color-mode value is present.
    expect(css).toContain(':root:not([data-color-mode])');
  });

  // Scenario: Fallback blocks follow the root block
  it('orders :root, media light, media dark, then attribute blocks', () => {
    const css = buildSystemTheme().serialize().variableCss;
    const rootIdx = css.indexOf(':root {');
    const lightIdx = css.indexOf('@media (prefers-color-scheme: light)');
    const darkIdx = css.indexOf('@media (prefers-color-scheme: dark)');
    const firstAttrIdx = css.indexOf('[data-color-mode=');
    expect(rootIdx).toBeGreaterThanOrEqual(0);
    expect(lightIdx).toBeGreaterThan(rootIdx);
    expect(darkIdx).toBeGreaterThan(lightIdx);
    expect(firstAttrIdx).toBeGreaterThan(darkIdx);
  });

  // G4's structural half for the SYSTEM-CONFIGURED input (theme.test.ts covers
  // the @property/unconfigured input; this is the only assertion of the
  // @scope / anm-theme half anywhere).
  it('emits no @scope or anm-theme wrapper for a system-configured theme', () => {
    const css = buildFullyConfiguredTheme().serialize().variableCss;
    expect(css).not.toContain('@scope');
    expect(css).not.toContain('anm-theme');
  });
});

// ─── Requirement: Zero-configuration byte parity ─────────────

describe('zero-configuration byte parity', () => {
  /**
   * Pinned pre-increment output, captured from the emitter before the system
   * options existed. A diff here is a G4 trip, never a baseline to regenerate.
   */
  const PRE_INCREMENT_VARIABLE_CSS = [
    ':root {',
    '  --color-ink: #101014;',
    '  --color-bone: #f5f2ea;',
    '  --color-ash: #8a8a8a;',
    '  --color-fg: var(--color-ink);',
    '  --color-bg: var(--color-bone);',
    '  --color-muted: var(--color-ash);',
    '  --breakpoint-sm: 768px;',
    '  --breakpoint-lg: 1200px;',
    '}',
    '',
    '[data-color-mode="paper"] {',
    '  --color-fg: #101014;',
    '  --color-bg: #f5f2ea;',
    '  --color-muted: #8a8a8a;',
    '}',
    '',
    '[data-color-mode="midnight"] {',
    '  --color-fg: #f5f2ea;',
    '  --color-bg: #101014;',
    '  --color-muted: #8a8a8a;',
    '}',
  ].join('\n');

  // Scenario: Unconfigured theme output is unchanged
  it('emits byte-identical variable CSS for a theme without the options', () => {
    expect(buildUnconfiguredTheme().serialize().variableCss).toBe(
      PRE_INCREMENT_VARIABLE_CSS
    );
  });

  it('emits no color-scheme or prefers-color-scheme for an unconfigured theme', () => {
    const css = buildUnconfiguredTheme().serialize().variableCss;
    expect(css).not.toContain('color-scheme');
    expect(css).not.toContain('@media');
  });

  it('leaves the manifest of an unconfigured theme structurally unchanged', () => {
    const manifest = buildUnconfiguredTheme().manifest;
    expect(Object.keys(manifest).sort()).toEqual([
      'modes',
      'tokenMap',
      'variableCss',
      'variableMap',
    ]);
  });
});

// ─── Requirement: Browser color-scheme classification ────────

describe('browser color-scheme classification', () => {
  // Scenario: Partial classification rejected — totality is enforced TWICE:
  // at compile time for a literal call site (the @ts-expect-error below fails
  // the build if the type ever goes Partial again) and at runtime for JS
  // callers, casts, and from() composition.
  it('rejects a classification that misses a declared mode', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes(
          'paper',
          {
            paper: { fg: 'ink' },
            midnight: { fg: 'bone' },
            sepia: { fg: 'ash' },
          },
          {
            systemPreference: { light: 'paper', dark: 'midnight' },
            // @ts-expect-error — 'sepia' missing: partial maps are a type error
            browserColorScheme: { paper: 'light', midnight: 'dark' },
          }
        )
        .build()
    ).toThrow(/mode 'sepia' is unclassified/);
  });

  // Scenario: Classification conflicting with the mapping rejected
  it('rejects a classification that contradicts the mapping', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          systemPreference: { light: 'paper', dark: 'midnight' },
          browserColorScheme: { paper: 'dark', midnight: 'dark' },
        })
        .build()
    ).toThrow(/conflicts with systemPreference/);
  });

  it('rejects a classification naming an undeclared mode', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          browserColorScheme: {
            paper: 'light',
            midnight: 'dark',
            // @ts-expect-error — undeclared mode is a type error AND a build error
            nocturne: 'dark',
          },
        })
        .build()
    ).toThrow(/unknown mode 'nocturne'/);
  });

  // Scenario: Native surfaces track the active mode
  it('emits color-scheme on each explicit mode block', () => {
    const css = buildFullyConfiguredTheme().serialize().variableCss;
    expect(blockDeclarations(css, '[data-color-mode="midnight"]')).toContain(
      'color-scheme: dark;'
    );
    expect(blockDeclarations(css, '[data-color-mode="paper"]')).toContain(
      'color-scheme: light;'
    );
  });

  it('emits the initial modes classification on :root', () => {
    const css = buildFullyConfiguredTheme().serialize().variableCss;
    expect(blockDeclarations(css, ':root {')).toContain('color-scheme: light;');
  });

  it('emits the mapped modes classification inside each media block', () => {
    const css = buildFullyConfiguredTheme().serialize().variableCss;
    const lightSlice = css.slice(
      css.indexOf('@media (prefers-color-scheme: light)')
    );
    const darkSlice = css.slice(
      css.indexOf('@media (prefers-color-scheme: dark)')
    );
    expect(
      blockDeclarations(lightSlice, ':root:not([data-color-mode])')
    ).toContain('color-scheme: light;');
    expect(
      blockDeclarations(darkSlice, ':root:not([data-color-mode])')
    ).toContain('color-scheme: dark;');
  });

  it('records the classification on the manifest', () => {
    expect(buildFullyConfiguredTheme().manifest.browserColorScheme).toEqual({
      paper: 'light',
      midnight: 'dark',
    });
  });

  // ── Classification WITHOUT a system preference (a legal shape) ──

  function buildClassificationOnlyTheme() {
    return createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('paper', makeModes(), {
        browserColorScheme: { paper: 'light', midnight: 'dark' },
      })
      .build();
  }

  it('builds with a classification and no system preference', () => {
    const theme = buildClassificationOnlyTheme();
    expect(theme.manifest.browserColorScheme).toEqual({
      paper: 'light',
      midnight: 'dark',
    });
    expect(theme.manifest.systemPreference).toBeUndefined();
  });

  it('carries color-scheme on :root and every mode block without a mapping', () => {
    const css = buildClassificationOnlyTheme().serialize().variableCss;
    expect(blockDeclarations(css, ':root {')).toContain('color-scheme: light;');
    expect(blockDeclarations(css, '[data-color-mode="paper"]')).toContain(
      'color-scheme: light;'
    );
    expect(blockDeclarations(css, '[data-color-mode="midnight"]')).toContain(
      'color-scheme: dark;'
    );
  });

  it('emits no media blocks when only a classification is supplied', () => {
    const css = buildClassificationOnlyTheme().serialize().variableCss;
    expect(css).not.toContain('@media');
    expect(css).not.toContain(':root:not([data-color-mode])');
  });
});

// ─── Behavior pins (F4/F5 — current behavior, documented) ────

describe('emission behavior pins', () => {
  const makeWithEmptyMode = () => ({
    paper: { fg: 'ink', bg: 'bone' },
    blank: {},
  });

  // F4a: a mapped mode with no alias declarations and nothing else to say
  // produces NO media block (an empty rule would be pure noise).
  it('omits the media block for a mapped mode with no declarations and no classification', () => {
    const css = createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('paper', makeWithEmptyMode(), {
        systemPreference: { light: 'paper', dark: 'blank' },
      })
      .build()
      .serialize().variableCss;

    expect(css).toContain('@media (prefers-color-scheme: light)');
    expect(css).not.toContain('@media (prefers-color-scheme: dark)');
  });

  // F4b: the same mode DOES get a block once it has content to carry.
  it('emits a color-scheme-only media block for an empty mapped mode that is classified', () => {
    const css = createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('paper', makeWithEmptyMode(), {
        systemPreference: { light: 'paper', dark: 'blank' },
        browserColorScheme: { paper: 'light', blank: 'dark' },
      })
      .build()
      .serialize().variableCss;

    const darkSlice = css.slice(
      css.indexOf('@media (prefers-color-scheme: dark)')
    );
    expect(
      blockDeclarations(darkSlice, ':root:not([data-color-mode])')
    ).toEqual(['color-scheme: dark;']);
  });

  // F5: mapping both OS preferences to ONE mode is accepted and emits two
  // identical guarded blocks (a theme that opts out of OS differentiation).
  it('accepts the same mode on both axes and emits two identical blocks', () => {
    const css = createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('paper', makeModes(), {
        systemPreference: { light: 'paper', dark: 'paper' },
      })
      .build()
      .serialize().variableCss;

    const lightSlice = css.slice(
      css.indexOf('@media (prefers-color-scheme: light)')
    );
    const darkSlice = css.slice(
      css.indexOf('@media (prefers-color-scheme: dark)')
    );
    const lightDecls = blockDeclarations(
      lightSlice,
      ':root:not([data-color-mode])'
    );
    expect(
      blockDeclarations(darkSlice, ':root:not([data-color-mode])')
    ).toEqual(lightDecls);
    expect(lightDecls).toEqual(
      blockDeclarations(css, '[data-color-mode="paper"]')
    );
  });
});

// ─── Merged-state validation (F1/F2) ─────────────────────────

describe('merged-state option validation', () => {
  function buildBase() {
    return createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('paper', makeModes(), {
        systemPreference: { light: 'paper', dark: 'midnight' },
        browserColorScheme: { paper: 'light', midnight: 'dark' },
      })
      .build();
  }

  // F1 reproduction (a): composing a NEW mode onto a system-enabled theme
  // un-totals the carried classification — must be rejected, not silently
  // emitted with a classification-less mode and a color-scheme-less :root.
  it('rejects a composed mode that the carried classification does not cover', () => {
    expect(() =>
      createTheme()
        .from(buildBase())
        .addColorModes('sepia', { sepia: { fg: 'ash', bg: 'bone' } })
        .build()
    ).toThrow(/mode 'sepia' is unclassified/);
  });

  it('accepts the same composition once the new mode is classified', () => {
    const composed = createTheme()
      .from(buildBase())
      .addColorModes(
        'sepia',
        { sepia: { fg: 'ash', bg: 'bone' } },
        { browserColorScheme: { sepia: 'normal' } }
      )
      .build();

    expect(composed.manifest.browserColorScheme).toEqual({
      paper: 'light',
      midnight: 'dark',
      sepia: 'normal',
    });
    expect(
      blockDeclarations(
        composed.serialize().variableCss,
        '[data-color-mode="sepia"]'
      )
    ).toContain('color-scheme: normal;');
  });

  /**
   * The option TYPE is local to one `addColorModes` call (D1 — mode names are
   * deliberately not threaded through the builder chain), so a mapping that
   * targets modes declared by an EARLIER call needs one widening cast. Runtime
   * validation is merged-authoritative; this is the single documented widening
   * point rather than a scattering of `as` casts.
   */
  function crossCallOptions<T>(options: {
    systemPreference?: { light: string; dark: string };
    browserColorScheme?: Record<string, 'light' | 'dark' | 'normal'>;
  }): T {
    return options as unknown as T;
  }

  // F2 reproduction (b): a mapping naming a mode declared by an EARLIER call
  // is legal — the availability set is the merged mode union, not this call's.
  it('accepts a mapping naming a mode declared by an earlier call', () => {
    const composed = createTheme()
      .from(buildBase())
      .addColorModes(
        'paper',
        { sepia: { fg: 'ash', bg: 'bone' } },
        crossCallOptions({
          systemPreference: { light: 'paper', dark: 'midnight' },
          browserColorScheme: { sepia: 'normal' },
        })
      )
      .build();

    expect(composed.manifest.systemPreference).toEqual({
      light: 'paper',
      dark: 'midnight',
    });
    expect(composed.serialize().variableCss).toContain(
      '@media (prefers-color-scheme: dark)'
    );
  });

  // build() is the AUTHORITATIVE gate: this composition never calls
  // addColorModes, so nothing but build() can see that merging a second theme's
  // modes un-totalled the first theme's classification.
  it('rejects an un-totalled classification introduced by pure from() composition', () => {
    const plainSepiaTheme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('sepia', { sepia: { fg: 'ash', bg: 'bone' } })
      .build();

    expect(() =>
      createTheme().from(buildBase()).from(plainSepiaTheme).build()
    ).toThrow(/mode 'sepia' is unclassified/);
  });
});

// ─── Reserved theme keys (F3) ────────────────────────────────

describe('reserved theme keys', () => {
  it('rejects a scale named systemPreference', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({
          name: 'systemPreference',
          emit: true,
          values: { a: '1px' },
        })
    ).toThrow(/'systemPreference' is a reserved theme key/);
  });

  it('rejects a scale named browserColorScheme', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({ name: 'browserColorScheme', values: { a: '1px' } })
    ).toThrow(/'browserColorScheme' is a reserved theme key/);
  });
});

// ─── D7: serialization wire is frozen ────────────────────────

describe('serialize() wire lock (D7 / guardrail G5)', () => {
  it('returns exactly the four legacy keys for a system-enabled theme', () => {
    expect(Object.keys(buildFullyConfiguredTheme().serialize())).toEqual([
      'scalesJson',
      'variableMapJson',
      'variableCss',
      'contextualVarsJson',
    ]);
  });

  it('returns exactly the four legacy keys for an unconfigured theme', () => {
    expect(Object.keys(buildUnconfiguredTheme().serialize())).toEqual([
      'scalesJson',
      'variableMapJson',
      'variableCss',
      'contextualVarsJson',
    ]);
  });
});

// ─── D8: from() carries the fields and round-trips ───────────

describe('from() round-trip (D8)', () => {
  it('reproduces identical variableCss and manifest fields on an unaugmented rebuild', () => {
    const source = buildFullyConfiguredTheme();
    const rebuilt = createTheme().from(source).build();

    expect(rebuilt.serialize().variableCss).toBe(
      source.serialize().variableCss
    );
    expect(rebuilt.manifest.systemPreference).toEqual(
      source.manifest.systemPreference
    );
    expect(rebuilt.manifest.browserColorScheme).toEqual(
      source.manifest.browserColorScheme
    );
  });

  it('keeps the fields absent when the source theme never configured them', () => {
    const rebuilt = createTheme().from(buildUnconfiguredTheme()).build();
    expect(rebuilt.manifest.systemPreference).toBeUndefined();
    expect(rebuilt.manifest.browserColorScheme).toBeUndefined();
  });
});
