import {
  applyUnitFallback,
  surfaceManifestDiagnostics,
} from '@animus-ui/extract/pipeline';
import { createSystem, createTheme, size } from '@animus-ui/system';
import { expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { analyzeProject } from './run-pipeline';

const ruleBody = (css: string, component: string) =>
  css.match(new RegExp(`\\.animus-${component}-\\w+ \\{([^}]*)\\}`))?.[1];

test.each([false, true])('negative theme tokens with emit=%s', (emit) => {
  const theme = createTheme()
    .addScale({
      name: 'space',
      values: { 4: '1rem', 40: '{space.4}', '-4': '2rem' },
      emit,
    })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('space', {
      mt: { property: 'marginTop', scale: 'space', negative: true },
      pt: { property: 'paddingTop', scale: 'space' },
    })
    .build()
    .seal()
    .toConfig();
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/negative-theme.tsx',
          source: `import { ds } from './setup';
export const Static = ds.styles({ mt: -40, pt: -40 }).asElement('div');
export const Exact = ds.styles({ mt: -4 }).asElement('div');
export const Box = ds.system({ space: true }).asElement('div');
export function App({ value }) { return <Box mt={value} pt={value} />; }`,
        },
      ]),
      {
        ...theme,
        propConfigJson: config.propConfig,
        groupRegistryJson: config.groupRegistry,
        devMode: true,
      }
    )
  );
  const css = applyUnitFallback(manifest.css);
  assertNoUnresolvedTokens(css);
  expect(css).toContain(
    emit ? 'margin-top: calc(var(--space-40) * -1);' : 'margin-top: -1rem;'
  );
  expect(css).toContain(
    emit ? 'margin-top: var(--space--4);' : 'margin-top: 2rem;'
  );
  expect(ruleBody(css, 'Static')).not.toContain('padding-top');
  expect(manifest.diagnostics).toContainEqual(
    expect.objectContaining({
      file: 'fixtures/negative-theme.tsx',
      component: 'Static',
      code: 'animus.props.strict-token-miss',
      message: expect.stringContaining("prop 'pt' value -40"),
    })
  );
  expect(manifest.dynamic_props.mt.negative).toBe(true);
  expect(manifest.dynamic_props.pt.negative).toBeUndefined();
  expect(manifest.dynamic_props.pt.strict).toBe(true);
  expect(manifest.dynamic_props.mt.scaleValues['40']).toBe(
    emit ? 'var(--space-40)' : '1rem'
  );
});

test('numeric inline scales retain their type through system and custom slots', () => {
  const config = createSystem()
    .addGroup('layout', {
      inset: {
        property: 'inset',
        scale: { half: 0.5, 1: 0.5 },
        negative: true,
        transform: size,
      },
      mx: {
        property: 'margin',
        properties: ['marginLeft', 'marginRight'],
        scale: { 1: 4 },
        negative: true,
      },
    })
    .build()
    .seal()
    .toConfig();
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/negative-inline.tsx',
          source: `import { ds } from './setup';
export const Half = ds.styles({ inset: 'half', mx: 1 }).asElement('div');
export const Negative = ds.styles({ inset: -1, mx: -1 }).asElement('div');
export const Box = ds.system({ layout: true }).asElement('div');
export const Custom = ds.props({
  offset: {
    property: 'inset', scale: { half: 0.5, 1: 0.5 }, negative: true,
    transform: (value) => typeof value === 'number' ? String(value * 100) + '%' : value,
  },
}).asElement('div');
export function App({ value }) { return <><Box inset={value} mx={value} /><Custom offset={value} /></>; }`,
        },
      ]),
      {
        propConfigJson: config.propConfig,
        groupRegistryJson: config.groupRegistry,
        transformSourcesJson: config.transformSources,
        devMode: true,
      }
    )
  );
  const css = applyUnitFallback(manifest.css);
  assertNoUnresolvedTokens(css);
  expect(css).toContain('inset: 50%;');
  expect(css).toContain('inset: -50%;');
  expect(css).toMatch(/margin-left:\s*4px;/);
  expect(css).toMatch(/margin-right:\s*-4px;/);
  expect(manifest.dynamic_props.inset.scaleValues).toEqual({
    half: 0.5,
    1: 0.5,
  });
  expect(manifest.dynamic_props.mx.scaleValues).toEqual({ 1: 4 });
  expect(
    manifest.components['fixtures/negative-inline.tsx::Custom'].replacement
  ).toContain('"scaleValues":{"1":0.5,"half":0.5}');
});

