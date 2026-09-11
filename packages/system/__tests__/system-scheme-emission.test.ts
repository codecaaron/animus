import { describe, expect, it } from 'vitest';

import { createTheme } from '../src';

const breakpoints = { sm: 768, lg: 1200 } as const;

/**
 * Factories, not shared consts: `merge` deep-merges into its source objects
 * in place, so one shared literal would couple unrelated tests.
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

function buildUnconfiguredTheme() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addColors(makeColors())
    .addColorModes('paper', makeModes())
    .build();
}

function buildSystemTheme() {
  return createTheme()
    .addBreakpoints(breakpoints)
    .addColors(makeColors())
    .addColorModes('paper', makeModes(), {
      systemPreference: { light: 'paper', dark: 'midnight' },
    })
    .build();
}

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

describe('system preference mapping configuration', () => {
  it('records the mapped light and dark mode names on the manifest', () => {
    const theme = buildSystemTheme();
    expect(theme.manifest.systemPreference).toEqual({
      light: 'paper',
      dark: 'midnight',
    });
  });

  it('omits the manifest fields when no options are supplied', () => {
    const theme = buildUnconfiguredTheme();
    expect(theme.manifest.systemPreference).toBeUndefined();
    expect(theme.manifest.browserColorScheme).toBeUndefined();
  });

  it('rejects a mapping naming an undeclared mode, listing available modes', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          systemPreference: {
            light: 'paper',
            // @ts-expect-error — an undeclared mode is also a build error
            dark: 'nocturne',
          },
        })
        .build()
    ).toThrow(/nocturne[\s\S]*Available modes: paper, midnight/);
  });

  it('rejects a declared mode named system even without options', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('system', { system: { fg: 'ink' } })
        .build()
    ).toThrow(/'system' is a reserved mode name/);
  });

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

  it('rejects a mapping missing the dark axis', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          // @ts-expect-error — the option type forbids the missing dark axis;
          // build() owns the runtime rejection this test pins.
          systemPreference: { light: 'paper' },
        })
        .build()
    ).toThrow(/systemPreference requires both/);
  });

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

describe('guarded system fallback emission', () => {
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

  it('applies the mapped dark mode declarations under the dark media block', () => {
    const css = buildSystemTheme().serialize().variableCss;
    const mediaDark = blockDeclarations(
      css,
      '@media (prefers-color-scheme: dark)'
    );
    const inner = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    const declarations = blockDeclarations(
      inner,
      ':root:not([data-color-mode])'
    );
    expect(mediaDark[0]).toBe(':root:not([data-color-mode]) {');
    expect(declarations).toEqual([
      '--color-bg: #101014;',
      '--color-fg: #f5f2ea;',
      '--color-muted: #8a8a8a;',
    ]);
  });

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

  it('keeps the explicit mode block alongside the guarded media blocks', () => {
    const css = buildSystemTheme().serialize().variableCss;
    expect(css).toContain('[data-color-mode="paper"] {');
    expect(blockDeclarations(css, '[data-color-mode="paper"]')).toEqual([
      '--color-bg: #f5f2ea;',
      '--color-fg: #101014;',
      '--color-muted: #8a8a8a;',
    ]);
    // The guard is the attribute-wins mechanism: the media rule stops matching
    // as soon as any data-color-mode value is present.
    expect(css).toContain(':root:not([data-color-mode])');
  });

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

  it('emits no @scope or anm-theme wrapper for a system-configured theme', () => {
    const css = buildFullyConfiguredTheme().serialize().variableCss;
    expect(css).not.toContain('@scope');
    expect(css).not.toContain('anm-theme');
  });
});

describe('zero-configuration byte parity', () => {
  /**
   * Pinned output for a theme that never opts in: the system options must add
   * zero bytes here, so a diff is a failure rather than a pin to regenerate.
   */
  const PRE_INCREMENT_VARIABLE_CSS = [
    ':root {',
    '  --color-ash: #8a8a8a;',
    '  --color-bg: var(--color-bone);',
    '  --color-bone: #f5f2ea;',
    '  --color-fg: var(--color-ink);',
    '  --color-ink: #101014;',
    '  --color-muted: var(--color-ash);',
    '  --breakpoint-lg: 1200px;',
    '  --breakpoint-sm: 768px;',
    '}',
    '',
    '[data-color-mode="midnight"] {',
    '  --color-bg: #101014;',
    '  --color-fg: #f5f2ea;',
    '  --color-muted: #8a8a8a;',
    '}',
    '',
    '[data-color-mode="paper"] {',
    '  --color-bg: #f5f2ea;',
    '  --color-fg: #101014;',
    '  --color-muted: #8a8a8a;',
    '}',
  ].join('\n');

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

  it('leaves the manifest of an unconfigured theme free of option-derived keys', () => {
    const manifest = buildUnconfiguredTheme().manifest;
    expect(Object.keys(manifest).sort()).toEqual([
      'contractHash',
      'cssFragments',
      'emittedScales',
      'emitterVersion',
      'manifestVersion',
      'modeAliasDefinitions',
      'modes',
      'registrations',
      'tokenDefinitions',
      'tokenMap',
      'variableCss',
      'variableMap',
    ]);
  });
});

