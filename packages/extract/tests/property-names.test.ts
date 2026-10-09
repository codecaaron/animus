import { describe, expect, it } from 'vitest';

import { createV2EngineApi } from '../pipeline/engine-adapter';
import {
  PROPERTY_UNREGISTERED_ANIMATION,
  systemLoadDiagnostics,
} from '../pipeline/manifest-diagnostics';
import { checkCustomProperties } from '../pipeline/property-diagnostics';
import {
  createPropertyNames,
  renameCustomProperties,
} from '../pipeline/property-names';
import { runProjectAnalysis } from '../pipeline/run-analysis';
import { loadSystemConfig } from '../pipeline/system-config';

describe('one final name per managed property', () => {
  const names = createPropertyNames(['tone', 'gap'], 'acme');

  it('renames reads, fallbacks at any depth, declaration keys and registrations', () => {
    expect(
      renameCustomProperties(
        [
          '@property --tone { syntax: "<color>"; inherits: true; initial-value: red; }',
          ':root { --tone: red; --gap: var(--tone, var(--gap, 4px)); }',
          '.a { color: var( --tone ); margin: calc(var(--gap) * 2); }',
        ].join('\n'),
        names
      )
    ).toBe(
      [
        '@property --acme-tone { syntax: "<color>"; inherits: true; initial-value: red; }',
        ':root { --acme-tone: red; --acme-gap: var(--acme-tone, var(--acme-gap, 4px)); }',
        '.a { color: var( --acme-tone ); margin: calc(var(--acme-gap) * 2); }',
      ].join('\n')
    );
  });

  it('leaves unmanaged names, strings and url() alone', () => {
    const css =
      '.a { --other: var(--other, 1px); content: "var(--tone)"; ' +
      "background: url(var(--tone).png); quotes: 'var(--gap)'; }";
    expect(renameCustomProperties(css, names)).toBe(css);
  });

  it('accepts the exact final spelling as the same property', () => {
    expect(names.identity('acme-tone')).toBe('tone');
    expect(names.identity('tone')).toBe('tone');
    expect(names.identity('acme-acme-tone')).toBeUndefined();
    expect(renameCustomProperties('a { b: var(--acme-tone) }', names)).toBe(
      'a { b: var(--acme-tone) }'
    );
  });

  it('serializes the declared-to-final map', () => {
    expect(JSON.parse(names.toJson())).toEqual({
      gap: 'acme-gap',
      tone: 'acme-tone',
    });
  });
});

describe('no name is renamed twice', () => {
  /** Every managed name is a short word, `acme-` plus one, or `acme-acme-`
   *  plus one, so declared names, final names and aliases overlap. */
  function overlappingSets(): string[][] {
    const words = ['a', 'b', 'tone'];
    const spellings = words.flatMap((word) => [
      word,
      `acme-${word}`,
      `acme-acme-${word}`,
    ]);
    const sets: string[][] = [];
    for (let mask = 1; mask < 1 << spellings.length; mask += 37) {
      sets.push(spellings.filter((_, bit) => mask & (1 << bit)));
    }
    return sets;
  }

  it('maps every written name exactly once, over generated overlapping sets', () => {
    for (const managed of overlappingSets()) {
      const names = createPropertyNames(managed, 'acme');
      const written = [
        ...new Set(managed.flatMap((name) => [name, `acme-${name}`])),
      ];
      const css = written.map((name) => `--${name}: var(--${name});`).join(' ');
      const renamed = renameCustomProperties(css, names);
      const expected = written
        .map((name) => {
          const identity = managed.includes(name)
            ? name
            : managed.find((declared) => `acme-${declared}` === name);
          const final = identity === undefined ? name : `acme-${identity}`;
          return `--${final}: var(--${final});`;
        })
        .join(' ');
      expect(renamed, `managed: ${managed.join(', ')}`).toBe(expected);
    }
  });

  it("prefers a declared name over another name's final spelling", () => {
    const names = createPropertyNames(['tone', 'acme-tone'], 'acme');
    expect(names.identity('acme-tone')).toBe('acme-tone');
    expect(
      renameCustomProperties('x { a: var(--tone); b: var(--acme-tone) }', names)
    ).toBe('x { a: var(--acme-tone); b: var(--acme-acme-tone) }');
  });
});

