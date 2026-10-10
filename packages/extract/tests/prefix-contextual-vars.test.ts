import { createSystem, createTheme } from '@animus-ui/system';
import { color, layout, transitions } from '@animus-ui/system/groups';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
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
    label: 'prefix-contextual-vars-test',
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

const theme = createTheme()
  .addBreakpoints({ sm: 768 })
  .addColors({ red: '#f00', blue: '#00f' })
  .addScale({ name: 'sizes', values: { dialog: '40rem' } })
  .declareContextualVars(
    { colors: ['tone'], sizes: ['cap'] },
    {
      tone: { syntax: '<color>', inherits: true, initialValue: 'transparent' },
    }
  )
  .build();

const ds = createSystem()
  .addGroup('surface', color)
  .addGroup('box', layout)
  .addGroup('motion', transitions)
  .build()
  .seal();

const SOURCE = `import { ds } from './ds';
export const Card = ds
  .styles({
    bg: 'tone',
    caretColor: 'tone',
    '--tone': 'red',
    '--edge': 'var(--tone, var(--cap, 1px))',
    '--other': 'var(--other, 2px)',
    transition: '--tone 1s',
    '@container style(--tone: dark)': { '--cap': '2px' },
  })
  .props({ capSize: { property: '--cap', scale: 'sizes', strict: false } })
  .asElement('div');
export const Alias = ds.styles({ bg: 'acme-tone' }).asElement('div');
export const Miss = ds.styles({ bg: 'nope' }).asElement('div');
export const App = ({ size }) => (
  <>
    <Card capSize="dialog" />
    <Card capSize={size} />
    <Alias />
    <Miss />
  </>
);
`;

function analyze(prefix?: string, prefixContextualVars?: boolean) {
  const serialized = theme.serialize();
  const config = ds.toConfig();
  const system = loadSystemConfig(
    () => ({
      loadSystemModule: () => ({
        ...serialized,
        propConfig: config.propConfig,
        groupRegistry: config.groupRegistry,
      }),
    }),
    { systemPath: 'ds.ts', rootDir: '/', prefix, prefixContextualVars }
  );
  const api = makeApi();
  api.clearAnalysisCache();
  const warned: string[] = [];
  const result = runProjectAnalysis(() => api, {
    fileEntries: [{ path: 'src/app.tsx', source: SOURCE }],
    packageMap: {},
    system,
    emitter: { runtimeImport: 'runtime', cssModuleId: 'styles.css' },
    pathAliasesJson: null,
    devMode: false,
    warn: (message) => warned.push(message),
  });
  // The final spelling is only an alias under the prefix, so `Alias` is
  // left out of the comparison.
  const codes = result.manifest.diagnostics
    .filter((d) => d.component !== 'Alias')
    .map((d) => `${d.component}: ${d.code ?? d.kind}`);
  return { system, result, warned, codes };
}

describe('contextual variables under a prefix', () => {
  it('emit their final name wherever they are read or written', () => {
    const { system, result } = analyze('acme', true);
    expect(system.variableCss).toContain('@property --acme-tone {');
    for (const expected of [
      'background-color: var(--acme-tone)',
      'caret-color: var(--acme-tone)',
      '--acme-tone: red',
      '--edge: var(--acme-tone, var(--acme-cap, 1px))',
      '--other: var(--other, 2px)',
      'transition: --acme-tone 1s',
      'style(--acme-tone: dark)',
      '--acme-cap: 2px',
      '--acme-cap: 40rem',
    ]) {
      expect(result.componentCss).toContain(expected);
    }
    expect(result.componentCss).not.toMatch(/--tone\b|--cap\b/);
    const card = Object.values(result.manifest.components).find(
      (component) => component.binding === 'Card'
    );
    expect(card?.replacement).toContain('"property":"--acme-cap"');
    expect(card?.replacement).not.toContain('"--cap"');
  });

  it('report token misses exactly as without a prefix', () => {
    const prefixed = analyze('acme', true);
    expect(prefixed.codes).toEqual(analyze().codes);
    expect(prefixed.codes).toContain('Miss: animus.props.strict-token-miss');
  });

  it('without the option, keep their declared names where they are read and written', () => {
    const { system, result, warned } = analyze('acme');
    expect(system.variableCss).toContain('@property --tone {');
    // The names Animus generates still take the prefix.
    expect(system.variableCss).toContain('--acme-color-red:');
    for (const expected of [
      'background-color: var(--tone)',
      'caret-color: var(--tone)',
      '--tone: red',
      '--edge: var(--tone, var(--cap, 1px))',
      'transition: --tone 1s',
      'style(--tone: dark)',
      '--cap: 2px',
      '--cap: 40rem',
    ]) {
      expect(result.componentCss).toContain(expected);
    }
    expect(result.componentCss).not.toMatch(/--acme-(?:tone|cap)\b/);
    expect(warned.join('\n')).not.toContain('animus.prefix.');
  });
});