describe('browser color-scheme classification', () => {
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
            browserColorScheme: { paper: 'light', midnight: 'dark' },
          }
        )
        .build()
    ).toThrow(/mode 'sepia' is unclassified/);
  });

  it('defaults the mapped modes classifications when omitted', () => {
    const theme = createTheme()
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
          browserColorScheme: { sepia: 'normal' },
        }
      )
      .build();
    expect(theme.manifest.browserColorScheme).toEqual({
      paper: 'light',
      midnight: 'dark',
      sepia: 'normal',
    });
  });

  it('accepts an empty classification as the whole opt-in for a two-mode theme', () => {
    const theme = createTheme()
      .addBreakpoints(breakpoints)
      .addColors(makeColors())
      .addColorModes('paper', makeModes(), {
        systemPreference: { light: 'paper', dark: 'midnight' },
        browserColorScheme: {},
      })
      .build();
    expect(theme.manifest.browserColorScheme).toEqual({
      paper: 'light',
      midnight: 'dark',
    });
    const css = theme.serialize().variableCss;
    expect(blockDeclarations(css, ':root {')).toContain('color-scheme: light;');
    expect(blockDeclarations(css, '[data-color-mode="midnight"]')).toContain(
      'color-scheme: dark;'
    );
  });

  it('still requires totality when no mapping fixes any mode', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          browserColorScheme: { paper: 'light' },
        })
        .build()
    ).toThrow(/mode 'midnight' is unclassified/);
  });

  it('an explicit entry on a mapped mode is honored, not silently corrected', () => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addColors(makeColors())
        .addColorModes('paper', makeModes(), {
          systemPreference: { light: 'paper', dark: 'midnight' },
          browserColorScheme: { paper: 'dark' },
        })
        .build()
    ).toThrow(/conflicts with systemPreference/);
  });

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
            // @ts-expect-error — an undeclared mode is also a build error
            nocturne: 'dark',
          },
        })
        .build()
    ).toThrow(/unknown mode 'nocturne'/);
  });

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

describe('emission behavior pins', () => {
  const makeWithEmptyMode = () => ({
    paper: { fg: 'ink', bg: 'bone' },
    blank: {},
  });

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

  it('accepts a mapping naming a mode declared by an earlier call', () => {
    const composed = createTheme()
      .from(buildBase())
      .addColorModes(
        'paper',
        { sepia: { fg: 'ash', bg: 'bone' } },
        {
          // @ts-expect-error — the option type is local to one addColorModes
          // call; runtime validation is merged-authoritative.
          systemPreference: { light: 'paper', dark: 'midnight' },
          browserColorScheme: { sepia: 'normal' },
        }
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

describe('reserved theme keys', () => {
  it.each([
    'breakpoints',
    'modes',
    'mode',
    'systemPreference',
    'browserColorScheme',
    'modeBases',
    '__emitted',
    'manifest',
    'serialize',
    'varRef',
  ])('rejects a scale named %s at runtime', (reservedName) => {
    expect(() =>
      createTheme()
        .addBreakpoints(breakpoints)
        .addScale({ name: reservedName, values: { a: '1px' } })
    ).toThrow(`'${reservedName}' is a reserved theme key`);
  });
});

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
