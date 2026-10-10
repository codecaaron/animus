import { createElement, type ForwardRefExoticComponent } from 'react';

import { createComponent } from '@animus-ui/system/runtime';
import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';

import { runPipeline } from './run-pipeline';

import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

/**
 * A number reaching a prop that writes only custom properties, with no unit
 * and no transform, keeps its unitless value and warns: at build time for a
 * literal, and in the runtime for a runtime value. Zero, a transformed value
 * and a scale key do not warn.
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
    gapVar: { property: '--gap', scale: { 1: '4px' } },
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
