import {
  applyUnitFallback,
  buildDynamicPropConfig,
} from '@animus-ui/extract/pipeline';
import { createSystem, createTheme } from '@animus-ui/system';
import { describe, expect, test } from 'vitest';

import { resolveClasses } from '../../system/src/runtime/resolveClasses';
import { analyzeProject } from './run-pipeline';

/**
 * A CSS-wide keyword passed at runtime must render as the same keyword
 * written statically. Through the inline variable it would act on the
 * variable: `inherit` would take the parent's `--animus-p_`, not its padding.
 */
const KEYWORDS = [
  'initial',
  'inherit',
  'unset',
  'revert',
  'revert-layer',
] as const;

const keywordSystem = () => {
  const theme = createTheme()
    .addBreakpoints({ sm: 640 })
    .addScale({ name: 'space', values: { 4: '1rem' } })
    .addColors({ ink: '#111' })
    .declareContextualVars({ colors: ['current-bg'] })
    .build()
    .serialize();
  const config = createSystem()
    .addGroup('probe', {
      p: { property: 'padding', scale: 'space' },
      bg: {
        property: 'backgroundColor',
        scale: 'colors',
        currentVar: '--current-bg',
      },
    })
    .build()
    .seal()
    .toConfig();
  return {
    ...theme,
    propConfigJson: config.propConfig,
    groupRegistryJson: config.groupRegistry,
  };
};

function analyze(render: string) {
  const source = `import { ds } from './setup';
export const Box = ds.system({ probe: true }).asElement('div');
export const App = ({ n }) => ${render};`;
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'fixtures/keywords.tsx', source }]),
      keywordSystem()
    )
  );
  return { manifest, css: applyUnitFallback(manifest.css) };
}

/** The class's rule, with the media query that wraps it, if any. */
function ruleOf(css: string, cls: string): string {
  const rule = new RegExp(`(@media[^{]*\\{\\s*)?\\.${cls} \\{[^}]*\\}`).exec(
    css
  )?.[0];
  if (rule === undefined) throw new Error(`no rule for .${cls}:\n${css}`);
  return rule.replace(/\s+/g, ' ');
}

const runtime = analyze('<Box p={n} bg={n} />');
const resolveAtRuntime = (props: Parameters<typeof resolveClasses>[1]) =>
  resolveClasses(
    'animus-Box',
    props,
    { systemPropNames: ['p', 'bg'] },
    runtime.manifest.system_prop_map,
    buildDynamicPropConfig(runtime.manifest.dynamic_props)
  );

describe.each(KEYWORDS)('runtime %s', (keyword) => {
  test('selects the class and rule a static write emits', () => {
    const statics = analyze(`<Box p="${keyword}" bg="${keyword}" />`);
    const resolved = resolveAtRuntime({ p: keyword, bg: keyword });

    expect(resolved.dynamicStyle).toBeUndefined();
    for (const prop of ['p', 'bg']) {
      const cls = statics.manifest.system_prop_map[prop][keyword];
      expect(resolved.classes).toContain(cls);
      expect(ruleOf(runtime.css, cls)).toBe(ruleOf(statics.css, cls));
    }
    expect(
      ruleOf(runtime.css, statics.manifest.system_prop_map.bg[keyword])
    ).toContain(`--current-bg: ${keyword};`);
  });

  test('selects the breakpoint class a static responsive write emits', () => {
    const statics = analyze(`<Box p={{ sm: '${keyword}' }} />`);
    const resolved = resolveAtRuntime({ p: { _: 4, sm: keyword } });

    const cls = statics.manifest.system_prop_map.p[`sm:${keyword}`];
    expect(resolved.classes).toContain(cls);
    expect(ruleOf(runtime.css, cls)).toBe(ruleOf(statics.css, cls));
    expect(ruleOf(runtime.css, cls)).toContain('@media (min-width: 640px)');
    expect(resolved.dynamicStyle).toEqual({ '--animus-p_': '1rem' });
  });
});

test('a transform-bound custom prop gets untransformed keyword classes under typed keys', () => {
  const source = `import { ds } from './setup';
export const Bar = ds.props({ w: { property: 'width', transform: (v) => v + 'px' } }).asElement('div');
export const App = ({ n }) => <Bar w={n} />;`;
  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'fixtures/keywords.tsx', source }]),
      keywordSystem()
    )
  );
  const replacement: string =
    manifest.components['fixtures/keywords.tsx::Bar'].replacement;
  const cls = /"customPropMap":\{"w":\{[^}]*"\\"unset\\"":"([\w-]+)"/.exec(
    replacement
  )?.[1];

  expect(cls, replacement).toMatch(/^animus-uc-/);
  expect(replacement).toContain('"typedCustomProps":["w"]');
  expect(ruleOf(applyUnitFallback(manifest.css), cls!)).toContain(
    'width: unset;'
  );
});