test('strict scale misses omit prop styling on every static path', () => {
  const theme = createTheme()
    .addBreakpoints({ sm: 640 })
    .addScale({ name: 'space', values: { 0: '0', 4: '1rem', 40: '2.5rem' } })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('space', {
      mt: { property: 'marginTop', scale: 'space', negative: true },
      pt: { property: 'paddingTop', scale: 'space' },
      gap: { property: 'gap', scale: 'space', strict: false },
      w: { property: 'width' },
    })
    .build()
    .seal()
    .toConfig();
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/strict-misses.tsx',
          source: `import { ds } from './setup';
export const Styled = ds.styles({ mt: 13, pt: { _: 4, sm: -13 }, gap: 13, w: 13 }).asElement('div');
export const Keyword = ds.styles({ mt: 'auto', pt: 'inherit' }).asElement('span');
export const Box = ds.system({ space: true }).asElement('p');
export const Custom = ds.props({ inset: { property: 'top', scale: { sm: '3rem' } }, gap: { property: 'rowGap' } }).asElement('i');
export function App({ value }) {
  return <><Custom gap={21} /><Box gap={21} /><Box mt={-13} pt={13} /><Box mt={-40} pt={4} /><Box pt={value} gap={value} /><Custom inset={4} /><Custom inset="sm" /><Custom inset={value} /></>;
}`,
        },
      ]),
      {
        ...theme,
        propConfigJson: config.propConfig,
        groupRegistryJson: config.groupRegistry,
        devMode: true,
      }
    )
  );
  const css = applyUnitFallback(manifest.css);
  assertNoUnresolvedTokens(css);
  expect(css).not.toMatch(/(margin|padding)-top:\s*-?13px/);
  expect(ruleBody(css, 'Styled')).not.toMatch(/margin-top|padding-top/);
  expect(ruleBody(css, 'Styled')).toMatch(/gap:\s*13px;/);
  expect(ruleBody(css, 'Styled')).toMatch(/width:\s*13px;/);
  expect(css).toMatch(/margin-top:\s*auto;/);
  expect(css).toMatch(/padding-top:\s*inherit;/);
  expect(css).toMatch(/margin-top:\s*-2\.5rem;/);
  expect(css).toMatch(/top:\s*3rem;/);
  expect(css).not.toMatch(/top:\s*4px/);
  expect(manifest.system_prop_map.mt).not.toHaveProperty('-13');
  expect(manifest.system_prop_map.mt).toHaveProperty('-40');
  expect(manifest.system_prop_map.pt).not.toHaveProperty('13');
  expect(manifest.system_prop_map).not.toHaveProperty('inset');
  expect(manifest.system_prop_map.gap).toHaveProperty('21');
  expect(manifest.dynamic_props.pt.strict).toBe(true);
  expect(manifest.dynamic_props.gap.strict).toBeUndefined();
  expect(
    manifest.components['fixtures/strict-misses.tsx::Custom'].replacement
  ).toContain('"strict":true');

  const misses = manifest.diagnostics.filter(
    (d: { code?: string }) => d.code === 'animus.props.strict-token-miss'
  );
  expect(
    misses.map((d: { component: string; message: string }) => [
      d.component,
      d.message.match(/prop '(\w+)' value (\S+)/)?.slice(1),
    ])
  ).toEqual([
    ['Styled', ['mt', '13']],
    ['Styled', ['pt', '{"_":4,"sm":-13}']],
    ['Box', ['mt', '-13']],
    ['Box', ['pt', '13']],
    ['Custom', ['inset', '4']],
  ]);
  for (const miss of misses) {
    expect(miss).toMatchObject({
      file: 'fixtures/strict-misses.tsx',
      kind: 'warn',
      severity: 'error',
    });
  }

  const warnings: string[] = [];
  surfaceManifestDiagnostics({ diagnostics: misses }, (line) =>
    warnings.push(line)
  );
  surfaceManifestDiagnostics(
    { diagnostics: misses },
    (line) => warnings.push(line),
    { strict: false }
  );
  expect(warnings).toHaveLength(misses.length * 2);
  expect(() =>
    surfaceManifestDiagnostics({ diagnostics: misses }, () => {}, {
      strict: true,
    })
  ).toThrow(/strict: 5 error diagnostic/);
});

