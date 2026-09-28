import { beforeAll, describe, expect, test } from 'vitest';

import { assertNoUnresolvedTokens } from './assert-no-unresolved-tokens';
import { clearAnalysisCache, runPipeline } from './run-pipeline';

// Inline rather than under fixtures/components, which is also the parity corpus.
const PARENT = {
  path: 'fixtures/tone-parent.tsx',
  source: `import { ds } from './setup';
export const Parent = ds.styles({ display: 'flex' }).variant({
  prop: 'tone',
  defaultVariant: 'soft',
  variants: {
    soft: {
      opacity: 0.5,
      paddingTop: '3px',
      paddingBottom: { _: '2px', md: '6px' },
      '&:hover': { color: 'red', outlineWidth: '1px' },
    },
    loud: { opacity: 1, fontWeight: 700 },
  },
}).asElement('div');
`,
};

const CHILD = {
  path: 'fixtures/tone-child.tsx',
  source: `import { Parent } from './tone-parent';
export const Child = Parent.extend().variant({
  prop: 'tone',
  variants: {
    soft: {
      opacity: 0.8,
      paddingBottom: { md: '9px' },
      '&:hover': { color: 'blue' },
    },
  },
}).asElement('div');
`,
};

const GRANDCHILD = {
  path: 'fixtures/tone-grandchild.tsx',
  source: `import { Child } from './tone-child';
export const Grandchild = Child.extend()
  .variant({
    prop: 'tone',
    defaultVariant: 'loud',
    variants: { loud: { fontWeight: 800 }, quiet: { opacity: 0.2 } },
  })
  .variant({ prop: 'size', variants: { sm: { fontSize: '12px' } } })
  .asElement('div');
`,
};

const APP = {
  path: 'fixtures/tone-app.tsx',
  source: `import { Parent } from './tone-parent';
import { Child } from './tone-child';
import { Grandchild } from './tone-grandchild';
export const App = () => <><Parent /><Child /><Grandchild /></>;
`,
};

type Manifest = ReturnType<typeof runPipeline>['manifest'];
type VariantConfig = Record<string, { options: string[]; default?: string }>;

function component(manifest: Manifest, id: string) {
  const descriptor: { class_name: string; replacement: string } =
    manifest.components[id];
  expect(descriptor, `component ${id}`).toBeDefined();
  return descriptor;
}

/** The variant config the replacement hands the runtime. */
function replacementVariants(manifest: Manifest, id: string): VariantConfig {
  const { replacement } = component(manifest, id);
  const config = replacement.slice(replacement.indexOf('{'), -1);
  return JSON.parse(config).variants ?? {};
}

/**
 * One component's own variant rules, keyed by the full prelude path
 * (`@media … .class`), each with its declarations sorted.
 */
function variantRules(manifest: Manifest, id: string) {
  const css: string = manifest.component_fragments[id]?.variants ?? '';
  const rules: Record<string, string[]> = {};
  const preludes: string[] = [];
  let text = '';
  for (const char of css) {
    if (char === '{') {
      preludes.push(text.trim());
      text = '';
    } else if (char === '}') {
      const declarations = text
        .split(';')
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .sort();
      if (declarations.length > 0) rules[preludes.join(' ')] = declarations;
      preludes.pop();
      text = '';
    } else {
      text += char;
    }
  }
  return rules;
}

beforeAll(() => {
  clearAnalysisCache();
});

