import { type ComponentType, createElement } from 'react';

import { buildSystemPropsModule } from '@animus-ui/extract/pipeline';
import { createSystem, createTheme } from '@animus-ui/system';
import { createComponent } from '@animus-ui/system/runtime';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, test } from 'vitest';

import { analyzeProject } from './run-pipeline';

import type { ProjectManifest } from '@animus-ui/extract/pipeline';

/**
 * Declaration-scale precedence as the changelog states it: within one layer a
 * same-condition atomic rule wins over a declaration, and a responsive
 * declaration wins over a base atomic rule; the custom layer outranks the
 * system layer; prop order changes nothing. A nested consumer without a base
 * key adopts its ancestor's shared system member values.
 *
 * Each element renders through its real replacement and runtime, and its
 * computed value is read from the emitted stylesheet by the cascade model
 * below.
 */

const SM = 640;
const BG = 'background-color';
const BORDER = 'border-color';

const theme = createTheme()
  .addBreakpoints({ sm: SM })
  .addDeclarationScale({
    name: 'looks',
    values: {
      loud: { backgroundColor: 'red', borderColor: 'darkred' },
      calm: { backgroundColor: 'green', borderColor: 'darkgreen' },
    },
  })
  .build()
  .serialize();
const system = createSystem()
  .addGroup('look', {
    bg: { property: 'backgroundColor' },
    look: {
      kind: 'declarations',
      scale: 'looks',
      members: ['backgroundColor', 'borderColor'],
    },
  })
  .build()
  .seal()
  .toConfig();

const FILE = 'fixtures/declaration-precedence.tsx';
const COMPONENTS = `import { ds } from './setup';
export const Box = ds.system({ look: true }).asElement('div');
export const Card = ds
  .styles({ display: 'block' })
  .props({
    tone: { property: 'backgroundColor' },
    mood: { kind: 'declarations', scale: 'looks', members: ['backgroundColor', 'borderColor'] },
  })
  .system({ look: true })
  .asElement('div');
`;

type Props = Record<string, string | Record<string, string>>;
type Use = { component: 'Box' | 'Card'; props: Props; parent?: Use };

const use = (component: Use['component'], props: Props, parent?: Use) => ({
  component,
  props,
  parent,
});

const USES = {
  overlap: use('Card', {
    look: 'loud',
    bg: 'blue',
    mood: 'calm',
    tone: 'pink',
  }),
  systemBase: use('Box', { look: 'loud', bg: 'blue' }),
  systemSm: use('Box', { look: { sm: 'loud' }, bg: { sm: 'blue' } }),
  systemResponsive: use('Box', { look: { sm: 'calm' }, bg: 'blue' }),
  customResponsive: use('Card', { mood: { sm: 'calm' }, tone: 'pink' }),
  customDeclaration: use('Card', { mood: 'calm', bg: 'blue' }),
  customAtomic: use('Card', { tone: 'pink', look: 'loud' }),
  customBaseDeclaration: use('Card', { mood: 'calm', bg: { sm: 'blue' } }),
  customBaseless: use('Card', { mood: { sm: 'calm' }, bg: 'blue' }),
  // Binds only a breakpoint key, inside another component's base key.
  adopter: use('Box', { look: { sm: 'calm' } }, use('Card', { look: 'loud' })),
};

interface Rule {
  /** The rank of the rule's top-level cascade layer. */
  layer: number;
  /** The rule's `min-width` media condition in px; 0 without one. */
  minWidth: number;
  className: string;
  declarations: Map<string, string>;
}

interface Element {
  classes: ReadonlySet<string>;
  parent?: Element;
}

/**
 * The style rules of an emitted stylesheet, in source order. The model knows
 * plain class selectors in top-level `@layer` blocks, under `@media
 * (min-width)` conditions; it throws on any other rule.
 */