const strictSystem = () => {
  const theme = createTheme()
    .addBreakpoints({ sm: 640 })
    .addScale({ name: 'space', values: { 0: '0', 4: '1rem', 40: '2.5rem' } })
    .addColors({ red: '#f00', ink: '#111' })
    .declareContextualVars({ colors: ['current-bg'] })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('space', {
      m: { property: 'margin', scale: 'space', negative: true },
      p: { property: 'padding', scale: 'space' },
      w: { property: 'width', scale: 'space' },
      color: { property: 'color', scale: 'colors' },
    })
    .build()
    .seal()
    .toConfig();
  return {
    ...theme,
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
    devMode: true,
  };
};

type Diagnostic = {
  code?: string;
  file: string;
  component: string;
  message: string;
};
const missesOf = (manifest: { diagnostics: Diagnostic[] }) =>
  manifest.diagnostics
    .filter((d) => d.code === 'animus.props.strict-token-miss')
    .map((d) => [
      d.file,
      d.component,
      d.message.match(/prop '(\w+)' value (\S+)/)?.slice(1),
    ]);

test('identifier-shaped values must name a token or a keyword of the property', () => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/keywords.tsx',
          source: `import { ds } from './setup';
export const K = ds.styles({ m: 'auto', p: 'inherit', color: 'currentColor', w: 'fit-content' }).asElement('div');
export const T = ds.styles({ color: 'red', p: 'revert-layer' }).asElement('b');
export const V = ds.styles({ color: 'current-bg' }).asElement('i');
export const U = ds.styles({ p: 'lg', color: 'banana', m: 'aliceblue' }).asElement('span');
export const E = ds.styles({ w: '1e2px', p: '1e2cqi', m: '1.px' }).asElement('em');
export const Box = ds.system({ space: true }).asElement('p');
export function App({ value }) { return <><K /><T /><V /><U /><E /><Box p={value} color={value} /></>; }`,
        },
      ]),
      strictSystem()
    )
  );
  const css = applyUnitFallback(manifest.css);
  expect(ruleBody(css, 'K')).toMatch(/margin: auto;[\s\S]*padding: inherit;/);
  expect(ruleBody(css, 'K')).toMatch(/color: currentColor;/);
  expect(ruleBody(css, 'K')).toMatch(/width: fit-content;/);
  expect(ruleBody(css, 'T')).toMatch(/color: var\(--color-red\);/);
  expect(ruleBody(css, 'T')).toMatch(/padding: revert-layer;/);
  expect(ruleBody(css, 'V')).toMatch(/color: var\(--current-bg\);/);
  expect(ruleBody(css, 'U')).toBeUndefined();
  expect(ruleBody(css, 'E')).toMatch(/width:\s*1e2px;/);
  expect(ruleBody(css, 'E')).toMatch(/padding:\s*1e2cqi;/);
  expect(ruleBody(css, 'E')).not.toMatch(/margin/);
  expect(missesOf(manifest)).toEqual(
    expect.arrayContaining([
      ['fixtures/keywords.tsx', 'E', ['m', '"1.px"']],
      ['fixtures/keywords.tsx', 'U', ['m', '"aliceblue"']],
      ['fixtures/keywords.tsx', 'U', ['p', '"lg"']],
      ['fixtures/keywords.tsx', 'U', ['color', '"banana"']],
    ])
  );
  expect(missesOf(manifest)).toHaveLength(4);
  expect(manifest.dynamic_props.p.keywords).toEqual(
    expect.arrayContaining(['inherit', 'revert-layer'])
  );
  expect(manifest.dynamic_props.p.keywords).not.toContain('auto');
  expect(manifest.dynamic_props.color.keywords).toEqual(
    expect.arrayContaining(['currentColor', 'transparent', 'inherit'])
  );
  expect(manifest.dynamic_props.color.scaleValues['current-bg']).toBe(
    'var(--current-bg)'
  );
});

