import { createSystem, createTheme } from '@animus-ui/system';
import { color, layout, transitions } from '@animus-ui/system/groups';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
import {
  PROPERTY_FALLBACK_CHAIN_SUPPRESSED,
  PROPERTY_FALLBACK_SELF_REFERENCE,
  PROPERTY_FALLBACK_SUPPRESSED,
  PROPERTY_SELF_REFERENCE,
  PROPERTY_UNREGISTERED_ANIMATION,
} from '../pipeline/manifest-diagnostics';
import { checkCustomProperties } from '../pipeline/property-diagnostics';
import { runProjectAnalysis } from '../pipeline/run-analysis';
import { loadSystemConfig } from '../pipeline/system-config';

import type { V2ExtractEngine } from '../pipeline/engine-adapter';

const NATIVE = join(__dirname, '../index-v2.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeApi(): any {
  let engine: V2ExtractEngine | null = null;
  let sentSources: Map<string, string> | null = null;
  let driftWarned = false;
  return createV2EngineApi({
    label: 'property-diagnostics-test',
    isV2: () => true,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadNativeEngine: () => require(NATIVE),
    store: {
      getEngine: () => engine,
      setEngine: (next) => {
        engine = next;
      },
      getSentSources: () => sentSources,
      setSentSources: (sources) => {
        sentSources = sources;
      },
      getDriftWarned: () => driftWarned,
      setDriftWarned: (value) => {
        driftWarned = value;
      },
    },
  })();
}

/** `tone` registers a typed initial value, `accent` registers as universal,
 *  and `lift`, `cap` and `spare` are declared without a registration. */
function registeredTheme() {
  return createTheme()
    .addBreakpoints({ sm: 768 })
    .addColors({ red: '#f00', blue: '#00f' })
    .addScale({ name: 'sizes', values: { dialog: '40rem' } })
    .declareContextualVars(
      { colors: ['tone', 'accent', 'spare'], sizes: ['lift', 'cap'] },
      {
        tone: {
          syntax: '<color>',
          inherits: true,
          initialValue: 'transparent',
        },
        accent: { syntax: '*', inherits: true },
      }
    )
    .build();
}

function unregisteredTheme() {
  return createTheme()
    .addBreakpoints({ sm: 768 })
    .addColors({ red: '#f00', blue: '#00f' })
    .addScale({ name: 'sizes', values: { dialog: '40rem' } })
    .declareContextualVars({
      colors: ['tone', 'accent', 'spare'],
      sizes: ['lift', 'cap'],
    })
    .build();
}

/** The unregistered theme plus one registration nothing else uses. */
function unrelatedRegistrationTheme() {
  return createTheme()
    .addBreakpoints({ sm: 768 })
    .addColors({ red: '#f00', blue: '#00f' })
    .addScale({ name: 'sizes', values: { dialog: '40rem' } })
    .declareContextualVars(
      {
        colors: ['tone', 'accent', 'spare'],
        sizes: ['lift', 'cap', 'unrelated'],
      },
      { unrelated: { syntax: '<length>', inherits: true, initialValue: '0px' } }
    )
    .build();
}

const ds = createSystem()
  .addGroup('surface', color)
  .addGroup('box', layout)
  .addGroup('motion', transitions)
  .build()
  .seal();

const KEYFRAMES = JSON.stringify({
  motion: {
    pulse: {
      name: 'animus-kf-pulse',
      frames: {
        from: { '--tone': 'red', '--accent': 'red' },
        to: { '--tone': 'blue', '--accent': 'blue', '--undeclared': 'blue' },
      },
    },
  },
});

interface Analysis {
  componentCss: string;
  globalCss: string;
  warned: string[];
  informed: string[];
}

