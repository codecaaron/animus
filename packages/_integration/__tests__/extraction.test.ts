import {
  applyUnitFallback,
  buildSystemPropsModule,
} from '@animus-ui/extract/pipeline';
import { createSystem, createTransform } from '@animus-ui/system';
import { layout } from '@animus-ui/system/groups';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { readFixtureFile, readFixtureFiles } from '../fixtures/read-fixtures';
import { config } from '../fixtures/setup';
import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import {
  analyzeProject,
  clearAnalysisCache,
  runPipeline,
} from './run-pipeline';

const COMPONENTS = join(__dirname, '..', 'fixtures', 'components');

beforeAll(() => {
  clearAnalysisCache();
});

describe('variant resolution', () => {
  const entry = readFixtureFile(COMPONENTS, 'button.tsx');
  const { css } = runPipeline([entry]);

  test('base styles extract in @layer base', () => {
    expect(css).toContain('@layer anm-base');
    expect(css).toContain('display: inline-flex');
    expect(css).toContain('cursor: pointer');
  });

  test('variant styles in @layer variants', () => {
    expect(css).toContain('@layer anm-variants');
  });

  test('state styles in @layer states', () => {
    expect(css).toContain('@layer anm-states');
    expect(css).toContain('opacity');
  });

  test.each([
    ['small', '0.875rem'],
    ['medium', '1rem'],
    ['large', '1.25rem'],
  ] as const)(
    'size variant "%s" resolves fontSize to %s',
    (_size, expectedRem) => {
      expect(css).toContain(expectedRem);
    }
  );

  test.each([
    ['primary', 'var(--color-primary)'],
    ['secondary', 'var(--color-secondary)'],
  ] as const)('intent variant "%s" resolves to %s', (_intent, expectedVar) => {
    expect(css).toContain(expectedVar);
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});

describe('compound resolution', () => {
  const entry = readFixtureFile(COMPONENTS, 'compounds.tsx');
  const { css } = runPipeline([entry]);

  test('compound rules in @layer compounds', () => {
    expect(css).toContain('@layer anm-compounds');
    expect(css).toContain('--compound-0');
    expect(css).toContain('--compound-1');
  });

  test('compound 0: size:small + intent:danger → fontWeight: 700', () => {
    expect(css).toContain('font-weight: 700');
  });

  test('compound 1: size:large + intent:info → borderRadius resolved', () => {
    expect(css).toMatch(/compound-1[\s\S]*?border-radius:/);
  });

  test.each([
    ['primary', 'var(--color-primary)'],
    ['secondary', 'var(--color-secondary)'],
    ['background', 'var(--color-background)'],
  ] as const)('intent "%s" resolves to %s', (_intent, expectedVar) => {
    expect(css).toContain(expectedVar);
  });

  test.each([
    [14, '0.875rem'],
    [16, '1rem'],
  ] as const)('fontSize %i resolves to %s via scale', (_size, expectedRem) => {
    expect(css).toContain(expectedRem);
  });

  test.each([
    [4, '0.25rem'],
    [8, '0.5rem'],
  ] as const)('px %i resolves to %s via space scale', (_px, expectedRem) => {
    expect(css).toContain(expectedRem);
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});

describe('transform resolution', () => {
  test('evaluates the callback of a configured transform in Rust', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const doubling = createSystem()
      .addProps({
        width: {
          property: 'width',
          transform: createTransform(
            'size',
            (value) => `${Number(value) * 2}px`
          ),
        },
      })
      .build()
      .seal()
      .toConfig();
    const manifestJson = analyzeProject(JSON.stringify([entry]), {
      propConfigJson: doubling.propConfig,
      groupRegistryJson: doubling.groupRegistry,
      transformSourcesJson: doubling.transformSources,
    });

    const manifest = JSON.parse(manifestJson);
    const rawCss: string = manifest.css || '';

    expect(rawCss).toContain('width: 8px');
    expect(rawCss).not.toContain('__TRANSFORM__');
  });

  test('a same-named project declaration does not replace the configured transform', () => {
    const entry = readFixtureFile(COMPONENTS, 'transforms.tsx');
    const manifest = JSON.parse(
      analyzeProject(JSON.stringify([entry]), {
        transformSourcesJson: config.transformSources,
      })
    );

    expect(manifest.css).toContain('width: 4px');
    expect(manifest.css).not.toContain('width: 8px');
  });
});

describe('configured size transform', () => {
  // Inline rather than under fixtures/components, which is also the parity corpus.
  const entry = {
    path: 'fixtures/sizes.tsx',
    source: `import { ds } from './setup';
export const Expressions = ds.styles({
  maxHeight: 'min(320px, 50vh)',
  minWidth: 'max(10rem, 25%)',
  width: 'clamp(16rem, 50vw, 40rem)',
  maxWidth: 'min(max(200px, 20vw), 640px)',
  height: 'var(--size-12, 480px)',
  minHeight: 'var(--space-2)',
}).asElement('div');
export const Scalars = ds.styles({
  width: 0.5,
  height: 24,
  minHeight: '10',
  maxWidth: '1.5rem',
  minWidth: 'auto',
  top: '+10',
  left: '+.5',
  maxHeight: '1.',
}).asElement('span');
export const App = () => (
  <>
    <Expressions />
    <Scalars />
  </>
);
`,
  };

  const css = applyUnitFallback(
    JSON.parse(
      analyzeProject(JSON.stringify([entry]), {
        transformSourcesJson: config.transformSources,
      })
    ).css ?? ''
  );

  test.each([
    'max-height: min(320px, 50vh);',
    'min-width: max(10rem, 25%);',
    'width: clamp(16rem, 50vw, 40rem);',
    'max-width: min(max(200px, 20vw), 640px);',
    'height: var(--size-12, 480px);',
    'min-height: var(--space-2);',
  ])('emits the complete expression: %s', (declaration) => {
    expect(css).toContain(declaration);
  });

  test.each([
    'width: 50%;',
    'height: 24px;',
    'min-height: 10px;',
    'max-width: 1.5rem;',
    'min-width: auto;',
    'top: 10px;',
    'left: 50%;',
    'max-height: 100%;',
  ])('keeps scalar conversion: %s', (declaration) => {
    expect(css).toContain(declaration);
  });
});

describe('configured transform admission', () => {
  const BASE = 4;
  const localRem = createTransform(
    'localRem',
    (value) => `${Number(value) / BASE}rem`
  );
  function identRemFn(value: string | number) {
    return `${Number(value) / BASE}rem`;
  }
  const identRem = createTransform('identRem', identRemFn);
  // Parses as sloppy script only; the runtime module is strict.
  const sloppy = createTransform(
    'sloppy',
    // SAFETY: the constructed function takes one value and returns a string;
    // only its source text matters here, and admission must reject it.
    Function('value', 'var interface = 1; return value + 010;') as (
      value: string | number
    ) => string
  );
  const quarter = createTransform(
    'quarter',
    (value) => `${Number(value) / 4}rem`
  );
  const SCALE = new Map([['sm', '4px']]);
  const WIDE = '20rem';
  const nestRem = createTransform('nestRem', (value) => {
    const toRem = (n: number) => `${n / BASE}rem`;
    return toRem(Number(value));
  });
  const lookup = createTransform(
    'lookup',
    (value) => SCALE?.get(String(value)) ?? value
  );
  const switchT = createTransform('switchT', (value) => {
    switch (value) {
      case 'wide':
        return WIDE;
      default:
        return value;
    }
  });
  const svgUrl = createTransform(
    'svgUrl',
    (value) => `url("data:image/svg+xml,${encodeURIComponent(String(value))}")`
  );
  const tokens = createTransform('tokens', (value) =>
    [...new Set(String(value).split(' '))].join(' ')
  );
  const u8 = createTransform(
    'u8',
    (v) => `${new Uint8Array([Number(v)])[0] + 1}px`
  );
  const prox = createTransform(
    'prox',
    (v) => new Proxy({}, { get: () => `${Number(v) + 2}px` }).x
  );
  const errName = createTransform(
    'errName',
    (v) => `${new SyntaxError(String(v)).name}-${v}`
  );
  const esc = createTransform('esc', (v) => escape(String(v)));
  const admissionConfig = createSystem()
    .addGroup('probe', {
      width: layout.width,
      localW: { property: 'height', transform: localRem },
      identW: { property: 'minHeight', transform: identRem },
      sloppyW: { property: 'minWidth', transform: sloppy },
      quarterW: { property: 'maxWidth', transform: quarter },
      nestW: { property: 'paddingTop', transform: nestRem },
      lookupW: { property: 'paddingLeft', transform: lookup },
      switchW: { property: 'paddingRight', transform: switchT },
      bgImg: { property: 'backgroundImage', transform: svgUrl },
      gta: { property: 'gridTemplateAreas', transform: tokens },
      u8W: { property: 'rowGap', transform: u8 },
      proxW: { property: 'columnGap', transform: prox },
      errA: { property: 'gridArea', transform: errName },
      escF: { property: 'fontFamily', transform: esc },
    })
    .build()
    .seal()
    .toConfig();
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/admission.tsx',
          source: `import { ds } from './setup';
export const Box = ds.styles({ width: 0.5, localW: 8, identW: 8, sloppyW: 8, quarterW: 8, nestW: 8, lookupW: 'sm', switchW: 'wide', bgImg: '<svg/>', gta: 'a a b', u8W: 8, proxW: 8, errA: 'a', escF: 'a b' }).asElement('div');
export const App = () => <Box />;
`,
        },
      ]),
      {
        propConfigJson: admissionConfig.propConfig,
        groupRegistryJson: admissionConfig.groupRegistry,
        transformSourcesJson: admissionConfig.transformSources,
      }
    )
  );
  const css = applyUnitFallback(manifest.css);
  const admissionProps: Record<
    string,
    { transform?: string; transformId?: string }
  > = JSON.parse(admissionConfig.propConfig);
  const readableName: Record<string, string> = Object.fromEntries(
    Object.values(admissionProps).flatMap(({ transform, transformId }) =>
      transform && transformId ? [[transformId, transform]] : []
    )
  );

  test('admits only self-contained strict-mode configured sources', () => {
    expect(
      Object.keys(manifest.admitted_transforms)
        .map((id) => readableName[id])
        .sort()
    ).toEqual([
      'errName',
      'esc',
      'prox',
      'quarter',
      'size',
      'svgUrl',
      'tokens',
      'u8',
    ]);
  });

  test.each([
    ['localRem', "external symbol 'BASE'"],
    ['identRem', "external symbol 'BASE'"],
    ['sloppy', 'strict-mode'],
    ['nestRem', "external symbol 'BASE'"],
    ['lookup', "external symbol 'SCALE'"],
    ['switchT', "external symbol 'WIDE'"],
  ])('rejects %s with a diagnostic naming it', (name, reason) => {
    const messages = manifest.diagnostics
      .filter(
        (d: { component: string; kind: string }) =>
          d.kind === 'warn' && d.component === `createTransform('${name}')`
      )
      .map((d: { message: string }) => d.message);
    expect(messages.join('\n')).toContain(`Transform '${name}'`);
    expect(messages.join('\n')).toContain(reason);
  });

  test('rejected sources are never evaluated and fall back to the raw value', () => {
    expect(JSON.stringify(manifest.diagnostics)).not.toContain(
      'BASE is not defined'
    );
    expect(css).toMatch(/[^-]height:\s*8px;/);
    expect(css).toMatch(/min-height:\s*8px;/);
    expect(css).toMatch(/min-width:\s*8px;/);
    expect(css).toMatch(/max-width:\s*2rem;/);
    expect(css).toMatch(/[^-]width:\s*50%;/);
    expect(css).toMatch(/padding-top:\s*8px;/);
    expect(css).toMatch(/padding-left:\s*sm;/);
    expect(css).toMatch(/padding-right:\s*wide;/);
  });

  test('standard intrinsics evaluate in static CSS', () => {
    expect(css).toContain(
      'background-image: url("data:image/svg+xml,%3Csvg%2F%3E");'
    );
    expect(css).toContain('grid-template-areas: a b;');
    expect(css).toMatch(/row-gap:\s*9px;/);
    expect(css).toMatch(/column-gap:\s*10px;/);
    expect(css).toMatch(/grid-area:\s*SyntaxError-a;/);
    expect(css).toMatch(/font-family:\s*a%20b;/);
  });

  test('the runtime registry holds exactly the admitted callables', async () => {
    const source = buildSystemPropsModule({
      systemPropMapJson: '{}',
      groupRegistryJson: '{}',
      dynamicProps: {},
      admittedTransforms: manifest.admitted_transforms,
      typedSystemProps: manifest.typed_system_props,
    });
    const registry: Record<string, (value: string | number) => string> = (
      await import(`data:text/javascript,${encodeURIComponent(source)}`)
    ).transforms;
    const transforms = Object.fromEntries(
      Object.entries(registry).map(([id, fn]) => [readableName[id], fn])
    );

    expect(Object.keys(transforms).sort()).toEqual([
      'errName',
      'esc',
      'prox',
      'quarter',
      'size',
      'svgUrl',
      'tokens',
      'u8',
    ]);
    expect(transforms.u8(3)).toBe('4px');
    expect(transforms.prox(3)).toBe('5px');
    expect(transforms.errName('b')).toBe('SyntaxError-b');
    expect(transforms.esc('c d')).toBe('c%20d');
    expect(transforms.quarter(8)).toBe('2rem');
    expect(transforms.svgUrl('<b/>')).toBe(
      'url("data:image/svg+xml,%3Cb%2F%3E")'
    );
    expect(transforms.tokens('x x y')).toBe('x y');
    expect(transforms.size(0.375)).toBe('37.5%');
  });
});