test.each([false, true])(
  'a custom value resolves through its own component config (reversed=%s)',
  (reversed) => {
    const files = [
      {
        path: 'fixtures/own-a.tsx',
        source: `import { ds } from './setup';
export const A = ds.props({ size: { property: 'width', scale: { sm: '1rem' } } }).asElement('div');
export const UseA = () => <><A size={13} /><A size="sm" /></>;`,
      },
      {
        path: 'fixtures/own-b.tsx',
        source: `import { ds } from './setup';
export const B = ds.props({ size: { property: 'height' } }).asElement('div');
export const UseB = () => <><B size={13} /><B size="sm" /></>;`,
      },
    ];
    const manifest = JSON.parse(
      analyzeProject(
        JSON.stringify(reversed ? files.reverse() : files),
        strictSystem()
      )
    );
    const css = applyUnitFallback(manifest.css);
    expect(css).toMatch(/width:\s*1rem;/);
    expect(css).toMatch(/height:\s*13px;/);
    expect(css).toMatch(/height:\s*sm;/);
    expect(css).not.toMatch(/width:\s*(13px|sm)|height:\s*1rem/);
    const map = (id: string) => {
      const replacement: string = manifest.components[id].replacement;
      const json = replacement.match(/"customPropMap":(\{[^]*?\}\})/)?.[1];
      return json ? JSON.parse(json) : undefined;
    };
    expect(Object.keys(map('fixtures/own-a.tsx::A').size)).toEqual(['sm']);
    expect(Object.keys(map('fixtures/own-b.tsx::B').size).sort()).toEqual([
      '13',
      'sm',
    ]);
    expect(missesOf(manifest)).toEqual([
      ['fixtures/own-a.tsx', 'A', ['size', '13']],
    ]);
  }
);

test('an inherited variant miss is reported once, at its authored declaration', () => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/inherit-parent.tsx',
          source: `import { ds } from './setup';
export const Parent = ds.styles({ display: 'block' }).variant({ prop: 'size', variants: { sm: { p: '12px' }, md: { p: 4 } } }).asElement('div');`,
        },
        {
          path: 'fixtures/inherit-child.tsx',
          source: `import { Parent } from './inherit-parent';
export const Child = Parent.extend().variant({ prop: 'size', variants: { lg: { p: 40 } } }).asElement('div');
export const Other = Parent.extend().variant({ prop: 'size', variants: { lg: { m: '9px' } } }).asElement('div');`,
        },
        {
          path: 'fixtures/inherit-grand.tsx',
          source: `import { Child } from './inherit-child';
import { Other } from './inherit-child';
export const Grand = Child.extend().variant({ prop: 'size', variants: { xl: { p: 0 } } }).asElement('div');
export const App = () => <><Grand size="sm" /><Other size="lg" /></>;`,
        },
      ]),
      strictSystem()
    )
  );
  expect(missesOf(manifest)).toEqual([
    ['fixtures/inherit-parent.tsx', 'Parent', ['p', '"12px"']],
    ['fixtures/inherit-child.tsx', 'Other', ['m', '"9px"']],
  ]);
  const css = applyUnitFallback(manifest.css);
  expect(css).not.toMatch(/padding:\s*12px|margin:\s*9px/);
  expect(css).toMatch(/Grand-\w+--size-md \{\s*padding:\s*1rem;/);
  expect(css).toMatch(/Grand-\w+--size-xl \{\s*padding:\s*0(px)?;/);
});