function analyze(
  source: string,
  theme = registeredTheme(),
  options: { strict?: boolean; keyframes?: string | null } = {}
): Analysis {
  const serialized = theme.serialize();
  const config = ds.toConfig();
  const system = loadSystemConfig(
    () => ({
      loadSystemModule: () => ({
        ...serialized,
        propConfig: config.propConfig,
        groupRegistry: config.groupRegistry,
        keyframesBlocks: options.keyframes ?? null,
      }),
    }),
    { systemPath: 'ds.ts', rootDir: '/' }
  );
  const api = makeApi();
  api.clearAnalysisCache();
  const warned: string[] = [];
  const informed: string[] = [];
  const result = runProjectAnalysis(() => api, {
    fileEntries: [{ path: 'src/app.tsx', source }],
    packageMap: {},
    system,
    emitter: { runtimeImport: 'runtime', cssModuleId: 'styles.css' },
    pathAliasesJson: null,
    devMode: false,
    warn: (message) => warned.push(message),
    info: (message) => informed.push(message),
    strict: options.strict,
  });
  return {
    componentCss: result.componentCss,
    globalCss: result.globalCss,
    warned,
    informed,
  };
}

const codesIn = (lines: string[]) =>
  lines.flatMap((line) => line.match(/animus\.property\.[\w-]+/g) ?? []);

describe('suppressed var() fallbacks', () => {
  const READER = `import { ds } from './ds';
export const Reader = ds
  .styles({
    '--fill': 'var(--tone, red)',
    '--edge': 'var(--tone, var(--accent, blue))',
    '--loose': 'var(--accent, blue)',
  })
  .asElement('div');
export const App = () => <Reader />;
`;

  it('reports a fallback an initial value suppresses, and warns when it heads a chain', () => {
    const { informed, warned } = analyze(READER);
    expect(codesIn(informed)).toEqual([PROPERTY_FALLBACK_SUPPRESSED]);
    expect(codesIn(warned)).toEqual([PROPERTY_FALLBACK_CHAIN_SUPPRESSED]);
    expect(informed[0]).toMatch(/^ℹ src\/app\.tsx: Reader: var\(--tone, red\)/);
  });

  it('never checks the fallback against the syntax', () => {
    const { informed, warned } = analyze(`import { ds } from './ds';
export const Odd = ds.styles({ '--fill': 'var(--tone, 12px)' }).asElement('div');
export const App = () => <Odd />;
`);
    expect(codesIn(informed)).toEqual([PROPERTY_FALLBACK_SUPPRESSED]);
    expect(codesIn(warned)).toEqual([]);
  });
});

describe('animated properties without an interpolating registration', () => {
  const MOVER = `import { ds } from './ds';
export const Mover = ds
  .styles({ transition: '--lift 1s, --tone 1s, --other 1s' })
  .asElement('div');
export const Flip = ds
  .styles({ transition: '--accent 1s allow-discrete' })
  .asElement('div');
export const Behaved = ds
  .styles({ transitionProperty: '--spare', transitionBehavior: 'allow-discrete' })
  .asElement('div');
export const Speedy = ds
  .styles({ transition: 'background-color var(--lift) ease' })
  .asElement('div');
export const App = () => <><Mover /><Flip /><Behaved /><Speedy /></>;
`;

  it('reports declared properties set in keyframes or transitioned without a typed registration', () => {
    const { informed, warned } = analyze(MOVER, registeredTheme(), {
      keyframes: KEYFRAMES,
    });
    expect(codesIn(informed).sort()).toEqual([
      PROPERTY_UNREGISTERED_ANIMATION,
      PROPERTY_UNREGISTERED_ANIMATION,
    ]);
    expect(informed.join('\n')).toContain('--accent');
    expect(informed.join('\n')).toContain('--lift');
    expect(informed.join('\n')).not.toContain('--tone');
    expect(informed.join('\n')).not.toContain('--undeclared');
    expect([...informed, ...warned].join('\n')).not.toContain('Speedy');
    // `allow-discrete` states that a discrete step is intended.
    expect(codesIn(warned)).toEqual([]);
    expect(informed.join('\n')).not.toContain('--spare');
    expect(informed.join('\n')).not.toContain('Flip');
  });
});