describe('a callable inherited and rebound through extend()', () => {
  const triple = createTransform('size', (v) => `${Number(v) * 3}px`);
  const parent = createSystem()
    .addProps({ width: { property: 'width', transform: triple } })
    .build()
    .seal();
  const child = createSystem()
    .extend(parent)
    .addProps({ height: { property: 'height', transform: triple } })
    .build()
    .seal()
    .toConfig();
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/rebound.tsx',
          source: `import { ds } from './setup';
export const Box = ds.styles({ width: 2, height: 4 }).asElement('div');
export const Tag = ds.props({ inset: { property: 'left', transform: 'size' } }).asElement('span');
export const App = () => <><Box /><Tag inset={5} /></>;
`,
        },
      ]),
      {
        propConfigJson: child.propConfig,
        groupRegistryJson: child.groupRegistry,
        transformSourcesJson: child.transformSources,
      }
    )
  );

  test('both props and a component naming it share one definition', async () => {
    expect(Object.keys(manifest.admitted_transforms)).toHaveLength(1);
    expect(manifest.css).toContain('width: 6px');
    expect(manifest.css).toContain('height: 12px');
    expect(manifest.css).toContain('left: 15px');
    expect(manifest.diagnostics).toEqual([]);

    const source = buildSystemPropsModule({
      systemPropMapJson: '{}',
      groupRegistryJson: '{}',
      dynamicProps: {},
      admittedTransforms: manifest.admitted_transforms,
      typedSystemProps: manifest.typed_system_props,
    });
    const registry: Record<string, (value: number) => string> = (
      await import(`data:text/javascript,${encodeURIComponent(source)}`)
    ).transforms;
    const callables = Object.values(registry);
    expect(callables).toHaveLength(1);
    expect(callables[0](7)).toBe('21px');
  });
});

