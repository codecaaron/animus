import { describe, expect, it } from 'vitest';

import {
  INVALID_PROPERTY_REGISTRATION,
  SELECTOR_UNSUPPORTED_SUBJECT,
  hasSelectorSubject,
  collectSelectorAliasDiagnostics,
  surfaceManifestDiagnostics,
  systemLoadDiagnostics,
  VOCABULARY_COLLISION,
  VOCABULARY_LEGACY_VERB,
  vocabularyWitnessDiagnostics,
} from '../pipeline/manifest-diagnostics';
import { runProjectAnalysis } from '../pipeline/run-analysis';
import { loadSystemConfig } from '../pipeline/system-config';

import type {
  DiagnosticLevels,
  ManifestDiagnostic,
} from '../pipeline/manifest-diagnostics';

const errorDiagnostic: ManifestDiagnostic = {
  file: 'a.tsx',
  component: 'Mark',
  kind: 'skip',
  message: `selector '[aria-sort="ascending"] &' places '&' after an ancestor prefix (${SELECTOR_UNSUPPORTED_SUBJECT})`,
  code: SELECTOR_UNSUPPORTED_SUBJECT,
  severity: 'error',
};

describe('hasSelectorSubject', () => {
  it('detects substitutable subjects quote-awarely', () => {
    expect(hasSelectorSubject('[aria-sort="ascending"] &')).toBe(true);
    expect(hasSelectorSubject('.group:hover &:hover')).toBe(true);
    expect(hasSelectorSubject('&:hover')).toBe(true);
    expect(hasSelectorSubject('& + &')).toBe(true);
    expect(hasSelectorSubject(':hover')).toBe(false);
    expect(hasSelectorSubject('[data-x="a&b"]')).toBe(false);
  });

  it('tracks backslash escapes (mirrors the Rust walk)', () => {
    expect(hasSelectorSubject('[data-x="a\\"&b"]')).toBe(false);
    expect(hasSelectorSubject('[data-x="a\\"&b"] &')).toBe(true);
    expect(hasSelectorSubject('[data-x="a\\\\"]')).toBe(false);
    expect(hasSelectorSubject('.a\\& span')).toBe(false);
  });
});

describe('surfaceManifestDiagnostics strict policy', () => {
  it('throws under strict with every error diagnostic named', () => {
    const warned: string[] = [];
    expect(() =>
      surfaceManifestDiagnostics(
        { diagnostics: [errorDiagnostic] },
        (m) => warned.push(m),
        { strict: true }
      )
    ).toThrow(new RegExp(SELECTOR_UNSUPPORTED_SUBJECT.replace(/\./g, '\\.')));
    expect(warned).toHaveLength(0);
  });

  it('warns and proceeds without strict', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [errorDiagnostic] }, (m) =>
      warned.push(m)
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(SELECTOR_UNSUPPORTED_SUBJECT);
  });

  it('never escalates warn-severity skips under strict', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics(
      {
        diagnostics: [
          {
            file: 'a.tsx',
            component: 'Button',
            kind: 'skip',
            message: "property 'gap' — variable reference (non-static)",
          },
        ],
      },
      (m) => warned.push(m),
      { strict: true }
    );
    expect(warned).toHaveLength(1);
  });

  it('appends the code to printed lines only when the message lacks it', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics(
      {
        diagnostics: [
          { ...errorDiagnostic, message: 'ancestor prefix unsupported' },
        ],
      },
      (m) => warned.push(m)
    );
    expect(warned[0]).toContain(`[${SELECTOR_UNSUPPORTED_SUBJECT}]`);
    const alreadyCoded: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [errorDiagnostic] }, (m) =>
      alreadyCoded.push(m)
    );
    expect(alreadyCoded[0].endsWith(`[${SELECTOR_UNSUPPORTED_SUBJECT}]`)).toBe(
      false
    );
  });

  it('prints the line and column the engine located a record at', () => {
    const tag: ManifestDiagnostic = {
      file: 'src/App.tsx',
      component: '<Card>',
      kind: 'warn',
      message: '<Card> is an ordinary component declared in src/Card.tsx',
      code: 'animus.usage.identity-uncertain-tag',
      severity: 'info',
      line: 12,
      column: 5,
    };
    const info: string[] = [];
    surfaceManifestDiagnostics(
      { diagnostics: [tag, { ...tag, column: undefined }] },
      () => {},
      { info: (m) => info.push(m) }
    );
    expect(info[0]).toMatch(/^ℹ src\/App\.tsx:12:5: <Card>: /);
    expect(info[1]).toMatch(/^ℹ src\/App\.tsx:12: <Card>: /);
  });
  it('prints where a bail or skip is located and what it dropped', () => {
    const warned: string[] = [];
    surfaceManifestDiagnostics(
      {
        diagnostics: [
          {
            file: 'src/A.tsx',
            component: 'Wide',
            kind: 'bail',
            message:
              "chain dropped: parent 'Kit.Box' is a member of local object 'Kit'",
            line: 7,
            column: 21,
            dropped: 'Kit.Box',
          },
          {
            file: 'src/A.tsx',
            component: 'Skipping',
            kind: 'skip',
            message:
              "[skip] Skipping: property '&:hover' — spread element in style object",
            line: 11,
            column: 61,
            dropped: '...transition',
          },
        ],
      },
      (m) => warned.push(m)
    );
    expect(warned).toEqual([
      "⚠ src/A.tsx:7:21: Wide not extracted: chain dropped: parent 'Kit.Box' is a member of local object 'Kit'",
      "⚠ src/A.tsx:11:61: Skipping: skipped [skip] Skipping: property '&:hover' — spread element in style object — dropped: ...transition",
    ]);
  });
});