describe('self-referencing custom properties', () => {
  const SELF = `import { ds } from './ds';
export const Self = ds
  .props({ toneProp: { property: '--tone', scale: 'colors' } })
  .asElement('div');
export const App = () => <Self toneProp="tone" />;
`;

  it('warns and keeps the declaration', () => {
    const { componentCss, warned } = analyze(SELF);
    expect(codesIn(warned)).toEqual([PROPERTY_SELF_REFERENCE]);
    expect(warned[0]).toContain('Self');
    expect(componentCss).toMatch(/--tone:\s*var\(--tone\)/);
  });

  it('does not fail a strict build', () => {
    expect(() =>
      analyze(SELF, registeredTheme(), { strict: true })
    ).not.toThrow();
  });

  it('is reported without any registration', () => {
    const { componentCss, warned } = analyze(SELF, unregisteredTheme());
    expect(codesIn(warned)).toEqual([PROPERTY_SELF_REFERENCE]);
    expect(componentCss).toMatch(/--tone:\s*var\(--tone\)/);
  });
});

describe('projects the checks leave alone', () => {
  const CAP = `import { ds } from './ds';
export const Scroller = ds
  .styles({
    maxHeight: 'var(--lift, var(--cap, none))',
    '& > *': { '--lift': 'initial' },
  })
  .states({ allRows: { '--lift': 'none' } })
  .props({ cap: { property: '--cap', scale: 'sizes', strict: false } })
  .asElement('div');
export const App = () => <Scroller cap="24rem" allRows />;
`;

  it('the unregistered lift and cap pattern reports nothing', () => {
    const { informed, warned } = analyze(CAP);
    expect(codesIn([...informed, ...warned])).toEqual([]);
  });

  it('a project without registrations reports the same animations as with an unrelated one, and keeps its CSS', () => {
    const source = `import { ds } from './ds';
export const Plain = ds
  .styles({ '--fill': 'var(--tone, red)', transition: '--lift 1s' })
  .asElement('div');
export const App = () => <Plain />;
`;
    const reported = (unrelatedRegistration: boolean) => {
      const { componentCss, globalCss, informed, warned } = analyze(
        source,
        unrelatedRegistration
          ? unrelatedRegistrationTheme()
          : unregisteredTheme(),
        { keyframes: KEYFRAMES }
      );
      expect(componentCss).toContain('--fill: var(--tone, red)');
      expect(globalCss).toContain('--accent: red');
      expect(codesIn(warned)).toEqual([]);
      return informed
        .map((line) => line.match(/--[\w-]+ is [^,]*/)?.[0])
        .sort();
    };
    expect(reported(false)).toEqual([
      '--accent is set in @keyframes animus-kf-pulse but it is not registered',
      '--lift is transitioned but it is not registered',
      '--tone is set in @keyframes animus-kf-pulse but it is not registered',
    ]);
    expect(reported(true)).toEqual(reported(false));
  });
});

describe('owner lookup', () => {
  it('reads no component when nothing is found', () => {
    let reads = 0;
    const component = {
      file: 'src/a.tsx',
      binding: 'A',
      extends_from: null,
      terminal: 'asElement',
      tag: 'div',
      system_prop_names: [],
      get class_name() {
        reads += 1;
        return 'animus-A';
      },
      get replacement() {
        reads += 1;
        return '';
      },
    };
    const system = {
      variableCss: '@property --x { syntax: "*"; inherits: true; }',
      contextualVarsJson: null,
      contextualProperties: [],
    };
    const diagnostics = checkCustomProperties({
      system,
      manifest: { components: { 'src/a.tsx::A': component } },
      componentCss: '.animus-A {\n  color: red;\n  --y: var(--x);\n}\n',
      globalCss: '',
    });
    expect(diagnostics).toEqual([]);
    expect(reads).toBe(0);
  });
});

