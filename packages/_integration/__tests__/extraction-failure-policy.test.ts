import { surfaceManifestDiagnostics } from '@animus-ui/extract/pipeline';
import { createSystem, createTransform } from '@animus-ui/system';
import { beforeAll, describe, expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import {
  analyzeProject,
  clearAnalysisCache,
  runPipeline,
} from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

// Inline rather than under fixtures/components, which is also the parity corpus.
const SYSTEM = {
  path: 'fixtures/policy-system.ts',
  source: `import { createSystem } from '@animus-ui/system';
const bundle = createSystem().build();
export const ds = bundle.seal();
`,
};

const AXIS = {
  path: 'fixtures/policy-axis.ts',
  source: `export const TONES = { x: { display: 'block' }, y: { display: 'flex' } };
export const TONE_AXIS = { prop: 'tone', defaultVariant: 'x', variants: TONES };
export const SHARED_CFG = { property: 'width', transform: (value) => value * 2 };
`,
};

const COMPONENTS = {
  path: 'fixtures/policy-components.tsx',
  source: `import * as other from 'other-lib';
import { lib } from 'other-lib';
import { outside } from 'outside-kit';
import * as barrel from './policy-barrel';
import * as policy from './policy-system';
import { ds } from './policy-system';
import { SHARED_CFG, TONE_AXIS, TONES } from './policy-axis';

const double = (value) => value * 2;
let shift = (value) => value * 2;
const base = { property: 'height' };
const INSET_CFG = { property: 'width', transform: double };
const INLINE_CFG = { property: 'width', transform: (value) => value * 2 };
const REF_PROPS = { inset: { property: 'width', transform: double } };
const INLINE_PROPS = { inset: { property: 'width', transform: (value) => value * 2 } };
const ABSENT_CFG = { property: 'width', transform: undefined };
const ASSERTED_PROPS = { inset: { property: 'width', transform: double } as const };
const SPREAD_PROPS = { inset: { ...base } };

export const AssertedConfig = ds
  .styles({ cursor: 'zoom-out' })
  .props({ inset: { property: 'width', transform: shift } satisfies object })
  .asElement('div');
export const AssertedConstProps = ds.styles({ cursor: 'context-menu' }).props(ASSERTED_PROPS).asElement('div');
export const SpreadConstProps = ds.styles({ cursor: 'progress' }).props(SPREAD_PROPS).asElement('div');
export const AssertedAbsent = ds
  .styles({ cursor: 'vertical-text' })
  .props({ inset: { property: 'width', transform: undefined } as const })
  .asElement('div');
export const AssertedInline = ds
  .styles({ cursor: 'no-drop' })
  .props({ inset: { property: 'width', transform: ((value) => value * 2) as never } })
  .asElement('div');
export const BarrelNamespace = barrel.ds.styles({ cursor: 'not-allowed' }).asElement('div');

export const ConstConfig = ds.styles({ cursor: 'n-resize' }).props({ inset: INSET_CFG }).asElement('div');
export const ConstProps = ds.styles({ cursor: 's-resize' }).props(REF_PROPS).asElement('div');
export const ConstInlineProps = ds.styles({ cursor: 'e-resize' }).props(INLINE_PROPS).asElement('div');
export const ImportedConfig = ds.styles({ cursor: 'nesw-resize' }).props({ inset: SHARED_CFG }).asElement('div');
export const ConstInlineConfig = ds.styles({ cursor: 'w-resize' }).props({ inset: INLINE_CFG }).asElement('div');
export const ConditionalTransform = ds
  .styles({ cursor: 'ne-resize' })
  .props({ inset: { property: 'width', transform: TONES.x ? double : undefined } })
  .asElement('div');
export const MalformedProps = ds.styles({ cursor: 'nw-resize' }).props({ inset: { property: 123 } }).asElement('div');
export const NamespaceRoot = policy.ds.styles({ cursor: 'se-resize' }).asElement('div');
export default ds.styles({ cursor: 'sw-resize' }).asElement('section');

export const AbsentTransform = ds
  .styles({ cursor: 'ew-resize' })
  .props({ inset: { property: 'width', transform: undefined }, tall: { property: 'height', transform: void 0 } })
  .asElement('div');
export const AbsentConstConfig = ds.styles({ cursor: 'ns-resize' }).props({ inset: ABSENT_CFG }).asElement('div');
export const NamedTransform = ds.styles({ cursor: 'col-resize' }).props({ inset: { property: 'width', transform: 'size' } }).asElement('div');
export const DefaultVariantProp = ds.styles({ cursor: 'row-resize' }).variant({ variants: { a: { display: 'block' } } }).asElement('div');
export const OtherNamespace = other.lib.styles({ cursor: 'all-scroll' }).asElement('div');

export const WholeAxis = ds.styles({ cursor: 'pointer' }).variant(TONE_AXIS).asElement('div');
const UnusedWholeAxis = ds.styles({ cursor: 'help' }).variant(TONE_AXIS).asElement('div');
export const UnknownMethod = ds.styles({ cursor: 'wait' }).frobnicate().asElement('div');
export const ReferencedTransform = ds
  .styles({ cursor: 'crosshair' })
  .props({ inset: { property: 'width', transform: shift } })
  .asElement('div');

export const NestedAxis = ds
  .styles({ cursor: 'move' })
  .variant({ prop: 'tone', defaultVariant: 'x', variants: TONES })
  .asElement('div');
export const ExtendArguments = NestedAxis.extend({ cursor: 'grab' }).styles({}).asElement('div');
export const InlineTransform = ds
  .styles({ cursor: 'grab' })
  .props({ inset: { property: 'width', transform: (value) => value * 2 } })
  .asElement('div');
export const SpreadConfig = ds
  .styles({ cursor: 'zoom-in' })
  .props({ inset: { ...base, transform: double } })
  .asElement('div');

export const LookalikeAxis = lib.styles({ cursor: 'copy' }).variant(TONE_AXIS).asElement('div');
export const LookalikeTransform = lib
  .styles({ cursor: 'cell' })
  .props({ inset: { property: 'width', transform: shift } })
  .asElement('div');
export const OutsideAxis = outside.styles({ cursor: 'alias' }).variant(TONE_AXIS).asElement('div');

export const App = ({ inset }) => (
  <>
    <WholeAxis tone="y" />
    <NestedAxis tone="y" />
    <InlineTransform inset={inset} />
    <ReferencedTransform inset={inset} />
  </>
);
`,
};

const FILE = COMPONENTS.path;

const BARREL = {
  path: 'fixtures/policy-barrel.ts',
  source: `import { ds } from './policy-system';
export { ds };
`,
};

const LOOKALIKE_MODULE = {
  path: 'fixtures/policy-lookalike.tsx',
  source: `import { lib } from 'other-lib';
export const LookalikeMalformed = lib.styles({ cursor: 'pointer' }).props({ inset: { property: 123 } }).asElement('div');
export default lib.styles({ cursor: 'default' }).asElement('section');
`,
};

const DEFAULT_LINE =
  COMPONENTS.source
    .split('\n')
    .findIndex((line) => line.startsWith('export default ')) + 1;

/** A module binding named `undefined` makes the identifier a reference. */
const SHADOWED = {
  path: 'fixtures/policy-shadowed.tsx',
  source: `import { ds } from './policy-system';
const undefined = (value) => value * 2;
const SHADOW_CFG = { property: 'width', transform: undefined };
export const ShadowedConst = ds.styles({ cursor: 'copy' }).props({ inset: SHADOW_CFG }).asElement('div');
export const ShadowedUndefined = ds
  .styles({ cursor: 'cell' })
  .props({ inset: { property: 'width', transform: undefined } })
  .asElement('div');
`,
};

/** Chains the extractor never takes, each building at runtime. */
const RUNTIME_BUILDERS = {
  path: 'fixtures/policy-runtime.tsx',
  source: `import { lib } from 'other-lib';
import { ds } from './policy-system';
const make = (p) => ds.styles({ padding: p }).asElement('div');
export const Made = make(4);
export function InRender() {
  const Inner = ds.styles({ cursor: 'pointer' }).asElement('div');
  return <Inner />;
}
const staged = ds.styles({ cursor: 'text' });
export const Staged = staged.variant({ prop: 'tone', variants: { x: { display: 'block' } } }).asElement('div');
export const LookalikeInRender = () => lib.styles({ cursor: 'copy' }).asElement('div');
`,
};

const RUNTIME_BUILDER_REFERENCE = 'animus.extract.runtime-builder-reference';

/** Each classified declaration: its code, and the named reason and
 *  supported alternative its message must carry. */
const CLASSIFIED = [
  {
    component: 'WholeAxis',
    code: 'animus.variant.unsupported-config-reference',
    reason: "'TONE_AXIS'",
    alternative: 'inline',
  },
  {
    component: 'UnusedWholeAxis',
    code: 'animus.variant.unsupported-config-reference',
    reason: "'TONE_AXIS'",
    alternative: 'inline',
  },
  {
    component: 'UnknownMethod',
    code: 'animus.chain.unsupported-method',
    reason: "'frobnicate'",
    alternative: 'supported builder methods',
  },
  {
    component: 'ExtendArguments',
    code: 'animus.extension.unsupported-arguments',
    reason: 'with arguments',
    alternative: 'no arguments',
  },
  ...[
    'ReferencedTransform',
    'ConstConfig',
    'ConstProps',
    'ConstInlineProps',
    'ConstInlineConfig',
    'ImportedConfig',
    'ConditionalTransform',
    'AssertedConfig',
    'AssertedConstProps',
  ].map((component) => ({
    component,
    code: 'animus.props.unsupported-transform-reference',
    reason: "'inset'",
    alternative: 'inside the .props() object literal',
  })),
  ...['SpreadConfig', 'SpreadConstProps'].map((component) => ({
    component,
    code: 'animus.props.unsupported-config',
    reason: 'spread',
    alternative: 'object literal',
  })),
  {
    component: 'MalformedProps',
    code: 'animus.chain.stage-evaluation-failed',
    reason: "custom prop 'inset'",
    alternative: 'documented .props() shape',
  },
  {
    component: 'NamespaceRoot',
    code: 'animus.chain.unsupported-namespace-root',
    reason: "'policy.ds'",
    alternative: 'named import',
  },
  {
    component: 'default',
    code: 'animus.chain.unsupported-default-export',
    reason: `${FILE}:${DEFAULT_LINE}:${'export default '.length + 1}`,
    alternative: 'export const',
  },
  {
    component: 'ShadowedConst',
    code: 'animus.props.unsupported-transform-reference',
    reason: "const 'SHADOW_CFG'",
    alternative: 'inside the .props() object literal',
    file: SHADOWED.path,
  },
].map((entry) => ({ file: FILE, ...entry }));

type Analysis = {
  manifest: {
    diagnostics?: ManifestDiagnostic[];
    components: Record<string, { replacement: string }>;
  };
  diagnostics: ManifestDiagnostic[];
};

function analyze(devMode: boolean): Analysis {
  clearAnalysisCache();
  const { manifest, css } = runPipeline(
    [
      SYSTEM,
      AXIS,
      BARREL,
      COMPONENTS,
      SHADOWED,
      LOOKALIKE_MODULE,
      RUNTIME_BUILDERS,
    ],
    {
      devMode,
    }
  );
  assertNoUnresolvedTokens(css);
  return { manifest, diagnostics: manifest.diagnostics ?? [] };
}

function forComponent(diagnostics: ManifestDiagnostic[], component: string) {
  return diagnostics.filter((d) => d.component === component);
}

/** A delivered line about `component` itself, not a name containing it. */
function namesComponent(line: string, component: string): boolean {
  return (
    line.startsWith(`⚠ ${component} `) ||
    line.startsWith(`⚠ ${component}: `) ||
    line.includes(`: ${component}: `)
  );
}

function surface(
  manifest: { diagnostics?: ManifestDiagnostic[] },
  strict: boolean | undefined
) {
  const lines: string[] = [];
  let thrown: Error | null = null;
  try {
    surfaceManifestDiagnostics(manifest, (line) => lines.push(line), {
      strict,
    });
  } catch (error) {
    thrown = error instanceof Error ? error : new Error(String(error));
  }
  return { lines, thrown };
}

describe.each([
  ['development', true],
  ['production', false],
])('classified extraction failures (%s analysis)', (_mode, devMode) => {
  let analysis: Analysis;

  beforeAll(() => {
    analysis = analyze(devMode);
  });

  test('each source-proven unsupported declaration has one coded, attributed diagnostic', () => {
    for (const expected of CLASSIFIED) {
      const found = forComponent(analysis.diagnostics, expected.component);
      expect(found, expected.component).toHaveLength(1);
      expect(found[0]).toMatchObject({
        file: expected.file,
        code: expected.code,
        severity: 'error',
      });
      expect(found[0].kind).not.toBe('error');
      expect(found[0].message).toContain(expected.file);
      expect(found[0].message).toContain(expected.reason);
      expect(found[0].message).toContain(expected.alternative);
    }
  });

  test('lost-value markers never reach the manifest', () => {
    expect(JSON.stringify(analysis.manifest)).not.toContain('$animus.lost');
  });

  test('valid dynamic styling, absent transforms and supported controls stay undiagnosed', () => {
    for (const component of [
      'NestedAxis',
      'InlineTransform',
      'AbsentTransform',
      'AbsentConstConfig',
      'NamedTransform',
      'DefaultVariantProp',
      'OtherNamespace',
      'AssertedAbsent',
      'AssertedInline',
      'ShadowedUndefined',
    ]) {
      expect(forComponent(analysis.diagnostics, component), component).toEqual(
        []
      );
    }
    // A module binding named `undefined` is a reference, kept as authored.
    expect(
      analysis.manifest.components[`${SHADOWED.path}::ShadowedUndefined`]
    ).toMatchObject({
      replacement: expect.stringContaining('"transform":undefined'),
    });
    expect(analysis.manifest.components).toHaveProperty(`${FILE}::NestedAxis`);
    expect(analysis.manifest.components).toHaveProperty(
      `${FILE}::InlineTransform`
    );
  });

  test('a namespace-root chain reached through a barrel is reported, not silently dropped', () => {
    expect(forComponent(analysis.diagnostics, 'BarrelNamespace')).toMatchObject(
      [
        {
          kind: 'bail',
          code: 'animus.chain.namespace-root-through-barrel',
          severity: 'warn',
          message: expect.stringContaining(
            "reads 'ds' through namespace import 'barrel', reached through fixtures/policy-barrel.ts"
          ),
        },
      ]
    );
  });

  test('lookalike builders and inputs outside the analyzed program keep their unclassified diagnostics', () => {
    for (const component of [
      'LookalikeAxis',
      'LookalikeTransform',
      'OutsideAxis',
    ]) {
      const found = forComponent(analysis.diagnostics, component);
      expect(found.length, component).toBeGreaterThan(0);
      for (const diagnostic of found) {
        expect(
          ['animus.chain.unextractable', 'animus.chain.skipped-value'],
          component
        ).toContain(diagnostic.code);
        expect(diagnostic.severity, component).toBe('warn');
      }
    }
    expect(
      analysis.diagnostics.filter(
        (d) => d.component === 'default' && d.file === LOOKALIKE_MODULE.path
      )
    ).toEqual([]);
    expect(
      forComponent(analysis.diagnostics, 'LookalikeMalformed')
    ).toMatchObject([
      {
        kind: 'bail',
        message:
          "chain dropped: stage 'props' evaluation failed — props config parse failed: invalid type: integer `123`, expected a string",
      },
    ]);
    expect(
      forComponent(analysis.diagnostics, 'LookalikeTransform')
    ).toMatchObject([
      {
        kind: 'skip',
        message:
          "[skip] LookalikeTransform: property 'transform' — transform reference 'shift' is a mutable `let` binding",
      },
    ]);
  });

  test('a system chain built in a function, in render or across declarations warns once at its line', () => {
    const runtime = analysis.diagnostics.filter(
      (d) => d.code === RUNTIME_BUILDER_REFERENCE
    );
    expect(runtime.map((d) => [d.component, d.message.split(':')[0]])).toEqual([
      ['make', 'line 3'],
      ['InRender', 'line 6'],
      ['staged', 'line 9'],
    ]);
    for (const diagnostic of runtime) {
      expect(diagnostic).toMatchObject({
        kind: 'warn',
        severity: 'warn',
        file: RUNTIME_BUILDERS.path,
      });
    }
    const { lines, thrown } = surface(analysis.manifest, true);
    expect(thrown?.message).not.toContain(RUNTIME_BUILDER_REFERENCE);
    expect(
      lines.filter((line) => line.includes(RUNTIME_BUILDER_REFERENCE))
    ).toHaveLength(3);
  });
});

describe('the shared build-strictness policy over a real analysis', () => {
  let analysis: Analysis;

  beforeAll(() => {
    analysis = analyze(false);
  });

  test('omitted and explicit false build strictness warn identically without failing', () => {
    const omitted = surface(analysis.manifest, undefined);
    const explicitFalse = surface(analysis.manifest, false);
    expect(omitted.thrown).toBeNull();
    expect(explicitFalse.thrown).toBeNull();
    expect(explicitFalse.lines).toEqual(omitted.lines);
    for (const expected of CLASSIFIED) {
      const lines = omitted.lines.filter((line) =>
        line.includes(expected.code)
      );
      expect(
        lines.filter((line) => namesComponent(line, expected.component)),
        expected.component
      ).toHaveLength(1);
    }
  });

  test('explicit true build strictness escalates every classified failure together and nothing else', () => {
    const { lines, thrown } = surface(analysis.manifest, true);
    expect(thrown).not.toBeNull();
    const message = thrown!.message;
    expect(message).toContain(
      `[animus] strict: ${CLASSIFIED.length} error diagnostic(s)`
    );
    for (const expected of CLASSIFIED) {
      expect(message).toContain(`${expected.code} — ${expected.component}:`);
    }
    for (const unclassified of ['LookalikeAxis', 'OutsideAxis']) {
      expect(
        lines.some((line) => namesComponent(line, unclassified)),
        unclassified
      ).toBe(true);
    }
  });

  test('a corpus of valid dynamic styling and pruned options passes explicit build strictness', () => {
    clearAnalysisCache();
    const { manifest, css } = runPipeline([
      SYSTEM,
      AXIS,
      {
        path: 'fixtures/policy-valid.tsx',
        source: `import { ds } from './policy-system';
import { TONES } from './policy-axis';
export const Tone = ds
  .styles({ cursor: 'move' })
  .variant({ prop: 'tone', defaultVariant: 'x', variants: TONES })
  .asElement('div');
export const Inset = ds
  .styles({ cursor: 'grab' })
  .props({ inset: { property: 'width', transform: (value) => value * 2 } })
  .asElement('div');
export const App = ({ inset, ...rest }) => <><Tone /><Inset inset={inset} {...rest} /></>;
`,
      },
    ]);
    assertNoUnresolvedTokens(css);
    expect(manifest.report.eliminated_details.length).toBeGreaterThan(0);
    expect(surface(manifest, true)).toEqual({ lines: [], thrown: null });
  });
});

describe('a configured transform rejected before registration', () => {
  const BASE = 4;
  const leaky = createTransform('leaky', (value) => Number(value) * BASE);
  const double = createTransform('double', (value) => Number(value) * 2);
  const configured = createSystem()
    .addGroup('probe', {
      leakyW: { property: 'height', transform: leaky },
      doubleW: { property: 'width', transform: double },
    })
    .build()
    .seal()
    .toConfig();
  let manifest: { diagnostics?: ManifestDiagnostic[] };

  beforeAll(() => {
    clearAnalysisCache();
    manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([
          {
            path: 'fixtures/policy-configured.tsx',
            source: `import { ds } from './setup';
export const Box = ds.styles({ leakyW: 8, doubleW: 8 }).asElement('div');
export const App = () => <Box />;
`,
          },
        ]),
        {
          propConfigJson: configured.propConfig,
          groupRegistryJson: configured.groupRegistry,
          transformSourcesJson: configured.transformSources,
        }
      )
    );
  });

  test('the rejection is classified with its identity, reason and alternative', () => {
    const rejected = forComponent(
      manifest.diagnostics ?? [],
      "createTransform('leaky')"
    );
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      kind: 'warn',
      code: 'animus.transform.configured-rejected',
      severity: 'error',
    });
    expect(rejected[0].message).toContain("Transform 'leaky'");
    expect(rejected[0].message).toContain("external symbol 'BASE'");
    expect(rejected[0].message).toContain('self-contained');
    expect(
      forComponent(manifest.diagnostics ?? [], "createTransform('double')")
    ).toEqual([]);
  });

  test('it warns by default and fails explicit build strictness', () => {
    expect(surface(manifest, undefined).thrown).toBeNull();
    expect(surface(manifest, false).thrown).toBeNull();
    expect(surface(manifest, true).thrown?.message).toContain(
      "animus.transform.configured-rejected — createTransform('leaky'):"
    );
  });
});