const SYSTEM = {
  propConfig: '{}',
  groupRegistry: '{}',
  variableCss:
    '@property --tone { syntax: "<color>"; inherits: true; initial-value: red; }\n\n' +
    ':root {\n  --color-red: #f00;\n  --color-ink: var(--color-red, black);\n  --breakpoint-sm: 768px;\n}',
  variableMapJson: JSON.stringify({
    'colors.red': '--color-red',
    'colors.ink': '--color-ink',
  }),
  scalesJson: JSON.stringify({
    'colors.red': 'var(--color-red)',
    'colors.ink': 'var(--color-ink)',
    'shadows.glow': '0 0 2px var(--tone, red)',
    'fonts.quote': '"var(--tone)"',
  }),
  contextualVarsJson: JSON.stringify({ colors: ['tone'] }),
  declarationScalesJson: JSON.stringify({
    tones: {
      kind: 'declarations',
      members: ['color'],
      values: { loud: { color: 'var(--tone, var(--other, red))' } },
    },
  }),
};

function load(prefix?: string, prefixContextualVars?: boolean) {
  return loadSystemConfig(() => ({ loadSystemModule: () => SYSTEM }), {
    systemPath: 'ds.ts',
    rootDir: '/',
    prefix,
    prefixContextualVars,
  });
}

const artifacts = (system: ReturnType<typeof load>) => ({
  variableCss: system.variableCss,
  variableMapJson: system.variableMapJson,
  scalesJson: system.scalesJson,
  contextualVarsJson: system.contextualVarsJson,
  declarationScalesJson: system.declarationScalesJson,
});

// Recorded from the release before the option existed.
const legacy = {
  unprefixed: {
    variableCss:
      '@property --tone { syntax: "<color>"; inherits: true; initial-value: red; }\n\n:root {\n  --color-red: #f00;\n  --color-ink: var(--color-red, black);\n  --breakpoint-sm: 768px;\n}',
    variableMapJson: '{"colors.red":"--color-red","colors.ink":"--color-ink"}',
    scalesJson:
      '{"colors.red":"var(--color-red)","colors.ink":"var(--color-ink)","shadows.glow":"0 0 2px var(--tone, red)","fonts.quote":"\\"var(--tone)\\""}',
    contextualVarsJson: '{"colors":["tone"]}',
    declarationScalesJson:
      '{"tones":{"kind":"declarations","members":["color"],"values":{"loud":{"color":"var(--tone, var(--other, red))"}}}}',
  },
  prefixed: {
    variableCss:
      '@property --acme-tone { syntax: "<color>"; inherits: true; initial-value: red; }\n\n:root {\n  --acme-color-red: #f00;\n  --acme-color-ink: var(--color-red, black);\n  --acme-breakpoint-sm: 768px;\n}',
    variableMapJson:
      '{"colors.red":"--acme-color-red","colors.ink":"--acme-color-ink"}',
    scalesJson:
      '{"colors.red":"var(--acme-color-red)","colors.ink":"var(--acme-color-ink)","shadows.glow":"0 0 2px var(--tone, red)","fonts.quote":"\\"var(--acme-tone)\\""}',
    contextualVarsJson: '{"colors":["acme-tone"]}',
    declarationScalesJson:
      '{"tones":{"kind":"declarations","members":["color"],"values":{"loud":{"color":"var(--tone, var(--other, red))"}}}}',
  },
};

