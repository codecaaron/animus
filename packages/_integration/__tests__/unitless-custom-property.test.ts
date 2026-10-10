import { createElement, type ForwardRefExoticComponent } from 'react';

import { createComponent } from '@animus-ui/system/runtime';
import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { runPipeline } from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

/**
 * A number reaching a prop that writes only custom properties, with no unit
 * and no transform, keeps its unitless value and warns: at build time for a
 * literal, and in the runtime for a runtime value. Zero, a transformed value
 * and a key of the prop's scale do not warn, whatever value the key holds.
 */
test('a unitless number on a custom-property-only prop warns at build and at runtime, and stays unitless', () => {
  const { manifest, css } = runPipeline([
    {
      path: 'unitless.tsx',
      source: `import { ds } from '../setup';
export const Panel = ds
  .styles({ display: 'block' })
  .props({
    placeholderHeight: { property: '--placeholder-height' },
    gapVar: { property: '--gap', scale: { 1: 1, 2: '4px' } },
  })
  .asElement('div');
export const Sized = ds
  .props({ placeholderWidth: { property: '--placeholder-width', transform: (value) => value + 'px' } })
  .asElement('div');
export const App = () => (
  <>
    <Panel placeholderHeight={120} gapVar={1} />
    <Panel placeholderHeight={0} />
    <Sized placeholderWidth={40} />
  </>
);
export const Measured = ({ height }: { height: number }) => <Panel placeholderHeight={height} />;
`,
    },
  ]);
  assertNoUnresolvedTokens(css);
  expect(css).toContain('--placeholder-height: 120;');
  const warned = manifest.diagnostics
    .filter(
      (d: ManifestDiagnostic) =>
        d.code === 'animus.props.unitless-custom-property'
    )
    .map((d: ManifestDiagnostic) => [d.component, d.severity, d.dropped]);
  expect(warned).toEqual([['Panel', 'warn', '120']]);

  const replacement: string =
    manifest.components['unitless.tsx::Panel'].replacement;
  const [, className, config] =
    /createComponent\('div', '([^']+)', (\{.*\}), systemPropMap/.exec(
      replacement
    ) ?? [];
  const Panel: ForwardRefExoticComponent<any> = createComponent(
    'div',
    className,
    JSON.parse(config),
    {},
    {}
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const html = renderToString(
    createElement(Panel, { placeholderHeight: 75, gapVar: 1 })
  );
  expect(html).toMatch(/--animus-placeholder-height_\w+:75[;"]/);
  expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
    expect.stringContaining("prop 'placeholderHeight' writes the number 75"),
  ]);
  warn.mockRestore();
});

/**
 * Contract: a prop whose every custom property is registered with a numeric
 * syntax, `<integer>` or `<number>`, takes a number without a unit and warns
 * neither at build time nor in the runtime; a prop writing an undeclared
 * custom property, or a `currentVar` not registered with a numeric syntax,
 * still warns at both.
 */
test('a prop writing only properties registered with a numeric syntax takes a number without warning', () => {
  const propertyRecordsJson = JSON.stringify([
    {
      name: 'text-line-clamp',
      syntax: '<integer>',
      inherits: false,
      initialValue: '1',
      scales: [],
      home: 'theme',
      registered: true,
      legacy: true,
    },
    {
      name: 'text-tone',
      syntax: '<number>',
      inherits: false,
      initialValue: '0',
      scales: [],
      home: 'theme',
      registered: true,
      legacy: true,
    },
    {
      name: 'text-raw',
      syntax: '<length>',
      inherits: false,
      initialValue: '0px',
      scales: [],
      home: 'theme',
      registered: true,
      legacy: true,
    },
  ]);
  const { manifest, css } = runPipeline(
    [
      {
        path: 'clamp.tsx',
        source: `import { ds } from '../setup';
export const Text = ds
  .styles({ display: 'block' })
  .props({
    lineClamp: { property: '--text-line-clamp' },
    indent: { property: '--text-indent' },
    tone: { property: '--text-tone', currentVar: '--text-raw' },
    shade: { property: '--text-tone', currentVar: '--text-shade' },
  })
  .asElement('p');
export const App = () => <Text lineClamp={2} indent={3} tone={2} shade={2} />;
export const Measured = ({ lines }: { lines: number }) => <Text lineClamp={lines} indent={lines} tone={lines} shade={lines} />;
`,
      },
    ],
    { inputs: { propertyRecordsJson } }
  );
  assertNoUnresolvedTokens(css);
  expect(css).toContain('--text-line-clamp: 2;');
  const warned = manifest.diagnostics
    .filter(
      (d: ManifestDiagnostic) =>
        d.code === 'animus.props.unitless-custom-property'
    )
    .map((d: ManifestDiagnostic) => [
      d.component,
      d.message.split(' writes')[0],
    ]);
  expect(warned.sort()).toEqual([
    ['Text', "prop 'indent'"],
    ['Text', "prop 'shade'"],
    ['Text', "prop 'tone'"],
  ]);

  const replacement: string =
    manifest.components['clamp.tsx::Text'].replacement;
  const [, className, config] =
    /createComponent\('p', '([^']+)', (\{.*\}), systemPropMap/.exec(
      replacement
    ) ?? [];
  const Text: ForwardRefExoticComponent<any> = createComponent(
    'p',
    className,
    JSON.parse(config),
    {},
    {}
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  renderToString(
    createElement(Text, { lineClamp: 5, indent: 4, tone: 6, shade: 7 })
  );
  expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
    expect.stringContaining("prop 'indent' writes the number 4"),
    expect.stringContaining("prop 'shade' writes the number 7"),
    expect.stringContaining("prop 'tone' writes the number 6"),
  ]);
  warn.mockRestore();
});