describe('a custom prop naming a transform that binds no configured definition', () => {
  const configured = createSystem()
    .addGroup('probe', {
      inset: {
        property: 'left',
        transform: createTransform('unit', (value) => `${value}px`),
      },
      lift: {
        property: 'top',
        transform: createTransform('unit', (value) => `${value}rem`),
      },
      wide: {
        property: 'width',
        transform: createTransform('double', (value) => Number(value) * 2),
      },
    })
    .build()
    .seal()
    .toConfig();
  let manifest: { diagnostics?: ManifestDiagnostic[] };

  beforeAll(() => {
    clearAnalysisCache();
    manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([
          {
            path: 'fixtures/policy-named.tsx',
            source: `import { ds } from './setup';
export const Named = ds
  .props({
    shared: { property: 'right', transform: 'double' },
    ambiguous: { property: 'bottom', transform: 'unit' },
    unknown: { property: 'margin', transform: 'nope' },
  })
  .asElement('div');
export const App = ({ v }) => <Named shared={v} ambiguous={v} unknown={v} />;
`,
          },
        ]),
        {
          propConfigJson: configured.propConfig,
          groupRegistryJson: configured.groupRegistry,
          transformSourcesJson: configured.transformSources,
        }
      )
    );
  });

  test('each unbound name warns once at its declaration', () => {
    const named = forComponent(manifest.diagnostics ?? [], 'Named');
    expect(named).toHaveLength(2);
    for (const diagnostic of named) {
      expect(diagnostic).toMatchObject({
        kind: 'warn',
        file: 'fixtures/policy-named.tsx',
      });
      expect(diagnostic.code).toBe('animus.props.unbound-transform-name');
      expect(diagnostic.severity).toBe('warn');
    }
    const messages = named.map((d) => d.message).sort();
    expect(messages[0]).toContain("custom prop 'ambiguous'");
    expect(messages[0]).toContain(
      "'unit', which 2 configured transforms carry"
    );
    expect(messages[1]).toContain("custom prop 'unknown'");
    expect(messages[1]).toContain(
      "'nope', which no configured transform carries"
    );
  });

  test('it warns under every build strictness without failing', () => {
    for (const strict of [undefined, false, true]) {
      const { lines, thrown } = surface(manifest, strict);
      expect(thrown).toBeNull();
      expect(
        lines.filter((line) => namesComponent(line, 'Named'))
      ).toHaveLength(2);
    }
  });
});