describe('surfaceManifestDiagnostics levels', () => {
  it('sets each code by exact entry, else longest prefix, else kind, over strict and the default, a hard error at error', () => {
    const record = (code: string, severity = 'warn'): ManifestDiagnostic => ({
      file: 'src/a.tsx',
      component: 'A',
      kind: 'warn',
      message: `reported ${code}`,
      code,
      severity,
    });
    const levels: DiagnosticLevels = {
      'animus.usage.identity-uncertain': 'off',
      'animus.style.*': 'error',
      'animus.style.unrecognized-key': 'warn',
      'animus.chain.*': 'info',
      'animus.styel.typo': 'warn',
      'kind:bail': 'off',
      'kind:skp': 'warn',
    };
    const knownCodes = new Set([
      'animus.usage.identity-uncertain',
      'animus.style.unrecognized-key',
      'animus.style.other',
      'animus.chain.skipped-value',
      'animus.chain.stage-evaluation-failed',
    ]);
    const bail = (component: string, code?: string): ManifestDiagnostic => {
      const diagnostic: ManifestDiagnostic = {
        file: 'src/a.tsx',
        component,
        kind: 'bail',
        message: `dropped ${component}`,
      };
      if (code !== undefined) diagnostic.code = code;
      return diagnostic;
    };
    const warned: string[] = [];
    const informed: string[] = [];
    const surface = () =>
      surfaceManifestDiagnostics(
        {
          diagnostics: [
            record('animus.usage.identity-uncertain'),
            record('animus.style.unrecognized-key', 'error'),
            record('animus.style.other'),
            record('animus.chain.skipped-value'),
            bail('B'),
            bail('C', 'animus.chain.stage-evaluation-failed'),
          ],
        },
        (m) => warned.push(m),
        {
          strict: true,
          levels,
          knownCodes,
          info: (m) => informed.push(m),
        }
      );

    // A prefix's `error` fails a warn-severity code; the exact `warn` keeps
    // an error-severity code from failing under strict.
    expect(surface).toThrow(
      /strict: 1 error diagnostic\(s\):\nanimus\.style\.other — /
    );
    expect(surface).toThrow(/^(?![\s\S]*unrecognized-key)/);
    expect(warned.filter((m) => m.includes('identity-uncertain'))).toEqual([]);
    expect(
      warned.filter((m) => m.includes('animus.style.unrecognized-key'))
    ).toHaveLength(2);
    expect(informed).toHaveLength(4);
    expect(informed[0]).toMatch(/^ℹ src\/a\.tsx: A: reported animus\.chain/);
    // A kind key selects records with no code; a code's prefix beats it.
    expect(warned.some((m) => m.includes('B not extracted'))).toBe(false);
    expect(informed).toContainEqual(
      expect.stringMatching(/^ℹ C not extracted: dropped C/)
    );
    // An unknown key warns once, however often the build analyzes.
    expect(warned.filter((m) => m.includes("'kind:skp'"))).toEqual([
      "⚠ diagnostics option: 'kind:skp' names no diagnostic kind — use kind:bail, kind:skip, kind:warn or kind:error",
    ]);
    expect(warned.filter((m) => m.includes("'animus.styel.typo'"))).toEqual([
      "⚠ diagnostics option: 'animus.styel.typo' matches no Animus diagnostic code — check its spelling (a code the system package mints at run time is known only once it is reported)",
    ]);

    // A hard error is error-level without strict: a build fails on it,
    // development reports it, and `kind:error` sets its level.
    const hard: ManifestDiagnostic = {
      file: 'system',
      component: '--tone',
      kind: 'error',
      message: 'conflict',
      code: 'animus.prefix.name-conflict',
      severity: 'error',
    };
    expect(() =>
      surfaceManifestDiagnostics({ diagnostics: [hard] }, () => {})
    ).toThrow(/animus\.prefix\.name-conflict — system: --tone: conflict/);
    const reported: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [hard] }, () => {}, {
      reportErrors: (m) => reported.push(m),
    });
    expect(reported).toHaveLength(1);
    const demoted: string[] = [];
    surfaceManifestDiagnostics(
      { diagnostics: [hard] },
      (m) => demoted.push(m),
      {
        levels: { 'kind:error': 'warn' },
      }
    );
    expect(demoted).toEqual([
      '⚠ system: --tone: conflict [animus.prefix.name-conflict]',
    ]);

    // Raised to error, a record with no line keeps the subject its warning
    // line names.
    const kit: ManifestDiagnostic = {
      file: '@acme/kit',
      component: 'kit',
      kind: 'warn',
      message: 'resolved, but discovery found none of its files',
      code: 'animus.discovery.no-kit-files',
      severity: 'warn',
    };
    expect(() =>
      surfaceManifestDiagnostics({ diagnostics: [kit] }, () => {}, {
        levels: { 'animus.discovery.no-kit-files': 'error' },
      })
    ).toThrow(/animus\.discovery\.no-kit-files — @acme\/kit: kit: resolved/);
  });
});

