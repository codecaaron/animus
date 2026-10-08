import { createSystem, createTheme } from '@animus-ui/system';
import { color, layout, transitions } from '@animus-ui/system/groups';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
import {
  PROPERTY_DISCRETE_ANIMATION,
  PROPERTY_FALLBACK_CHAIN_SUPPRESSED,
  PROPERTY_FALLBACK_SUPPRESSED,
  PROPERTY_SELF_REFERENCE,
  PROPERTY_UNREGISTERED_ANIMATION,
} from '../pipeline/manifest-diagnostics';
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
export const App = () => <><Mover /><Flip /><Behaved /></>;
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
    expect(codesIn(warned)).toEqual([
      PROPERTY_DISCRETE_ANIMATION,
      PROPERTY_DISCRETE_ANIMATION,
    ]);
    expect(warned.join('\n')).toContain('--accent');
    expect(warned.join('\n')).toContain('--spare');
  });
});

describe('self-referencing custom properties', () => {
  const SELF = `import { ds } from './ds';
export const Self = ds
  .props({ toneProp: { property: '--tone', scale: 'colors' } })
  .asElement('div');
export const App = () => <Self toneProp="tone" />;
`;

  it('is an error and the declaration is not emitted', () => {
    const { componentCss, warned } = analyze(SELF);
    expect(codesIn(warned)).toEqual([PROPERTY_SELF_REFERENCE]);
    expect(warned[0]).toContain('Self');
    expect(componentCss).not.toMatch(/--tone:\s*var\(--tone\)/);
  });

  it('fails a strict build', () => {
    expect(() => analyze(SELF, registeredTheme(), { strict: true })).toThrow(
      PROPERTY_SELF_REFERENCE
    );
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

  it('a project without registrations reports nothing and keeps its CSS', () => {
    const source = `import { ds } from './ds';
export const Self = ds
  .props({ toneProp: { property: '--tone', scale: 'colors' } })
  .styles({ '--fill': 'var(--tone, red)', transition: '--lift 1s' })
  .asElement('div');
export const App = () => <Self toneProp="tone" />;
`;
    const { componentCss, globalCss, informed, warned } = analyze(
      source,
      unregisteredTheme(),
      { keyframes: KEYFRAMES }
    );
    expect(codesIn([...informed, ...warned])).toEqual([]);
    expect(componentCss).toMatch(/--tone:\s*var\(--tone\)/);
    expect(globalCss).toContain('--accent: red');
  });
});