function parseRules(css: string): Rule[] {
  const layers: string[] = [];
  const rules: Rule[] = [];
  const preludes: string[] = [];
  let text = '';
  for (const char of css) {
    const inner = preludes.at(-1);
    if (char === '{') {
      const prelude = text.trim();
      if (/^@(?!layer |media )/.test(prelude)) {
        throw new Error(`the cascade model cannot place ${prelude}`);
      }
      preludes.push(prelude);
      text = '';
    } else if (char === '}') {
      const selector = preludes.pop() ?? '';
      if (!selector.startsWith('@')) {
        rules.push(styleRule(selector, preludes, text, layers));
      }
      text = '';
    } else if (char === ';' && (inner === undefined || inner.startsWith('@'))) {
      const order = /^@layer ([\w\s,-]+)$/.exec(text.trim());
      if (order && inner === undefined) {
        layers.push(...order[1].split(',').map((name) => name.trim()));
      }
      text = '';
    } else {
      text += char;
    }
  }
  return rules;
}

function styleRule(
  selector: string,
  outer: readonly string[],
  body: string,
  layers: readonly string[]
): Rule {
  const plain = /^\.([\w-]+)$/.exec(selector);
  const layer = layers.indexOf(
    /^@layer ([\w-]+)$/.exec(outer[0] ?? '')?.[1] ?? ''
  );
  const widths = outer
    .slice(1)
    .map((prelude) => /^@media \(min-width: (\d+)px\)$/.exec(prelude)?.[1]);
  if (!plain || layer < 0 || widths.includes(undefined)) {
    throw new Error(
      `the cascade model cannot place ${[...outer, selector].join(' ')}`
    );
  }
  const declarations = new Map<string, string>();
  for (const declaration of body.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      declarations.set(
        declaration.slice(0, colon).trim(),
        declaration.slice(colon + 1).trim()
      );
    }
  }
  const minWidth = Math.max(0, ...widths.map(Number));
  return { layer, minWidth, className: plain[1], declarations };
}

/** The rule whose `property` wins, among layers ranked below `below`. */
function winner(
  rules: readonly Rule[],
  element: Element,
  width: number,
  property: string,
  below = Infinity
): Rule | undefined {
  let best: Rule | undefined;
  for (const rule of rules) {
    if (
      rule.declarations.has(property) &&
      rule.layer < below &&
      rule.minWidth <= width &&
      element.classes.has(rule.className) &&
      (best === undefined || rule.layer >= best.layer)
    ) {
      best = rule;
    }
  }
  return best;
}

/** Resolves a value that is one `var()`, reading inherited custom properties. */
function substitute(
  rules: readonly Rule[],
  element: Element,
  width: number,
  value: string
): string {
  const read = /^var\((--[\w-]+)(?:,\s*(.+))?\)$/.exec(value);
  if (!read) return value;
  const [, name, fallback] = read;
  for (let from: Element | undefined = element; from; from = from.parent) {
    const rule = winner(rules, from, width, name);
    if (rule) {
      return substitute(rules, from, width, rule.declarations.get(name) ?? '');
    }
  }
  return fallback ?? 'unset';
}

/**
 * The computed value of a property that does not inherit: `revert-layer`
 * rolls back to the layers below the rule that produced it.
 */
function computed(
  rules: readonly Rule[],
  element: Element,
  width: number,
  property: string
): string {
  let rule = winner(rules, element, width, property);
  while (rule) {
    const value = substitute(
      rules,
      element,
      width,
      rule.declarations.get(property) ?? ''
    );
    if (value !== 'revert-layer') return value;
    rule = winner(rules, element, width, property, rule.layer);
  }
  return 'initial';
}

const reorder = (props: Props, reversed: boolean): Props =>
  reversed ? Object.fromEntries(Object.entries(props).reverse()) : props;

function jsx(element: Use, reversed: boolean, child?: string): string {
  const attributes = Object.entries(reorder(element.props, reversed))
    .map(([name, value]) => `${name}={${JSON.stringify(value)}}`)
    .join(' ');
  const tag = `<${element.component} ${attributes}`;
  const markup =
    child === undefined
      ? `${tag} />`
      : `${tag}>${child}</${element.component}>`;
  return element.parent ? jsx(element.parent, reversed, markup) : markup;
}