describe('responsive extraction', () => {
  test('produces @media queries with correct breakpoint values', () => {
    const entry = readFixtureFile(COMPONENTS, 'layout.tsx');
    const { css } = runPipeline([entry]);

    expect(css).toContain('@media');
    expect(css).toContain('768px');
  });

  test('no raw unresolved tokens in responsive output', () => {
    const entry = readFixtureFile(COMPONENTS, 'layout.tsx');
    const { css } = runPipeline([entry]);
    assertNoUnresolvedTokens(css);
  });
});

describe('multi-file extraction', () => {
  test('extracts all components when given multiple files', () => {
    const entries = readFixtureFiles(COMPONENTS);
    const { manifest, css } = runPipeline(entries);

    expect(manifest.report.components_extracted).toBeGreaterThan(1);
    expect(css).toContain('@layer');
    expect(css.length).toBeGreaterThan(100);
  });

  test('no raw unresolved tokens in multi-file output', () => {
    const entries = readFixtureFiles(COMPONENTS);
    const { css } = runPipeline(entries);
    assertNoUnresolvedTokens(css);
  });
});

describe('usage', () => {
  test('a JSX element inside an attribute value counts as a use', () => {
    const { css } = runPipeline([
      {
        path: 'attribute-jsx.tsx',
        source: `import { ds } from '../setup';

const R = ds
  .styles({ display: 'block' })
  .variant({ prop: 'tone', defaultVariant: 'a', variants: { a: { width: '1.5px' }, b: { width: '2.5px' } } })
  .asElement('span');
const B = ds.styles({ display: 'block' }).system({ space: true }).asElement('div');
const Frame = ({ preview }) => <div>{preview}</div>;

export const App = () => (
  <>
    <R tone="a" />
    <Frame preview={<><R tone="b" /><B p={8} /></>} />
  </>
);
`,
      },
    ]);
    expect(css).toContain('width: 2.5px');
    expect(css).toContain('padding: 0.5rem');
  });

  test('a class resolver called through .attrs keeps its custom-prop slots', () => {
    const { css } = runPipeline([
      {
        path: 'resolver-attrs.tsx',
        source: `import { ds } from '../setup';

const tinted = ds
  .styles({ display: 'block' })
  .props({ tint: { property: 'color', scale: 'colors' } })
  .asClass();

export const App = ({ tint }) => <div {...tinted.attrs({ tint })} />;
`,
      },
    ]);
    expect(css).toContain('var(--animus-tint');
  });
});