describe('system load under a prefix', () => {
  it('is unchanged without the option, prefixed or not', () => {
    expect(artifacts(load())).toEqual(legacy.unprefixed);
    expect(artifacts(load('acme'))).toEqual(legacy.prefixed);
    expect(artifacts(load(undefined, true))).toEqual(legacy.unprefixed);
    expect(load('acme').contextualProperties).toEqual(['--acme-tone']);
    expect(load().contextualProperties).toEqual(['--tone']);
  });

  it('with the option, renames managed names once and keeps the declared names', () => {
    const system = load('acme', true);
    expect(system.variableCss).toBe(
      '@property --acme-tone { syntax: "<color>"; inherits: true; initial-value: red; }\n\n' +
        ':root {\n  --acme-color-red: #f00;\n  --acme-color-ink: var(--acme-color-red, black);\n  --acme-breakpoint-sm: 768px;\n}'
    );
    expect(system.variableMapJson).toBe(legacy.prefixed.variableMapJson);
    expect(JSON.parse(system.scalesJson)).toEqual({
      'colors.red': 'var(--acme-color-red)',
      'colors.ink': 'var(--acme-color-ink)',
      'shadows.glow': '0 0 2px var(--acme-tone, red)',
      'fonts.quote': '"var(--tone)"',
    });
    expect(JSON.parse(system.declarationScalesJson ?? 'null')).toEqual({
      tones: {
        kind: 'declarations',
        members: ['color'],
        values: { loud: { color: 'var(--acme-tone, var(--other, red))' } },
      },
    });
    expect(system.contextualVarsJson).toBe(
      '{"colors":[{"name":"tone","var":"acme-tone"}]}'
    );
    expect(system.contextualProperties).toEqual(['--acme-tone']);
  });

  it('names the option when a prefix meets contextual variables without it', () => {
    const codes = (system: ReturnType<typeof load>) =>
      systemLoadDiagnostics(system).map((d) => [d.code, d.severity]);
    expect(codes(load('acme'))).toEqual([
      ['animus.prefix.contextual-vars-unprefixed', 'warn'],
    ]);
    expect(systemLoadDiagnostics(load('acme'))[0]?.message).toContain(
      'prefixContextualVars'
    );
    expect(codes(load('acme', true))).toEqual([]);
    expect(codes(load())).toEqual([]);
  });
});

describe('the map reaches the extractor', () => {
  /** The options the extractor is constructed with, for one analysis. */
  type EngineOptions = Record<string, string | boolean | undefined>;

  function engineOptions(prefixContextualVars: boolean): EngineOptions {
    const constructed: EngineOptions[] = [];
    const engineApi = createV2EngineApi({
      label: 'property-names-test',
      isV2: () => true,
      loadNativeEngine: () => ({
        loadSystemModule: () => SYSTEM,
        ExtractEngine: class {
          constructor(options: EngineOptions) {
            constructed.push(options);
          }
          analyze() {
            return JSON.stringify({
              diagnostics: [],
              sheets: { global: '' },
              css: '',
              components: {},
            });
          }
        },
      }),
      store: {
        getEngine: () => null,
        setEngine: () => {},
        getSentSources: () => null,
        setSentSources: () => {},
        getDriftWarned: () => false,
        setDriftWarned: () => {},
      },
    });
    runProjectAnalysis(engineApi, {
      fileEntries: [],
      packageMap: {},
      system: load('acme', prefixContextualVars),
      emitter: { runtimeImport: 'runtime', cssModuleId: 'styles.css' },
      pathAliasesJson: null,
      devMode: false,
      warn: () => {},
    });
    return constructed[0] ?? {};
  }

  it('carries each final name in the contextual entries only with the option', () => {
    const optedIn = engineOptions(true);
    expect(optedIn.contextualVarsJson).toBe(
      '{"colors":[{"name":"tone","var":"acme-tone"}]}'
    );
    expect(engineOptions(false).contextualVarsJson).toBe(
      legacy.prefixed.contextualVarsJson
    );
    expect(Object.keys(optedIn)).toEqual(Object.keys(engineOptions(false)));
  });
});

describe('the property checks read emitted names', () => {
  it('match a declared contextual variable by its final name', () => {
    const diagnostics = checkCustomProperties({
      system: {
        variableCss: '@property --acme-x { syntax: "*"; inherits: true; }',
        contextualProperties: ['--acme-x'],
      },
      manifest: { components: {} },
      componentCss: '.a { transition: --acme-x 1s, --x 1s; }',
      globalCss: '',
    });
    expect(diagnostics.map((d) => [d.code, d.message.split(' ')[0]])).toEqual([
      [PROPERTY_UNREGISTERED_ANIMATION, '--acme-x'],
    ]);
  });
});
