import { type ComponentType, createElement } from 'react';

import { buildSystemPropsModule } from '@animus-ui/extract/pipeline';
import { createSystem, createTransform } from '@animus-ui/system';
import { createComponent } from '@animus-ui/system/runtime';
import { renderToString } from 'react-dom/server';
import { beforeAll, describe, expect, test } from 'vitest';

import {
  analyzeProject,
  clearAnalysisCache,
  transformFile,
} from './run-pipeline';

import type { ProjectManifest } from '@animus-ui/extract/pipeline';

const decoy = createTransform('double', (value) => `${Number(value) * 9}px`);
const configured = createSystem()
  .addProps({ decoyWidth: { property: 'width', transform: decoy } })
  .build()
  .seal()
  .toConfig();

const SYSTEM = {
  path: 'fixtures/inherited-custom-system.ts',
  source: `import { createSystem } from '@animus-ui/system';
export const ds = createSystem().build().seal();
`,
};

const SHARED = {
  path: 'fixtures/inherited-custom-shared.ts',
  source: `const FACTOR = 2;
export const double = (value) => \`\${Number(value) * FACTOR}px\`;
`,
};

// Every callback of the parent is private to its module or imported there.
const PARENTS = {
  path: 'fixtures/inherited-custom-parents.tsx',
  source: `import { ds } from './inherited-custom-system';
import { double as dbl } from './inherited-custom-shared';

const STEP = 3;
const stepped = (value) => \`\${Number(value) * STEP}px\`;

export const Parent = ds
  .props({
    inl: { property: 'minWidth', transform: (value) => \`\${Number(value) * STEP + 1}px\` },
    loc: { property: 'paddingLeft', transform: stepped },
    imp: { property: 'paddingTop', transform: dbl },
    gap: { property: 'marginLeft', scale: { sm: '4px', md: '8px' } },
    named: { property: 'marginRight', transform: 'double' },
    unbound: { property: 'right', transform: 'nope' },
  })
  .asElement('div');
`,
};

const CHILDREN = {
  path: 'fixtures/inherited-custom-children.tsx',
  source: `import { Parent as Base } from './inherited-custom-parents';

export const Child = Base.extend().styles({ display: 'block' }).asElement('div');
export const Sibling = Base.extend()
  .props({ inl: { property: 'minWidth', transform: (value) => \`\${Number(value) * 10}px\` } })
  .asElement('section');
export const Grand = Child.extend().styles({ display: 'flex' }).asElement('div');

export const App = () => <Child gap="sm" unbound={1} />;
`,
};

const GRAND = {
  path: 'fixtures/inherited-custom-grand.tsx',
  source: `import { Parent } from './inherited-custom-parents';
import { Child, Grand, Sibling } from './inherited-custom-children';

export const GreatGrand = Grand.extend().styles({ display: 'grid' }).asElement('div');
export const SiblingChild = Sibling.extend().asElement('div');

// Spread values are unknown to extraction: each level keeps runtime slots.
export const Forwarded = (props) => (
  <>
    <Parent {...props} />
    <Child {...props} />
    <Sibling {...props} />
    <Grand {...props} />
    <GreatGrand {...props} />
    <SiblingChild {...props} />
  </>
);
`,
};

type ProbeProps = {
  inl?: number;
  loc?: number;
  imp?: number;
  gap?: string;
  named?: number;
};
type Component = ComponentType<ProbeProps>;
interface Levels {
  Parent: Component;
  Child: Component;
  Sibling: Component;
  Grand: Component;
  GreatGrand: Component;
  SiblingChild: Component;
}
type Binding = Component | number | ((value: number) => string);

const RUNTIME_INPUTS: ProbeProps = {
  inl: 13,
  loc: 5,
  imp: 7,
  gap: 'md',
  named: 3,
};
const PARENT_STYLE = {
  '--animus-inl_': '40px',
  '--animus-loc_': '15px',
  '--animus-imp_': '14px',
  '--animus-gap_': '8px',
  '--animus-named_': '27px',
};