describe('collectSelectorAliasDiagnostics', () => {
  it('accepts ancestor-subject and mixed alias values (supported forms)', () => {
    expect(
      collectSelectorAliasDiagnostics(
        JSON.stringify({
          _hover: '&:hover',
          _groupHover: '.group:hover &',
          _dark: '[data-color-mode="dark"] &',
          _mixed: '&:focus-visible, .group:hover &',
        })
      )
    ).toEqual([]);
  });

  it('accepts leading-subject aliases and empty registries', () => {
    expect(
      collectSelectorAliasDiagnostics(
        JSON.stringify({ _hover: '&:hover, &[data-hover]' })
      )
    ).toEqual([]);
    expect(collectSelectorAliasDiagnostics(null)).toEqual([]);
  });

  it('throws on malformed selector-alias JSON, naming the wire and the cause', () => {
    expect(() => collectSelectorAliasDiagnostics('not-json')).toThrow(
      /selectorAliasesJson/
    );
    expect(() => collectSelectorAliasDiagnostics('not-json')).toThrow(
      /SyntaxError/
    );
  });

  it('flags a value whose every & is quoted with the coded error', () => {
    const diagnostics = collectSelectorAliasDiagnostics(
      JSON.stringify({ _broken: '[data-x="a&b"]' })
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].component).toBe('_broken');
    expect(diagnostics[0].code).toBe(SELECTOR_UNSUPPORTED_SUBJECT);
    expect(diagnostics[0].severity).toBe('error');
  });
});

describe('ingestion failures vs degradation under strict', () => {
  const legacyVerbWitness = JSON.stringify([
    {
      code: VOCABULARY_LEGACY_VERB,
      verb: 'from',
      source: '@acme/kit',
      names: ['dsKitMotion'],
    },
  ]);
  const collisionWitness = JSON.stringify([
    {
      code: VOCABULARY_COLLISION,
      name: 'fade',
      winner: '@acme/kit',
      loser: '@acme/legacy',
    },
  ]);

  const surface = (witnessJson: string, strict: boolean): string[] => {
    const warned: string[] = [];
    surfaceManifestDiagnostics({ diagnostics: [] }, (m) => warned.push(m), {
      strict,
      prepend: vocabularyWitnessDiagnostics(witnessJson),
    });
    return warned;
  };

  it('a deprecated verb dropping registered vocabulary stays a warning under strict', () => {
    const warned = surface(legacyVerbWitness, true);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(VOCABULARY_LEGACY_VERB);
  });

  it('the same case warns without strict', () => {
    const warned = surface(legacyVerbWitness, false);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(VOCABULARY_LEGACY_VERB);
  });

  it('a vocabulary name collision stays a warning under strict', () => {
    const warned = surface(collisionWitness, true);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain(VOCABULARY_COLLISION);
  });

  it('an unrecognized witness kind stays a warning under strict', () => {
    const warned = surface(
      JSON.stringify([{ code: 'animus.vocabulary.from-a-newer-system' }]),
      true
    );
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('animus.vocabulary.from-a-newer-system');
  });
});