/** Extracts every use with its props in authored or reversed order. */
async function project(reversed: boolean) {
  const uses = Object.values(USES).map((element) => jsx(element, reversed));
  const source = `${COMPONENTS}export const App = () => <>${uses.join('')}</>;\n`;
  const manifest: ProjectManifest = JSON.parse(
    analyzeProject(JSON.stringify([{ path: FILE, source }]), {
      ...theme,
      propConfigJson: system.propConfig,
      groupRegistryJson: system.groupRegistry,
    })
  );
  const rules = parseRules(manifest.css);
  // The module the replacements import in a build.
  const systemProps = await import(
    `data:text/javascript,${encodeURIComponent(
      buildSystemPropsModule({
        systemPropMapJson: JSON.stringify(manifest.system_prop_map),
        groupRegistryJson: system.groupRegistry,
        dynamicProps: manifest.dynamic_props,
        admittedTransforms: manifest.admitted_transforms,
        typedSystemProps: manifest.typed_system_props,
      })
    )}`
  );
  const scope = { createComponent, ...systemProps };
  const instantiate = (binding: Use['component']): ComponentType<Props> =>
    new Function(
      ...Object.keys(scope),
      `return ${manifest.components[`${FILE}::${binding}`].replacement};`
    )(...Object.values(scope));
  const components = { Box: instantiate('Box'), Card: instantiate('Card') };
  const render = (element: Use): Element => {
    const html = renderToString(
      createElement(
        components[element.component],
        reorder(element.props, reversed)
      )
    );
    // The model reads classes only; a runtime-delivered value would be inline.
    expect(html, element.component).not.toContain('style=');
    const classes = /class="([^"]*)"/.exec(html)?.[1] ?? '';
    return {
      classes: new Set(classes.split(' ')),
      parent: element.parent && render(element.parent),
    };
  };
  return (element: Use, width: number, property: string) =>
    computed(rules, render(element), width, property);
}

describe.each([
  ['authored', false],
  ['reversed', true],
])('declaration precedence with props in %s order', (_, reversed) => {
  let style: Awaited<ReturnType<typeof project>>;
  beforeAll(async () => {
    style = await project(reversed);
  });

  test('when system and custom declarations and atomics overlap, the custom atomic wins', () => {
    expect(style(USES.overlap, 0, BG)).toBe('pink');
    expect(style(USES.overlap, 0, BORDER)).toBe('darkgreen');
  });

  test('an atomic rule with the same condition wins over a declaration', () => {
    expect(style(USES.systemBase, 0, BG)).toBe('blue');
    expect(style(USES.systemBase, 0, BORDER)).toBe('darkred');
    expect(style(USES.systemSm, SM, BG)).toBe('blue');
    expect(style(USES.systemSm, SM, BORDER)).toBe('darkred');
  });

  test('a responsive declaration wins over a base atomic rule', () => {
    expect(style(USES.systemResponsive, 0, BG)).toBe('blue');
    expect(style(USES.systemResponsive, SM, BG)).toBe('green');
    expect(style(USES.customResponsive, SM, BG)).toBe('green');
  });

  test('the custom layer outranks the system layer', () => {
    expect(style(USES.customDeclaration, 0, BG)).toBe('green');
    expect(style(USES.customAtomic, 0, BG)).toBe('pink');
    expect(style(USES.customAtomic, 0, BORDER)).toBe('darkred');
    expect(style(USES.customBaseDeclaration, SM, BG)).toBe('green');
    // Where the custom declaration has no value, the system layer holds.
    expect(style(USES.customBaseless, 0, BG)).toBe('blue');
    expect(style(USES.customBaseless, SM, BG)).toBe('green');
  });

  test('a nested consumer without a base key adopts its ancestor members', () => {
    expect(style(USES.adopter, 0, BG)).toBe('red');
    expect(style(USES.adopter, 0, BORDER)).toBe('darkred');
    expect(style(USES.adopter, SM, BG)).toBe('green');
    expect(style(USES.adopter, SM, BORDER)).toBe('darkgreen');
  });
});