describe('custom props inherited through extend()', () => {
  let manifest: ProjectManifest;
  let components: Levels;

  beforeAll(async () => {
    clearAnalysisCache();
    manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([SYSTEM, SHARED, PARENTS, CHILDREN, GRAND]),
        {
          propConfigJson: configured.propConfig,
          groupRegistryJson: configured.groupRegistry,
          transformSourcesJson: configured.transformSources,
        }
      )
    );
    const { transforms } = await import(
      `data:text/javascript,${encodeURIComponent(
        buildSystemPropsModule({
          systemPropMapJson: '{}',
          groupRegistryJson: '{}',
          dynamicProps: {},
          admittedTransforms: manifest.admitted_transforms,
          typedSystemProps: manifest.typed_system_props,
        })
      )}`
    );
    // Each replacement runs with only its own module's bindings in scope, so
    // a callback carried into another module as text cannot resolve.
    const runtime = {
      createComponent,
      systemPropMap: {},
      dynamicPropConfig: {},
      transforms,
    };
    const instantiate = (
      file: { path: string },
      binding: string,
      scope: { [name: string]: Binding }
    ): Component => {
      const { replacement } = manifest.components[`${file.path}::${binding}`];
      const bindings = { ...runtime, ...scope };
      return new Function(...Object.keys(bindings), `return ${replacement};`)(
        ...Object.values(bindings)
      );
    };
    const STEP = 3;
    const Parent = instantiate(PARENTS, 'Parent', {
      STEP,
      stepped: (value: number) => `${value * STEP}px`,
      dbl: (value: number) => `${value * 2}px`,
    });
    const Child = instantiate(CHILDREN, 'Child', { Base: Parent });
    const Sibling = instantiate(CHILDREN, 'Sibling', { Base: Parent });
    const Grand = instantiate(CHILDREN, 'Grand', { Child });
    components = {
      Parent,
      Child,
      Sibling,
      Grand,
      GreatGrand: instantiate(GRAND, 'GreatGrand', { Grand }),
      SiblingChild: instantiate(GRAND, 'SiblingChild', { Sibling }),
    };
  });

  const render = (binding: keyof Levels, props: ProbeProps) => {
    const html = renderToString(createElement(components[binding], props));
    // Each level's slot variables end in its own binding and component
    // hash; the values are what the levels share.
    const style = Object.fromEntries(
      (/style="([^"]*)"/.exec(html)?.[1] ?? '')
        .split(';')
        .filter(Boolean)
        .map((declaration) => declaration.split(':'))
        .map(([name, value]) => [
          name.replace(/_[A-Za-z0-9]+_[0-9a-f]{8}$/, '_'),
          value,
        ])
    );
    return { html, style };
  };

  test('runtime-only values keep every inherited mapping and callback at each level', () => {
    for (const binding of ['Parent', 'Child', 'Grand', 'GreatGrand'] as const) {
      const { html, style } = render(binding, RUNTIME_INPUTS);
      expect(style, binding).toEqual(PARENT_STYLE);
      expect(html, binding).not.toMatch(/ (inl|loc|imp|gap|named)=/);
    }
  });

  test('an override changes its own branch only', () => {
    for (const binding of ['Sibling', 'SiblingChild'] as const) {
      const { style } = render(binding, RUNTIME_INPUTS);
      expect(style, binding).toEqual({
        ...PARENT_STYLE,
        '--animus-inl_': '130px',
      });
    }
  });

  test("an extension's own literal resolves through the inherited scale", () => {
    const { html, style } = render('Child', { gap: 'sm' });
    expect(style).toEqual({});
    const classes = /class="([^"]*)"/.exec(html)![1].split(' ');
    expect(
      classes.some((name) =>
        new RegExp(`\\.${name}\\s*\\{[^}]*margin-left:\\s*4px`).test(
          manifest.css
        )
      )
    ).toBe(true);
  });

  test('no callback source or private binding moves into an extending module', () => {
    for (const file of [CHILDREN, GRAND]) {
      const { code } = transformFile(file.path, file.source);
      expect(code).not.toMatch(/STEP|stepped|dbl|FACTOR/);
    }
  });

  test('an inherited declaration is reported only where it is declared', () => {
    expect(manifest.diagnostics.map((d) => [d.component, d.message])).toEqual([
      ['Parent', expect.stringContaining("'nope'")],
    ]);
  });
});