describe('invalid @property registrations', () => {
  const registrations = [
    '@property --ok { syntax: "<color>"; inherits: true; initial-value: transparent; }',
    '@property --any { syntax: "*"; inherits: false; }',
    '@property --cap { syntax: "<length>"; inherits: false; }',
    '@property --tint { syntax: "<colour>"; inherits: true; initial-value: red; }',
    '@property --gap { syntax: "<length>"; inherits: true; initial-value: red; }',
    '@property --em { syntax: "<length>"; inherits: true; initial-value: 1em; }',
    '@property --vw { syntax: "<length>"; inherits: true; initial-value: 1vw; }',
    '@property --typo { syntax: "<colour>"; inherits: true; }',
    '@property --label { syntax: "<string>"; inherits: true; initial-value: "5em"; }',
    '@property --art { syntax: "<url>"; inherits: true; initial-value: url(a2ex.png); }',
    '@property --fade { syntax: "<image>"; inherits: true; initial-value: linear-gradient(red 1em, blue); }',
    '@property --sub { syntax: "*"; inherits: false; initial-value: var(--foreign); }',
    '@property --ratio { syntax: "<number>"; inherits: false; initial-value: calc(1px / 1px); }',
    '@property --round { syntax: "<integer> | <number>"; inherits: false; initial-value: calc(7 / 2); }',
    '@property --spacing { syntax: "<length>"; inherits: false; initial-value: calc(1px+ 2px); }',
    '@property --note { syntax: "*"; inherits: false; initial-value: /* var(--other) */ ok; }',
    '@property --link { syntax: "*"; inherits: false; initial-value: url("var(--other)"); }',
    String.raw`@property --hidden { syntax: "*"; inherits: false; initial-value: v\61 r(--other); }`,
    '@property --café { syntax: "<length>"; inherits: true; initial-value: 1em; }',
  ].join('\n');

  function load(prefix?: string) {
    return loadSystemConfig(
      () => ({
        loadSystemModule: () => ({
          propConfig: '{}',
          groupRegistry: '{}',
          scalesJson: '{}',
          variableMapJson: '{}',
          variableCss: `${registrations}\n\n:root { --ok: red; }`,
        }),
      }),
      { systemPath: 'ds.ts', rootDir: '/', prefix }
    );
  }

  it('drops the rules browsers would ignore and keeps the valid ones', () => {
    const system = load();
    expect(system.variableCss).toContain('@property --ok');
    expect(system.variableCss).toContain('@property --any');
    expect(system.variableCss).toContain('@property --vw');
    expect(system.variableCss).toContain('@property --label');
    expect(system.variableCss).toContain('@property --art');
    // An all-absolute math initial value is kept as its computed value, by
    // the first syntax alternative that accepts it, rounded for <integer>.
    expect(system.variableCss).toContain(
      '@property --ratio { syntax: "<number>"; inherits: false; initial-value: 1; }'
    );
    expect(system.variableCss).toContain(
      '@property --round { syntax: "<integer> | <number>"; inherits: false; initial-value: 4; }'
    );
    // Comments and quoted url() text substitute nothing.
    expect(system.variableCss).toContain('@property --note');
    expect(system.variableCss).toContain('@property --link');
    const reasons = Object.fromEntries(
      (system.invalidPropertyRegistrations ?? []).map((r) => [r.name, r.reason])
    );
    expect(Object.keys(reasons)).toEqual([
      '--cap',
      '--tint',
      '--gap',
      '--em',
      '--typo',
      '--fade',
      '--sub',
      '--spacing',
      '--hidden',
      '--café',
    ]);
    for (const name of Object.keys(reasons)) {
      expect(system.variableCss).not.toContain(`@property ${name} `);
    }
    expect(reasons['--cap']).toBe('syntax "<length>" needs an initialValue');
    expect(reasons['--typo']).toBe(
      'syntax "<colour>" has the unknown component "<colour>"'
    );
    expect(reasons['--em']).toMatch(/^initialValue "1em" depends on context/);
    expect(reasons['--gap']).toMatch(/^the CSS parser rejects/);
    expect(reasons['--sub']).toMatch(
      /^initialValue "var\(--foreign\)" substitutes/
    );
    expect(reasons['--spacing']).toMatch(
      /is not a valid calculation: "\+" and "-" need whitespace on both sides$/
    );
    expect(reasons['--hidden']).toMatch(/substitutes another value/);
  });

  it('passes the property records through with their authored names', () => {
    const records = JSON.stringify([
      { name: 'tone', inherits: true, scales: ['colors'], home: 'theme' },
    ]);
    const system = loadSystemConfig(
      () => ({
        loadSystemModule: () => ({
          propConfig: '{}',
          groupRegistry: '{}',
          scalesJson: '{}',
          variableMapJson: '{}',
          variableCss: '',
          contextualVarsJson: '{"colors":["tone"]}',
          propertyRecordsJson: records,
        }),
      }),
      { systemPath: 'ds.ts', rootDir: '/', prefix: 'acme' }
    );
    expect(system.propertyRecordsJson).toBe(records);
    expect(system.contextualVarsJson).toBe('{"colors":["tone"]}');
  });

  it('reports authored names and prefixes only the kept rules', () => {
    const system = load('acme');
    expect(system.variableCss).toContain('@property --acme-ok');
    expect(system.invalidPropertyRegistrations?.[0]?.name).toBe('--cap');
  });

  it('becomes one strict-failing diagnostic per dropped rule', () => {
    const diagnostics = systemLoadDiagnostics(load());
    expect(diagnostics.map((d) => [d.component, d.code, d.severity])).toEqual(
      [
        '--cap',
        '--tint',
        '--gap',
        '--em',
        '--typo',
        '--fade',
        '--sub',
        '--spacing',
        '--hidden',
        '--café',
      ].map((name) => [name, INVALID_PROPERTY_REGISTRATION, 'error'])
    );
    expect(
      systemLoadDiagnostics({
        scalesJson: '{}',
        invalidPropertyRegistrations: undefined,
      })
    ).toEqual([]);
  });

  it('reports a loaded system once, however often it is analyzed', () => {
    const analyze = (system: ReturnType<typeof load>, strict = false) => {
      const warned: string[] = [];
      runProjectAnalysis(
        () => ({
          analyzeProject: () =>
            JSON.stringify({
              diagnostics: [],
              sheets: { global: '' },
              css: '',
              components: {},
            }),
        }),
        {
          fileEntries: [],
          packageMap: {},
          system,
          emitter: { runtimeImport: 'runtime', cssModuleId: 'styles.css' },
          pathAliasesJson: null,
          devMode: false,
          warn: (message) => warned.push(message),
          strict,
        }
      );
      return warned.filter((m) => m.includes(INVALID_PROPERTY_REGISTRATION));
    };
    const system = load();
    expect(analyze(system)).toHaveLength(10);
    expect(analyze(system)).toHaveLength(0);
    expect(analyze(load())).toHaveLength(10);
    const strictSystem = load();
    expect(() => analyze(strictSystem, true)).toThrow(
      INVALID_PROPERTY_REGISTRATION
    );
    expect(() => analyze(strictSystem, true)).toThrow(
      INVALID_PROPERTY_REGISTRATION
    );
  });

  it('reaches the build through runProjectAnalysis, failing strict', () => {
    const analyze = (strict: boolean, warn: (message: string) => void) =>
      runProjectAnalysis(
        () => ({
          analyzeProject: () =>
            JSON.stringify({
              diagnostics: [],
              sheets: { global: '' },
              css: '',
              components: {},
            }),
        }),
        {
          fileEntries: [],
          packageMap: {},
          system: load(),
          emitter: { runtimeImport: 'runtime', cssModuleId: 'styles.css' },
          pathAliasesJson: null,
          devMode: false,
          warn,
          strict,
        }
      );
    expect(() => analyze(true, () => {})).toThrow(
      INVALID_PROPERTY_REGISTRATION
    );
    const warned: string[] = [];
    analyze(false, (message) => warned.push(message));
    expect(
      warned.filter((m) => m.includes(INVALID_PROPERTY_REGISTRATION))
    ).toHaveLength(10);
  });
});