describe('overriding one option on an inherited variant axis (development)', () => {
  const { manifest, css } = runPipeline([PARENT, CHILD, GRANDCHILD, APP], {
    devMode: true,
  });
  const childId = 'fixtures/tone-child.tsx::Child';
  const child = component(manifest, childId).class_name;

  test('the child replacement keeps sibling options and the inherited default', () => {
    const { tone } = replacementVariants(manifest, childId);
    expect([...tone.options].sort()).toEqual(['loud', 'soft']);
    expect(tone.default).toBe('soft');
  });

  test('the child rules merge the overridden option and keep its siblings', () => {
    const rules = variantRules(manifest, childId);
    expect(rules[`.${child}--tone-soft`]).toEqual([
      'opacity: 0.8',
      'padding-bottom: 2px',
      'padding-top: 3px',
    ]);
    expect(rules[`.${child}--tone-loud`]).toEqual([
      'font-weight: 700',
      'opacity: 1',
    ]);
    expect(rules[`.${child}--tone-default`]).toEqual([
      'opacity: 0.8',
      'padding-bottom: 2px',
      'padding-top: 3px',
    ]);
  });

  test('nested selector and condition declarations merge recursively', () => {
    const rules = variantRules(manifest, childId);
    expect(rules[`.${child}--tone-soft:hover`]).toEqual([
      'color: blue',
      'outline-width: 1px',
    ]);
    expect(rules[`@media (min-width: 1024px) .${child}--tone-soft`]).toEqual([
      'padding-bottom: 9px',
    ]);
  });

  test('the parent keeps its own configuration and rules', () => {
    const parentId = 'fixtures/tone-parent.tsx::Parent';
    const parent = component(manifest, parentId).class_name;
    const { tone } = replacementVariants(manifest, parentId);
    expect([...tone.options].sort()).toEqual(['loud', 'soft']);
    expect(tone.default).toBe('soft');
    const rules = variantRules(manifest, parentId);
    expect(rules[`.${parent}--tone-soft`]).toEqual([
      'opacity: 0.5',
      'padding-bottom: 2px',
      'padding-top: 3px',
    ]);
    expect(rules[`.${parent}--tone-soft:hover`]).toEqual([
      'color: red',
      'outline-width: 1px',
    ]);
    expect(rules[`@media (min-width: 1024px) .${parent}--tone-soft`]).toEqual([
      'padding-bottom: 6px',
    ]);
  });

  describe('a grandchild extending the child', () => {
    const grandchildId = 'fixtures/tone-grandchild.tsx::Grandchild';
    const grandchild = component(manifest, grandchildId).class_name;

    test('adds options and axes and replaces the default explicitly', () => {
      const { tone, size } = replacementVariants(manifest, grandchildId);
      expect([...tone.options].sort()).toEqual(['loud', 'quiet', 'soft']);
      expect(tone.default).toBe('loud');
      expect(size.options).toEqual(['sm']);
    });

    test('inherits the resolved child option through two extensions', () => {
      const rules = variantRules(manifest, grandchildId);
      expect(rules[`.${grandchild}--tone-soft`]).toEqual([
        'opacity: 0.8',
        'padding-bottom: 2px',
        'padding-top: 3px',
      ]);
      expect(rules[`.${grandchild}--tone-soft:hover`]).toEqual([
        'color: blue',
        'outline-width: 1px',
      ]);
      expect(
        rules[`@media (min-width: 1024px) .${grandchild}--tone-soft`]
      ).toEqual(['padding-bottom: 9px']);
    });

    test('merges its own override and emits its new option and axis', () => {
      const rules = variantRules(manifest, grandchildId);
      expect(rules[`.${grandchild}--tone-loud`]).toEqual([
        'font-weight: 800',
        'opacity: 1',
      ]);
      expect(rules[`.${grandchild}--tone-default`]).toEqual([
        'font-weight: 800',
        'opacity: 1',
      ]);
      expect(rules[`.${grandchild}--tone-quiet`]).toEqual(['opacity: 0.2']);
      expect(rules[`.${grandchild}--size-sm`]).toEqual(['font-size: 12px']);
    });

    test('leaves the child configuration unchanged', () => {
      const { tone } = replacementVariants(
        manifest,
        'fixtures/tone-child.tsx::Child'
      );
      expect([...tone.options].sort()).toEqual(['loud', 'soft']);
      expect(tone.default).toBe('soft');
    });
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});

describe('inherited variant options under production pruning', () => {
  const RENDERED = {
    path: 'fixtures/tone-app.tsx',
    source: `import { Parent } from './tone-parent';
import { Child } from './tone-child';
import { Grandchild } from './tone-grandchild';
export const App = () => (
  <>
    <Parent />
    <Child tone="loud" />
    <Grandchild />
  </>
);
`,
  };
  const { manifest, css } = runPipeline([PARENT, CHILD, GRANDCHILD, RENDERED]);
  const parentId = 'fixtures/tone-parent.tsx::Parent';
  const childId = 'fixtures/tone-child.tsx::Child';
  const grandchildId = 'fixtures/tone-grandchild.tsx::Grandchild';

  test('a child keeps a rendered inherited option the parent prunes', () => {
    const parent = component(manifest, parentId).class_name;
    const child = component(manifest, childId).class_name;
    expect(variantRules(manifest, parentId)).not.toHaveProperty(
      `.${parent}--tone-loud`
    );
    expect(variantRules(manifest, childId)[`.${child}--tone-loud`]).toEqual([
      'font-weight: 700',
      'opacity: 1',
    ]);
  });

  test('unrendered options are pruned per component', () => {
    const child = component(manifest, childId).class_name;
    const grandchild = component(manifest, grandchildId).class_name;
    expect(variantRules(manifest, childId)).not.toHaveProperty(
      `.${child}--tone-soft`
    );
    const rules = variantRules(manifest, grandchildId);
    expect(rules).not.toHaveProperty(`.${grandchild}--tone-soft`);
    expect(rules).not.toHaveProperty(`.${grandchild}--tone-quiet`);
  });

  test('an explicit default renders its merged option', () => {
    const grandchild = component(manifest, grandchildId).class_name;
    const { tone } = replacementVariants(manifest, grandchildId);
    expect(tone.default).toBe('loud');
    expect(
      variantRules(manifest, grandchildId)[`.${grandchild}--tone-default`]
    ).toEqual(['font-weight: 800', 'opacity: 1']);
  });

  test('the child replacement keeps the complete inherited configuration', () => {
    const { tone } = replacementVariants(manifest, childId);
    expect([...tone.options].sort()).toEqual(['loud', 'soft']);
    expect(tone.default).toBe('soft');
  });

  test('no raw unresolved token names in output', () => {
    assertNoUnresolvedTokens(css);
  });
});
