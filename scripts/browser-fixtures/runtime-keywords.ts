/**
 * Runtime CSS-wide keywords through real output: a small project analyzed by
 * the built extraction engine, resolved by the runtime resolver, and rendered
 * with the CSS the engine emits. A resolver that stopped selecting keyword
 * classes, or a rule order that let a slot outrank a keyword class at a
 * breakpoint, changes a computed colour here.
 */
import {
  applyUnitFallback,
  buildDynamicPropConfig,
} from '../../packages/extract/pipeline/index';
import { createSystem, createTheme } from '../../packages/system/src/index';
import { resolveClasses } from '../../packages/system/src/runtime/resolveClasses';
import { analyzeFixture } from './analyze';

import type { FixtureCase, Probe } from './cases';

const RED = 'rgb(255, 0, 0)';
const GREEN = 'rgb(0, 128, 0)';
const BLUE = 'rgb(0, 0, 255)';
const BLACK = 'rgb(0, 0, 0)';
const INK = 'rgb(10, 20, 30)';

const KEYWORDS = [
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
] as const;

/**
 * Inside a parent painting red whose own transport variable holds blue, a
 * keyword class gives `color` the keyword's meaning, over the component's
 * green base. Through the inline variable the keyword acts on the variable
 * instead: `initial` leaves it invalid, so `color` inherits red, and the
 * others hand `color` the parent's blue.
 */
const EXPECTED = {
  initial: { keywordClass: BLACK, transport: RED },
  inherit: { keywordClass: RED, transport: BLUE },
  unset: { keywordClass: RED, transport: BLUE },
  revert: { keywordClass: RED, transport: BLUE },
  'revert-layer': { keywordClass: GREEN, transport: BLUE },
} satisfies Record<
  (typeof KEYWORDS)[number],
  { keywordClass: string; transport: string }
>;

const SOURCE = `import { ds } from './setup';
export const Box = ds.styles({ color: 'leaf' }).system({ probe: true }).asElement('div');
export const App = ({ n }) => <Box color={n} />;`;

function analyzeKeywordFixture() {
  const theme = createTheme()
    .addBreakpoints({ sm: 640 })
    .addColors({ ink: INK, leaf: GREEN })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('probe', { color: { property: 'color', scale: 'colors' } })
    .build()
    .seal()
    .toConfig();
  return {
    manifest: analyzeFixture({
      path: 'fixtures/keywords.tsx',
      source: SOURCE,
      theme,
      config,
    }),
    variableCss: theme.variableCss,
  };
}

export function runtimeKeywordCases(): FixtureCase[] {
  const { manifest, variableCss } = analyzeKeywordFixture();
  const box = manifest.components['fixtures/keywords.tsx::Box'];
  const dynamicPropConfig = buildDynamicPropConfig(manifest.dynamic_props);
  const { slotClass, varName } = dynamicPropConfig.color;
  const css = `${variableCss}\n${applyUnitFallback(manifest.css)}`;
  const render = (id: string, color: string | Record<string, string>) => {
    const { classes, dynamicStyle } = resolveClasses(
      box.class_name,
      { color },
      { systemPropNames: ['color'] },
      manifest.system_prop_map,
      dynamicPropConfig
    );
    const style = Object.entries(dynamicStyle ?? {})
      .map(([name, value]) => `${name}: ${value}`)
      .join('; ');
    return `<div id="${id}" class="${classes.join(' ')}" style="${style}"></div>`;
  };
  // The slot class written by hand with the keyword in its variable: what
  // the resolver did before it selected keyword classes.
  const transport = (id: string, keyword: string) =>
    `<div id="${id}" class="${box.class_name} ${slotClass}" style="${varName}: ${keyword}"></div>`;
  const colorProbe = (
    label: string,
    selector: string,
    expected: string
  ): Probe => ({ label, selector, property: 'color', expected });

  return [
    {
      name: 'a runtime CSS-wide keyword through the emitted CSS and the resolver',
      css,
      body: `<div style="color: ${RED}; ${varName}: ${BLUE}">${KEYWORDS.map(
        (keyword) =>
          render(`runtime-${keyword}`, keyword) +
          transport(`transport-${keyword}`, keyword)
      ).join('')}</div>`,
      probes: KEYWORDS.flatMap((keyword) => [
        colorProbe(
          `runtime ${keyword}`,
          `#runtime-${keyword}`,
          EXPECTED[keyword].keywordClass
        ),
        colorProbe(
          `${keyword} through the inline variable, as before the fix`,
          `#transport-${keyword}`,
          EXPECTED[keyword].transport
        ),
      ]),
    },
    {
      name: 'a responsive runtime value mixing keyword classes and the inline variable',
      css,
      // The wrapper's own breakpoint variable holds blue, so an `inherit`
      // written into that variable instead of a keyword class reads blue.
      body: `<div style="color: ${RED}; ${varName}-sm: ${BLUE}">${render(
        'keyword-then-slot',
        {
          _: 'inherit',
          sm: 'ink',
        }
      )}${render('slot-then-keyword', { _: 'ink', sm: 'inherit' })}</div>`,
      probes: [
        colorProbe(
          '{ _: inherit, sm: ink } at a wide viewport',
          '#keyword-then-slot',
          INK
        ),
        colorProbe(
          '{ _: ink, sm: inherit } at a wide viewport',
          '#slot-then-keyword',
          RED
        ),
      ],
    },
  ];
}