test('custom props reached only through spreads keep their own runtime config', () => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/spread-owner.tsx',
          source: `import { ds } from './setup';
export const C = ds.props({ p: { property: 'padding', scale: { sm: '1px' } } }).asElement('div');
export const S = ds.props({ q: { property: 'padding', scale: { sm: '2px' } } }).asElement('div');
export const Box = ds.system({ space: true }).asElement('p');
export function Wrap(props) { return <C {...props} />; }
export const App = (props) => <><C {...props} /><Wrap p="sm" /><Box p={8} /><S q="sm" /></>;`,
        },
      ]),
      strictSystem()
    )
  );
  const replacement = (id: string): string =>
    manifest.components[`fixtures/spread-owner.tsx::${id}`].replacement;
  expect(replacement('C')).toMatch(
    /"customDynamicConfig":\{"p":\{[^}]*"strict":true[^}]*"scaleValues":\{"sm":"1px"\}/
  );
  expect(replacement('C')).toMatch(/"customPropMap":\{"p":\{\}/);
  expect(replacement('S')).not.toContain('customDynamicConfig');
});

test('equally named custom props of components in one file keep their own classes', () => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/same-file.tsx',
          source: `import { ds } from './setup';
export const A = ds.props({ size: { property: 'width', scale: { sm: '1rem' } } }).asElement('div');
export const B = ds.props({ size: { property: 'height', scale: { sm: '2rem' } } }).asElement('div');
export const App = () => <><A size="sm" /><B size="sm" /></>;`,
        },
      ]),
      strictSystem()
    )
  );
  const css = applyUnitFallback(manifest.css);
  expect(css).toMatch(/width:\s*1rem;/);
  expect(css).toMatch(/height:\s*2rem;/);
  for (const id of ['A', 'B']) {
    expect(
      manifest.components[`fixtures/same-file.tsx::${id}`].replacement
    ).toMatch(/"customPropMap":\{"size":\{"sm":"[\w-]+"\}\}/);
  }
});

test('a custom value on an ambiguous binding reaches every candidate owner', () => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/ambiguous-a.tsx',
          source: `import { ds } from './setup';
export const Box = ds.styles({ display: 'block' }).asElement('div');`,
        },
        {
          path: 'fixtures/ambiguous-b.tsx',
          source: `import { ds } from './setup';
export const Box = ds.props({ size: { property: 'height', scale: { sm: '2rem' } } }).asElement('div');`,
        },
        {
          path: 'fixtures/ambiguous-use.tsx',
          source: `export const App = () => <Box size="sm" />;`,
        },
      ]),
      strictSystem()
    )
  );
  expect(applyUnitFallback(manifest.css)).toMatch(/height:\s*2rem;/);
  expect(
    manifest.components['fixtures/ambiguous-b.tsx::Box'].replacement
  ).toMatch(/"customPropMap":\{"size":\{"sm":"[\w-]+"\}\}/);
});

test('an extension keeps its own miss inside a partially overridden responsive value', () => {
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([
        {
          path: 'fixtures/partial-parent.tsx',
          source: `import { ds } from './setup';
export const Parent = ds.styles({ display: 'block' }).variant({ prop: 'size', variants: { sm: { p: { _: 4, sm: '12px' } } } }).asElement('div');`,
        },
        {
          path: 'fixtures/partial-child.tsx',
          source: `import { Parent } from './partial-parent';
export const Child = Parent.extend().variant({ prop: 'size', variants: { sm: { p: { _: '9px' } } } }).asElement('div');
export const App = () => <Child size="sm" />;`,
        },
      ]),
      strictSystem()
    )
  );
  const misses = manifest.diagnostics.filter(
    (d: Diagnostic) => d.code === 'animus.props.strict-token-miss'
  );
  expect(misses.map((d: Diagnostic) => [d.file, d.component])).toEqual([
    ['fixtures/partial-parent.tsx', 'Parent'],
    ['fixtures/partial-child.tsx', 'Child'],
  ]);
  expect(misses[1].message).toContain('("9px" at _)');
});