describe('checks on emitted CSS alone', () => {
  // Both the theme's contextual names and their custom-property form, as the
  // system config carries them.
  const unregistered = {
    variableCss: '',
    contextualVarsJson: null,
    contextualProperties: [],
  };
  const registeredAnimation = {
    variableCss: '@property --x { syntax: "*"; inherits: true; }',
    contextualVarsJson: '{"colors":["a","b"]}',
    contextualProperties: ['--a', '--b'],
  };

  it('reports a self-reference in any spacing without registrations', () => {
    const diagnostics = checkCustomProperties({
      system: unregistered,
      manifest: { components: {} },
      componentCss: [
        '.x {\n  --a :var( --a ) ;\n}',
        // A comment before the declaration separates nothing.
        '.c { /* note; { } */ --a: var(--a); }',
        // Reads only inside another var()'s fallback: authored, beside a
        // property reading the same value, and escaped.
        '.authored { --a: var(--b, var(--a)); }',
        '.slot { width: var(--b, var(--a)); --a: var(--b, var(--a)); }',
        String.raw`.escaped { --\61: var(--b, VAR(--a)); }`,
        // A direct read, inside math or beside its own fallback, is a
        // self-reference like the bare var(); a read of another name is
        // neither.
        '.direct { --a: calc(var(--a) + 1px); --c: var(--b, var(--a)); }',
      ].join('\n'),
      globalCss: '',
    });
    expect(diagnostics.map((d) => [d.code, d.component])).toEqual([
      [PROPERTY_SELF_REFERENCE, '.x'],
      [PROPERTY_SELF_REFERENCE, '.c'],
      [PROPERTY_FALLBACK_SELF_REFERENCE, '.authored'],
      [PROPERTY_FALLBACK_SELF_REFERENCE, '.slot'],
      [PROPERTY_FALLBACK_SELF_REFERENCE, '.escaped'],
      [PROPERTY_SELF_REFERENCE, '.direct'],
    ]);
    expect(diagnostics[2].message).toContain(
      'Wherever that fallback is used, --a refers to itself, a cycle in every browser'
    );
  });

  it('reads a manifest without components', () => {
    const manifest: Parameters<typeof checkCustomProperties>[0]['manifest'] =
      JSON.parse('{}');
    const diagnostics = checkCustomProperties({
      system: unregistered,
      manifest,
      componentCss: '.x {\n  --a: var(--a);\n}\n',
      globalCss: '',
    });
    expect(diagnostics.map((d) => d.code)).toEqual([PROPERTY_SELF_REFERENCE]);
  });

  it('reads names as CSS tokenizes them: escapes, function case, comments and quoted text', () => {
    const diagnostics = checkCustomProperties({
      system: {
        variableCss:
          '@property --x { syntax: "<length>"; inherits: true; initial-value: 0px; }',
        contextualProperties: ['--a', '--x'],
      },
      manifest: { components: {} },
      componentCss: [
        String.raw`.s { --\61: VAR( /* c */ --a ); }`,
        '.q { content: "var(--x, 1px)"; width: var(--x, 2px); }',
        // An escape's hex digits take one following space, so the name ends here.
        String.raw`.t { transition: 1s --\61; }`,
        String.raw`.n { --b: var(--a\62); transition: --a\62 1s, --ab 1s; }`,
      ].join('\n'),
      globalCss: '',
    });
    expect(diagnostics.map((d) => [d.code, d.component])).toEqual([
      [PROPERTY_SELF_REFERENCE, '.s'],
      [PROPERTY_FALLBACK_SUPPRESSED, '.q'],
      [PROPERTY_UNREGISTERED_ANIMATION, '.t'],
    ]);
  });

  it('finds a transitioned property after a comment or a duration', () => {
    const diagnostics = checkCustomProperties({
      system: registeredAnimation,
      manifest: { components: {} },
      componentCss:
        '.t {\n  transition: /* x */ --a 0.2s;\n}\n.u {\n  transition: 1s --b, opacity 1s;\n}\n.v {\n  transition: opacity var( --b ) ease;\n}\n',
      globalCss: '',
    });
    expect(diagnostics.map((d) => d.code)).toEqual([
      PROPERTY_UNREGISTERED_ANIMATION,
      PROPERTY_UNREGISTERED_ANIMATION,
    ]);
    expect(diagnostics.map((d) => d.message).join('\n')).toMatch(
      /--a[\s\S]*--b|--b[\s\S]*--a/
    );
  });
});
