import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

const {
  extract,
  analyzeProject,
  transformFile,
  clearAnalysisCache,
} = require('../index.js');

const FIXTURES = join(__dirname, 'fixtures');

/**
 * Programmatic theme — serialized from real builder API.
 * Structurally mirrors the showcase theme. If serialize() changes shape,
 * these tests break — that's the point.
 */
import {
  contextualVarsJson,
  themeJson,
  variableMapJson,
} from './fixtures/theme-fixture';

const theme = themeJson;
const variableMap = variableMapJson;

/**
 * Full prop config — programmatically serialized from packages/core/src/config.ts.
 * This is the canonical prop→CSS property mapping used by all Animus components.
 * If config.ts changes, this serialization changes with it. No hand-maintenance.
 */
import {
  serializedConfig,
  serializedGroupRegistry,
} from './fixtures/serialize-config';

const config = serializedConfig;
const groupRegistry = serializedGroupRegistry;

describe('base style extraction', () => {
  const source = readFileSync(join(FIXTURES, 'button.tsx'), 'utf-8');
  const result = extract(
    source,
    'button.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('CSS contains @layer declaration', () => {
    expect(result.css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
  });

  test('CSS contains base layer with ButtonContainer styles', () => {
    expect(result.css).toContain('@layer anm-base {');
    expect(result.css).toContain('animus-ButtonContainer-');
    expect(result.css).toContain('display: inline-flex;');
    expect(result.css).toContain('cursor: pointer;');
    expect(result.css).toContain('padding: 0;');
  });

  test('CSS contains variant layer with fill and stroke options', () => {
    expect(result.css).toContain('@layer anm-variants {');
    expect(result.css).toContain('--variant-fill');
    expect(result.css).toContain('--variant-stroke');
  });

  test('CSS contains pseudo-selector for hover', () => {
    expect(result.css).toContain(':hover');
    expect(result.css).toContain('background-position: -100px 0%;');
  });

  test('CSS contains pseudo-element for before', () => {
    expect(result.css).toContain('::before');
    expect(result.css).toContain('position: absolute;');
  });

  test('CSS handles comma-separated selectors', () => {
    // '&:hover, &:focus-visible' should produce both selectors with the class
    const classPattern = /\.(animus-ButtonContainer-[a-f0-9]+--variant-fill)/;
    const match = result.css.match(classPattern);
    expect(match).toBeTruthy();
    const cls = match![1];
    expect(result.css).toContain(`.${cls}:hover, .${cls}:focus-visible`);
  });

  test('CSS resolves scale values', () => {
    // fontWeight: 700 → scale lookup → "700"
    expect(result.css).toContain('font-weight: 700;');
    // lineHeight: 'title' → scale lookup
    expect(result.css).toContain('line-height: calc(2px + 2.8ex + 2px);');
    // borderRadius: 4 → scale lookup → "4px", transform deferred to JS post-processing
    expect(result.css).toContain('border-radius: __TRANSFORM__size__4px__;');
  });

  test('transformed JS contains createComponent calls', () => {
    expect(result.code).toContain("createComponent('button'");
    expect(result.code).toContain("createComponent('span'");
    expect(result.code).toContain(
      "import { createComponent } from '@animus-ui/system'"
    );
  });

  test('transformed JS contains variant config', () => {
    // ButtonContainer has variant with fill/stroke
    expect(result.code).toContain('"variant"');
    expect(result.code).toContain('"fill"');
    expect(result.code).toContain('"stroke"');
    // ButtonForeground has size variant
    expect(result.code).toContain('"size"');
  });

  test('both chains extracted (ButtonContainer + ButtonForeground)', () => {
    // Should have CSS for both components
    expect(result.css).toContain('animus-ButtonContainer-');
    expect(result.css).toContain('animus-ButtonForeground-');
  });
});

describe('responsive and state extraction', () => {
  const source = readFileSync(join(FIXTURES, 'layout.tsx'), 'utf-8');
  const result = extract(
    source,
    'layout.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
  });

  test('CSS contains responsive @media queries', () => {
    // fontSize: { _: 16, xs: 18 } → scale lookup → 1rem default + 1.125rem at xs
    expect(result.css).toContain('font-size: 1rem');
    expect(result.css).toContain('@media (min-width: 480px)');
    expect(result.css).toContain('font-size: 1.125rem');
  });

  test('CSS contains state layer', () => {
    expect(result.css).toContain('@layer anm-states {');
    expect(result.css).toContain('--loading');
    expect(result.css).toContain('opacity: 0;');
  });

  test('CSS contains responsive states', () => {
    // sidebar state has responsive gridTemplateAreas
    expect(result.css).toContain('--sidebar');
    expect(result.css).toContain('grid-template-areas');
  });

  test('CSS contains responsive multi-property values', () => {
    // pt: { _: 24, sm: 48 } → padding-top at default and @media
    expect(result.css).toContain('padding-top: 1.5rem');
    expect(result.css).toContain('@media (min-width: 768px)');
  });

  test('responsive value without _ default still works', () => {
    // SidebarContainer has position: { sm: 'static' } — no _
    expect(result.css).toContain('animus-SidebarContainer-');
    expect(result.css).toContain('@media (min-width: 768px)');
    expect(result.css).toContain('position: static');
  });

  test('all three chains extracted', () => {
    expect(result.css).toContain('animus-LayoutContainer-');
    expect(result.css).toContain('animus-ContentContainer-');
    expect(result.css).toContain('animus-SidebarContainer-');
  });

  test('transformed JS has state config', () => {
    expect(result.code).toContain('"states"');
    expect(result.code).toContain('"loading"');
    expect(result.code).toContain('"sidebar"');
  });
});

describe('chain recognition: asComponent', () => {
  const source = readFileSync(join(FIXTURES, 'bail.tsx'), 'utf-8');
  const result = extract(source, 'bail.tsx', theme, variableMap, config, '{}');

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
  });

  test('generates CSS', () => {
    expect(result.css).toContain('FlowLink');
  });
});

describe('system props: basic extraction', () => {
  const source = readFileSync(join(FIXTURES, 'system-props.tsx'), 'utf-8');
  const result = extract(
    source,
    'system-props.tsx',
    theme,
    variableMap,
    config,
    groupRegistry
  );

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('CSS contains @layer system with utility classes', () => {
    expect(result.css).toContain('@layer anm-system {');
    // p={8} → padding: 0.5rem
    expect(result.css).toContain('padding: 0.5rem');
    // Utility class name format
    expect(result.css).toContain('animus-u-');
  });

  test('utility class names are deterministic', () => {
    // Run extract again — same class names
    const result2 = extract(
      source,
      'system-props.tsx',
      theme,
      variableMap,
      config,
      groupRegistry
    );
    // Extract utility class names from both
    const utilClasses1 = result.css.match(/animus-u-[a-f0-9]{8}/g) || [];
    const utilClasses2 = result2.css.match(/animus-u-[a-f0-9]{8}/g) || [];
    expect(utilClasses1).toEqual(utilClasses2);
  });

  test('CSS contains responsive utility with @media', () => {
    // mt={{ _: 8, sm: 16 }} → base: 0.5rem + @media sm: 1rem
    expect(result.css).toContain('margin-top: 0.5rem');
    expect(result.css).toContain('margin-top: 1rem');
  });

  test('transformed JS uses shared systemPropMap', () => {
    // systemProps removed from per-component config — shared map used instead
    expect(result.code).not.toContain('"systemProps"');
    expect(result.code).toContain('"systemPropNames"');
    // 4th argument references the shared map
    expect(result.code).toContain(', systemPropMap)');
    // Import for the shared map + group refs virtual module
    expect(result.code).toContain(
      "import { systemPropMap, systemPropGroups } from 'virtual:animus/system-props'"
    );
    // Uses group concat instead of literal prop name arrays
    expect(result.code).toContain('[].concat(systemPropGroups.');
  });

  test('base styles still in @layer base', () => {
    // The component's .styles() still goes in @layer base
    expect(result.css).toContain('@layer anm-base {');
    expect(result.css).toContain('display: flex');
  });

  test('state styles still in @layer states', () => {
    expect(result.css).toContain('@layer anm-states {');
  });

  test('system layer comes after states in output', () => {
    const statesPos = result.css.indexOf('@layer anm-states {');
    const systemPos = result.css.indexOf('@layer anm-system {');
    expect(systemPos).toBeGreaterThan(statesPos);
  });
});

describe('system props: group chains', () => {
  // Inline source — component with groups but NO JSX usage in same file
  const source = `
    import { animus } from '@animus-ui/core';
    export const Box = animus
      .styles({ display: 'flex' })
      .system({ space: true, layout: true })
      .asElement('div');
  `;
  const result = extract(
    source,
    'groups-only.tsx',
    theme,
    variableMap,
    config,
    groupRegistry
  );

  test('is now extractable', () => {
    expect(result.extractable).toBe(true);
  });

  test('CSS contains base styles in @layer base', () => {
    expect(result.css).toContain('@layer anm-base {');
    expect(result.css).toContain('display: flex');
  });

  test('no utility CSS when no JSX usage in file', () => {
    // No JSX elements using Box in this file → no @layer system block
    expect(result.code).toContain("createComponent('div'");
    expect(result.css).not.toContain('@layer anm-system {');
  });
});

describe('system props: individual activation', () => {
  // Component activates a single prop by name (not a group)
  // + JSX usage in same file to trigger utility CSS generation
  const source = `
    import { animus } from '@animus-ui/core';
    export const Box = animus
      .styles({ display: 'flex' })
      .system({ space: true, transition: true })
      .asElement('div');

    export const App = () => <Box p={8} transition="all 0.2s ease" />;
  `;
  const result = extract(
    source,
    'individual-prop.tsx',
    theme,
    variableMap,
    config,
    groupRegistry
  );

  test('is extractable', () => {
    expect(result.extractable).toBe(true);
  });

  test('CSS contains utility class for individually activated prop', () => {
    // transition="all 0.2s ease" should generate a utility class in @layer system
    expect(result.css).toContain('transition: all 0.2s ease');
  });

  // Cross-file test: component defined in one file, JSX usage in another
  test('cross-file: individual prop generates utility via analyzeProject', () => {
    const defSource = `
      import { animus } from '@animus-ui/core';
      export const Mono = animus
        .styles({ display: 'inline' })
        .system({ space: true, transition: true })
        .asElement('span');
    `;
    const usageSource = `
      import { Mono } from './mono-def';
      export const Page = () => <Mono p={8} transition="all 0.2s ease">text</Mono>;
    `;

    const manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([
          { path: 'mono-def.tsx', source: defSource },
          { path: 'page.tsx', source: usageSource },
        ]),
        theme,
        variableMap,
        null,
        config,
        groupRegistry,
        '{}',
        null,
        null
      )
    );

    // Utility CSS should contain the transition value from JSX usage
    expect(manifest.css).toContain('transition: all 0.2s ease');
  });

  test('CSS contains utility class for group-activated prop', () => {
    // p={8} via space group should also work
    expect(result.css).toContain('padding: 0.5rem');
  });

  test('transformed code includes transition in systemPropMap', () => {
    // The transformed createComponent call should strip transition from DOM
    expect(result.code).toContain("createComponent('div'");
  });
});

// ===========================================================================
// CONCENTRIC SNAPSHOT TESTS — The Steering Wheels
//
// Three layers of exact CSS comparison, each testing a different complexity
// level. If Layer 1 breaks, a core mechanic failed. If Layer 3 breaks but
// Layer 1 passes, the issue is in cross-file resolution, not core extraction.
//
// Do NOT update any snapshot without understanding WHY the output changed.
// ===========================================================================

/**
 * LAYER 1: Single-file, styles + variants (simplest contract)
 * Breaks if: CSS generation, style evaluation, theme resolution, or
 * variant handling changes.
 */
describe('snapshot: styles and variants', () => {
  const source = readFileSync(join(FIXTURES, 'button.tsx'), 'utf-8');
  const result = extract(
    source,
    'button.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('CSS matches snapshot', () => {
    expect(result.css).toMatchInlineSnapshot(`
      "@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;

      @layer anm-base {
        .animus-ButtonContainer-5ac913ef {
          padding: 0;
          border: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: __TRANSFORM__size__4px__;
          box-shadow: none;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
          letter-spacing: 1px;
          position: relative;
          cursor: pointer;
          user-select: none;
        }
      }

      @layer anm-variants {
        .animus-ButtonContainer-5ac913ef--variant-fill {
          transition: 500ms ease background-position;
          color: var(--color-background);
          background-color: transparent;
          background-image: flowX;
          background-size: 300px 100%;
          background-position: 0% 0%;
        }
        .animus-ButtonContainer-5ac913ef--variant-fill:hover {
          background-position: -100px 0%;
        }
        .animus-ButtonContainer-5ac913ef--variant-fill:hover, .animus-ButtonContainer-5ac913ef--variant-fill:focus-visible {
          outline-color: var(--color-primary);
        }
        .animus-ButtonContainer-5ac913ef--variant-stroke::before {
          position: absolute;
          border-radius: __TRANSFORM__size__4px__;
          content: "";
        }
        .animus-ButtonForeground-7e799f39--size-sm {
          padding-left: 0.5rem;
          padding-right: 0.5rem;
          font-size: 0.875rem;
          line-height: 26px;
          padding-bottom: 0.125rem;
          min-height: __TRANSFORM__size__28__;
          min-width: __TRANSFORM__size__60__;
        }
        .animus-ButtonForeground-7e799f39--size-lg {
          padding-left: 2rem;
          padding-right: 2rem;
          font-size: 1.375rem;
          line-height: 48px;
          padding-bottom: 0.125rem;
          min-height: __TRANSFORM__size__48__;
          min-width: __TRANSFORM__size__100__;
        }
        .animus-ButtonForeground-7e799f39--variant-stroke {
          position: relative;
          z-index: 1;
          user-select: none;
        }
      }

      "
    `);
  });

  test('deterministic', () => {
    const r2 = extract(source, 'button.tsx', theme, variableMap, config, '{}');
    expect(r2.css).toBe(result.css);
  });
});

/**
 * LAYER 2: Single-file, styles + states + groups + JSX system props
 * Breaks if: JSX scanning, utility CSS generation, @layer system
 * emission, or system prop class mapping changes.
 */
describe('snapshot: system props', () => {
  const source = readFileSync(join(FIXTURES, 'system-props.tsx'), 'utf-8');
  const result = extract(
    source,
    'system-props.tsx',
    theme,
    variableMap,
    config,
    groupRegistry
  );

  const EXPECTED_CSS = `@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;

@layer anm-base {
  .animus-Box-46626db7 {
    display: flex;
    position: relative;
  }
  .animus-Text-597c55c1 {
    margin: 0;
  }
}

@layer anm-states {
  .animus-Box-46626db7--hidden {
    opacity: 0;
    visibility: hidden;
  }
}

@layer anm-system {
  .animus-u-50e5d508 {
    padding: 0.5rem;
  }
  .animus-u-c332c59e {
    padding: 1rem;
  }
  .animus-u-4377b79a {
    color: var(--color-text);
  }
  .animus-u-ab1427e1 {
    color: var(--color-primary);
  }
  .animus-u-fba93ca3 {
    display: flex;
  }
  .animus-u-43518676 {
    font-size: 1rem;
  }
  .animus-u-b894b13d {
    margin-top: 0.5rem;
  }
  @media (min-width: 768px) {
    .animus-u-b894b13d {
      margin-top: 1rem;
    }
  }
}
`;

  test('CSS matches snapshot', () => {
    expect(result.css).toBe(EXPECTED_CSS);
  });

  test('deterministic', () => {
    const r2 = extract(
      source,
      'system-props.tsx',
      theme,
      variableMap,
      config,
      groupRegistry
    );
    expect(r2.css).toBe(result.css);
  });
});

/**
 * LAYER 3: Multi-file, extension chain + merged styles + utility props
 * Breaks if: import resolution, chain merging, topological CSS ordering,
 * or cross-file provenance changes.
 */
describe('snapshot: extension chains', () => {
  const parentSource = readFileSync(
    join(FIXTURES, 'extension-parent.tsx'),
    'utf-8'
  );
  const childSource = readFileSync(
    join(FIXTURES, 'extension-child.tsx'),
    'utf-8'
  );
  const manifestJson = analyzeProject(
    JSON.stringify([
      { path: 'extension-parent.tsx', source: parentSource },
      { path: 'extension-child.tsx', source: childSource },
    ]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('CSS matches snapshot', () => {
    expect(manifest.css).toMatchInlineSnapshot(`
      "@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;

      @layer anm-base {
        .animus-Anchor-b953fe19 {
          display: inline-block;
          color: var(--color-primary);
          cursor: pointer;
        }
        .animus-NavLink-a586aba1 {
          display: inline-block;
          color: var(--color-primary);
          cursor: pointer;
          text-decoration: none;
        }
      }

      @layer anm-variants {
        @layer standalone, composed;
        @layer standalone {

        .animus-Anchor-b953fe19--variant-ui {
          font-weight: 700;
        }
        .animus-Anchor-b953fe19--variant-text {
          font-weight: 400;
        }
        .animus-NavLink-a586aba1--variant-ui {
          font-weight: 700;
        }
        .animus-NavLink-a586aba1--variant-text {
          font-weight: 400;
        }
        }
        @layer composed {
        }
      }

      @layer anm-states {
        .animus-Anchor-b953fe19--active {
          font-weight: 600;
        }
        .animus-NavLink-a586aba1--active {
          color: var(--color-secondary);
        }
      }

      @layer anm-system {
        .animus-u-50e5d508 {
          padding: 0.5rem;
        }
        .animus-u-43518676 {
          font-size: 1rem;
        }
      }

      "
    `);
  });

  test('deterministic', () => {
    const m2 = JSON.parse(
      analyzeProject(
        JSON.stringify([
          { path: 'extension-parent.tsx', source: parentSource },
          { path: 'extension-child.tsx', source: childSource },
        ]),
        theme,
        variableMap,
        null,
        config,
        groupRegistry,
        '{}'
      )
    );
    expect(m2.css).toBe(manifest.css);
  });

  test('child class contains merged parent styles', () => {
    // NavLink's class block MUST contain parent's display + child's text-decoration
    const navLinkClass = Object.values(
      manifest.components as Record<string, any>
    ).find((c: any) => c.binding === 'NavLink')?.class_name;
    expect(navLinkClass).toBeDefined();
    // Find the CSS rule for NavLink's base class
    const classRule = manifest.css.split(navLinkClass!).slice(1)[0];
    expect(classRule).toContain('display: inline-block');
    expect(classRule).toContain('text-decoration: none');
  });
});

// ---------------------------------------------------------------------------
// Canary: Structured CSS sheets in manifest
// ---------------------------------------------------------------------------

describe('manifest: structured sheets', () => {
  const parentSource = readFileSync(
    join(FIXTURES, 'extension-parent.tsx'),
    'utf-8'
  );
  const childSource = readFileSync(
    join(FIXTURES, 'extension-child.tsx'),
    'utf-8'
  );
  const manifestJson = analyzeProject(
    JSON.stringify([
      { path: 'extension-parent.tsx', source: parentSource },
      { path: 'extension-child.tsx', source: childSource },
    ]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('sheets object exists with all expected fields', () => {
    expect(manifest.sheets).toBeDefined();
    expect(typeof manifest.sheets.declaration).toBe('string');
    expect(typeof manifest.sheets.base).toBe('string');
    expect(typeof manifest.sheets.variants).toBe('string');
    expect(typeof manifest.sheets.states).toBe('string');
    expect(typeof manifest.sheets.system).toBe('string');
    expect(typeof manifest.sheets.custom).toBe('string');
  });

  test('system_prop_map contains shared group prop entries', () => {
    expect(manifest.system_prop_map).toBeDefined();
    expect(typeof manifest.system_prop_map).toBe('object');
    // p prop should exist (from space group)
    expect(manifest.system_prop_map.p).toBeDefined();
    // Each prop maps value keys to class names
    const pEntries = manifest.system_prop_map.p;
    expect(typeof pEntries).toBe('object');
    const classNames = Object.values(pEntries) as string[];
    expect(classNames.length).toBeGreaterThan(0);
    expect(classNames[0]).toMatch(/^animus-u-/);
  });

  test('declaration contains only the layer ordering statement', () => {
    expect(manifest.sheets.declaration).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
    // No rule blocks in the declaration
    expect(manifest.sheets.declaration).not.toContain('{');
  });

  test('base sheet contains @layer base block', () => {
    expect(manifest.sheets.base).toContain('@layer anm-base {');
    expect(manifest.sheets.base).toContain('animus-');
  });

  test('sheets concatenation matches css field', () => {
    // The css field and concatenated sheets should contain the same rules
    expect(manifest.css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
    expect(manifest.css).toContain('@layer anm-base {');
    if (manifest.sheets.variants) {
      expect(manifest.css).toContain('@layer anm-variants {');
    }
    if (manifest.sheets.states) {
      expect(manifest.css).toContain('@layer anm-states {');
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-file / Arc 3 helpers
// ---------------------------------------------------------------------------

/**
 * Run analyzeProject on multiple fixture files and return the parsed manifest.
 * All calls share the same theme, config, and groupRegistry as single-file tests.
 */
function analyzeFixtures(fixtureFiles: { name: string; fixture: string }[]) {
  const fileEntries = fixtureFiles.map((f) => ({
    path: f.name,
    source: readFileSync(join(FIXTURES, f.fixture), 'utf-8'),
  }));
  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  return JSON.parse(manifestJson);
}

describe('extension chains: multi-file', () => {
  const manifest = analyzeFixtures([
    { name: 'extension-parent.tsx', fixture: 'extension-parent.tsx' },
    { name: 'extension-child.tsx', fixture: 'extension-child.tsx' },
  ]);

  test('manifest contains both parent and child components', () => {
    expect(Object.keys(manifest.components).length).toBeGreaterThanOrEqual(2);
    // Find Anchor and NavLink
    const anchorId = Object.keys(manifest.components).find((id) =>
      id.includes('Anchor')
    );
    const navLinkId = Object.keys(manifest.components).find((id) =>
      id.includes('NavLink')
    );
    expect(anchorId).toBeDefined();
    expect(navLinkId).toBeDefined();
  });

  test('child component has extends_from pointing to parent', () => {
    const navLinkId = Object.keys(manifest.components).find((id) =>
      id.includes('NavLink')
    );
    const navLink = manifest.components[navLinkId!];
    expect(navLink.extends_from).toBeTruthy();
    expect(navLink.extends_from).toContain('Anchor');
  });

  test('CSS contains both parent and child class names', () => {
    expect(manifest.css).toContain('animus-Anchor-');
    expect(manifest.css).toContain('animus-NavLink-');
  });

  test('parent rules come before child rules in @layer base', () => {
    const anchorBasePos = manifest.css.indexOf('animus-Anchor-');
    const navLinkBasePos = manifest.css.indexOf('animus-NavLink-');
    expect(anchorBasePos).toBeLessThan(navLinkBasePos);
  });

  test('child CSS includes merged parent styles', () => {
    // NavLink should have display: inline-block from parent + textDecoration: none from child
    // These appear in the child's class rules
    expect(manifest.css).toContain('display: inline-block');
    expect(manifest.css).toContain('text-decoration: none');
  });

  test('child CSS includes merged state override', () => {
    // NavLink overrides active state with { color: 'secondary' }
    // The merged state should have color from child
    expect(manifest.css).toContain('animus-NavLink-');
    expect(manifest.css).toContain('--active');
  });

  test('utility CSS generated from JSX in child file', () => {
    // NavLink used with p={8} and fontSize={16} in JSX
    expect(manifest.css).toContain('@layer anm-system');
    expect(manifest.css).toContain('padding: 0.5rem'); // p={8} → space.8 → 0.5rem
    expect(manifest.css).toContain('font-size: 1rem'); // fontSize={16} → fontSizes.16 → 1rem
  });

  test('provenance graph is correct', () => {
    const navLinkId = Object.keys(manifest.components).find((id) =>
      id.includes('NavLink')
    );
    expect(manifest.provenance[navLinkId!]).toBeTruthy();
    expect(manifest.provenance[navLinkId!].length).toBeGreaterThan(0);
  });

  test('files mapping is correct', () => {
    expect(manifest.files['extension-parent.tsx']).toBeTruthy();
    expect(manifest.files['extension-child.tsx']).toBeTruthy();
    expect(manifest.files['extension-parent.tsx'].length).toBe(1); // Anchor
    expect(manifest.files['extension-child.tsx'].length).toBe(1); // NavLink
  });
});

describe('manifest: transform_file', () => {
  const parentSource = readFileSync(
    join(FIXTURES, 'extension-parent.tsx'),
    'utf-8'
  );
  const childSource = readFileSync(
    join(FIXTURES, 'extension-child.tsx'),
    'utf-8'
  );

  // Build manifest first
  const fileEntries = [
    { path: 'extension-parent.tsx', source: parentSource },
    { path: 'extension-child.tsx', source: childSource },
  ];
  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );

  test('transforms parent file', () => {
    const result = transformFile(
      parentSource,
      'extension-parent.tsx',
      manifestJson
    );
    expect(result.hasComponents).toBe(true);
    expect(result.code).toContain("createComponent('a'");
    expect(result.code).toContain('import { createComponent }');
    expect(result.code).toContain('virtual:animus/styles.css');
  });

  test('transforms child file', () => {
    const result = transformFile(
      childSource,
      'extension-child.tsx',
      manifestJson
    );
    expect(result.hasComponents).toBe(true);
    expect(result.code).toContain("createComponent('a'");
    expect(result.code).toContain('import { createComponent }');
  });

  test('file with no components returns unchanged', () => {
    const plainSource = 'const x = 1;\nexport default x;';
    const result = transformFile(plainSource, 'plain.tsx', manifestJson);
    expect(result.hasComponents).toBe(false);
    expect(result.code).toBe(plainSource);
  });
});

describe('chain recognition: backward compat', () => {
  // Verify the old extract() function still works for non-extension files
  const source = readFileSync(join(FIXTURES, 'button.tsx'), 'utf-8');
  const result = extract(
    source,
    'button.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('extract() still works for primary chains', () => {
    expect(result.extractable).toBe(true);
    expect(result.css).toContain('@layer anm-base');
    expect(result.code).toContain("createComponent('button'");
  });
});

describe('reconciliation: usage elimination', () => {
  const source = readFileSync(join(FIXTURES, 'reconciliation.tsx'), 'utf-8');
  const manifestJson = analyzeProject(
    JSON.stringify([{ path: 'reconciliation.tsx', source }]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('eliminates ghost variant option', () => {
    expect(manifest.css).not.toContain('--variant-ghost');
  });

  test('keeps fill and stroke variant options', () => {
    expect(manifest.css).toContain('--variant-fill');
    expect(manifest.css).toContain('--variant-stroke');
  });

  test('eliminates loading state', () => {
    expect(manifest.css).not.toContain('--loading');
  });

  test('keeps disabled state', () => {
    expect(manifest.css).toContain('--disabled');
  });

  test('eliminates entire Spacer component', () => {
    expect(manifest.css).not.toContain('animus-Spacer-');
  });

  test('keeps Button component', () => {
    expect(manifest.css).toContain('animus-Button-');
  });

  test('default variant kept when rendered without explicit prop', () => {
    // <Button> with no variant prop → default "fill" implicitly used
    expect(manifest.css).toContain('--variant-fill');
  });

  test('extraction report has correct counts', () => {
    expect(manifest.report).toBeDefined();
    expect(manifest.report.variants_eliminated).toBeGreaterThan(0);
    expect(manifest.report.states_eliminated).toBeGreaterThan(0);
    expect(manifest.report.components_eliminated).toBeGreaterThan(0);
  });

  test('extraction report lists eliminated details', () => {
    expect(manifest.report.eliminated_details).toBeDefined();
    const details = manifest.report.eliminated_details;
    expect(details.some((d: any) => d.component === 'Spacer')).toBe(true);
    expect(details.some((d: any) => d.name === 'ghost')).toBe(true);
    expect(details.some((d: any) => d.name === 'loading')).toBe(true);
  });
});

/**
 * LAYER 4: Usage reconciliation — variant/state/component elimination
 * Breaks if: reconciler logic, scan_jsx_usage tracking, or ledger
 * building changes.
 */
describe('snapshot: reconciliation', () => {
  const source = readFileSync(join(FIXTURES, 'reconciliation.tsx'), 'utf-8');
  const manifestJson = analyzeProject(
    JSON.stringify([{ path: 'reconciliation.tsx', source }]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('CSS matches snapshot', () => {
    expect(manifest.css).toMatchInlineSnapshot(`
      "@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;

      @layer anm-base {
        .animus-Button-dc5e33a5 {
          display: inline-flex;
          cursor: pointer;
        }
      }

      @layer anm-variants {
        @layer standalone, composed;
        @layer standalone {

        .animus-Button-dc5e33a5--variant-fill {
          color: var(--color-background);
          background-color: var(--color-primary);
        }
        .animus-Button-dc5e33a5--variant-stroke {
          border: 1px solid;
          color: var(--color-primary);
        }
        .animus-Button-dc5e33a5--variant-default {
          color: var(--color-background);
          background-color: var(--color-primary);
        }
        }
        @layer composed {
        }
      }

      @layer anm-states {
        .animus-Button-dc5e33a5--disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      }

      "
    `);
  });

  test('deterministic', () => {
    const m2 = JSON.parse(
      analyzeProject(
        JSON.stringify([{ path: 'reconciliation.tsx', source }]),
        theme,
        variableMap,
        null,
        config,
        groupRegistry,
        '{}'
      )
    );
    expect(m2.css).toBe(manifest.css);
  });
});

// ===========================================================================
// LAYER 5: Real doc site extraction
//
// The outermost concentric snapshot. Feeds REAL doc site files into
// analyzeProject and captures the complete CSS output. This is the
// ultimate integration test — if this breaks, real-world extraction
// behavior changed.
//
// With package resolution enabled (Arc 5), the pipeline traces imports
// through @animus-ui/components barrel re-exports and extracts all
// components whose JSX usage is visible across the analyzed files.
// ===========================================================================

function discoverFiles(dir: string, exts: Set<string>): string[] {
  const results: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      if (['node_modules', 'dist', '.next', 'target'].includes(entry)) continue;
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) results.push(...discoverFiles(full, exts));
        else if (exts.has(extname(full))) results.push(full);
      } catch {}
    }
  } catch {}
  return results;
}

describe('snapshot: real doc site', () => {
  const ROOT = join(__dirname, '../../..');
  const dirs = [
    join(ROOT, 'legacy/ui/src'), // full UI package source (barrel + elements) — archived under legacy/ but retained as a realistic multi-package fixture for this canary
    join(ROOT, 'legacy/_docs/elements'),
    join(ROOT, 'legacy/_docs/components'),
    join(ROOT, 'legacy/_docs/pages'),
  ];
  const exts = new Set(['.tsx', '.ts']);
  const allFiles: string[] = [];
  for (const d of dirs) allFiles.push(...discoverFiles(d, exts));
  allFiles.sort(); // deterministic order

  const fileEntries = allFiles.map((f) => ({
    path: relative(ROOT, f),
    source: readFileSync(f, 'utf-8'),
  }));

  // Package resolution: map @animus-ui/components to the UI package barrel (now archived under legacy/)
  const layer5PackageMap = JSON.stringify({
    '@animus-ui/components': 'legacy/ui/src/index.ts',
  });

  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    layer5PackageMap
  );
  const manifest = JSON.parse(manifestJson);

  test('finds components across all packages', () => {
    expect(Object.keys(manifest.components).length).toBeGreaterThanOrEqual(23);
  });

  test('package resolution enables more component extraction', () => {
    expect(manifest.report.components_extracted).toBeGreaterThanOrEqual(8);
  });

  test('CSS output matches snapshot', () => {
    expect(manifest.css).toMatchInlineSnapshot(`
      "@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;

      @layer anm-base {
        .animus-HeaderSection-316fe883 {
          gap: 1.5rem;
          flex: 1;
          display: grid;
          grid-auto-flow: column;
          align-items: center;
        }
        @media (min-width: 768px) {
          .animus-HeaderSection-316fe883 {
            gap: 2rem;
          }
        }
        .animus-Line-144857e3 {
          display: table-row;
        }
        .animus-Pre-3fb568ba {
          padding: 1.5rem;
          font-family: monospace;
          font-size: 0.875rem;
          position: relative;
        }
        @media (min-width: 480px) {
          .animus-Pre-3fb568ba {
            font-size: 1rem;
          }
        }
        .animus-Token-f8b808ce {
          transition: 100ms linear text-shadow;
        }
        .animus-Logo-69aaff4e {
          margin: 0;
          transition: 100ms linear text-shadow;
          width: max-content;
          font-size: 1.875rem;
          line-height: initial;
          font-family: logo;
          letter-spacing: 2px;
          background-image: flowX;
          background-size: 300px 100px;
          text-shadow: logo;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .animus-Menu-d9841c8a {
          padding: 2rem;
          padding-top: 0.75rem;
          padding-bottom: 0.75rem;
          list-style-type: none;
        }
        .animus-MenuItem-d64fc581 {
          padding: 0.25rem;
          font-size: 1.125rem;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-ButtonContainer-a22398ea {
          padding: 0;
          border: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          box-shadow: none;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
          letter-spacing: 1px;
          position: relative;
          cursor: pointer;
          user-select: none;
        }
        .animus-FlowLink-b07cd803 {
          transition: 100ms linear text-shadow;
          font-weight: 400;
          background-image: flowX;
          background-size: 100px;
          text-shadow: flush;
          font-family: 'Geist', sans-serif;
          letter-spacing: 0.5px;
          position: relative;
          top: 2px;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .animus-FlowLink-b07cd803:hover {
          font-weight: 700;
          text-shadow: link-hover;
        }
        .animus-FlowLink-b07cd803:active {
          text-shadow: link-pressed;
        }
        .animus-FlowText-be58f3e3 {
          font-size: 1.125rem;
          font-weight: 500;
          letter-spacing: 1px;
          background-color: transparent;
          background-image: flowX;
          background-size: 300px 100px;
          text-shadow: link-raised;
          position: relative;
          top: 2px;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .animus-VariableProvider-e486499f {
          color: var(--color-text);
        }
        .animus-FlexBox-69d7c5b6 {
          display: flex;
        }
        .animus-GridBox-8b414422 {
          display: grid;
        }
        .animus-Li-b0c8e227 {
          margin: 0;
        }
        .animus-Ol-b0d0fb33 {
          margin-bottom: 1rem;
          padding-left: 1rem;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Ul-b086c289 {
          margin-bottom: 1rem;
          padding-left: 1rem;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c {
          margin: 0;
        }
      }

      @layer anm-variants {
        @layer standalone, composed;
        @layer standalone {

        .animus-HeaderSection-316fe883--direction-right {
          justify-content: end;
        }
        .animus-ButtonContainer-a22398ea--variant-fill {
          transition: 500ms ease background-position;
          color: var(--color-background);
          background-color: transparent;
          background-image: flowX;
          background-size: 300px 100%;
          background-position: 0% 0%;
        }
        .animus-ButtonContainer-a22398ea--variant-fill:hover {
          background-position: -100px 0%;
        }
        .animus-ButtonContainer-a22398ea--variant-fill:active:hover {
          background-position: -400px 0%;
        }
        .animus-ButtonContainer-a22398ea--variant-stroke::before {
          transition: 500ms ease background-position;
          position: absolute;
          border-radius: 4px;
          background-image: flowX;
          background-size: 300px 100px;
          background-position: 0px 0%;
          top: 0;
          right: 0;
          bottom: 0;
          left: 0;
          background-color: var(--color-background-current);
          z-index: 0;
          content: "";
        }
        .animus-ButtonContainer-a22398ea--variant-stroke::after {
          top: 2;
          right: 2;
          bottom: 2;
          left: 2;
          border-radius: 2px;
          background-color: var(--color-background-current);
          z-index: 0;
          position: absolute;
          content: "";
        }
        .animus-ButtonContainer-a22398ea--variant-stroke:hover:before {
          background-position: -100px 0%;
        }
        .animus-ButtonContainer-a22398ea--variant-stroke:active:hover:before {
          background-position: -400px 0%;
        }
        .animus-ButtonForeground-80332c26--size-sm {
          padding-left: 0.5rem;
          padding-right: 0.5rem;
          font-size: 0.875rem;
          line-height: 26px;
          padding-bottom: 0.125rem;
          min-height: 28;
          min-width: 60;
        }
        .animus-ButtonForeground-80332c26--size-lg {
          padding-left: 2rem;
          padding-right: 2rem;
          font-size: 1.375rem;
          line-height: 48px;
          padding-bottom: 0.125rem;
          min-height: 48;
          min-width: 100;
        }
        .animus-ButtonForeground-80332c26--variant-stroke {
          flex: 1;
          transition: 500ms ease background-position;
          position: relative;
          z-index: 1;
          width: 1;
          height: 1;
          display: inline-block;
          background-image: flowX;
          background-size: 300px 100px;
          background-position: 0px 0%;
          user-select: none;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .animus-ButtonForeground-80332c26--variant-stroke:hover {
          background-position: -100px 0%;
        }
        .animus-ButtonForeground-80332c26--variant-stroke:active:hover {
          background-position: -400px 0%;
        }
        .animus-Text-6eedad8c--as-h1 {
          font-size: 4rem;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-h2 {
          font-size: 2.75rem;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-h3 {
          font-size: 2.125rem;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-h4 {
          font-size: 1.625rem;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-h5 {
          font-size: 1.375rem;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-h6 {
          font-size: 1.125rem;
          font-weight: 700;
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-p {
          line-height: calc(2px + 2.8ex + 2px);
        }
        .animus-Text-6eedad8c--as-small {
          font-size: 0.875rem;
        }
        }
        @layer composed {
        }
      }

      @layer anm-states {
        .animus-Logo-69aaff4e--link {
          animation: none;
        }
        .animus-Logo-69aaff4e--link:hover {
          text-shadow: logo-hover;
        }
        .animus-Logo-69aaff4e--link:active {
          text-shadow: link-pressed;
        }
        .animus-Menu-d9841c8a--submenu {
          padding-left: 0;
          padding-right: 0;
          padding-top: 0.5rem;
          padding-bottom: 0.75rem;
        }
        .animus-FlowLink-b07cd803--raised {
          font-weight: 700;
          text-shadow: link-raised;
        }
        .animus-FlowLink-b07cd803--raised:hover {
          text-shadow: link-hover-raised;
        }
        .animus-FlowLink-b07cd803--active {
          font-weight: 700;
          text-shadow: link-raised;
        }
        .animus-FlowText-be58f3e3--bare {
          top: 0px;
          font-size: inherit;
          text-shadow: none;
          display: inline-block;
        }
        .animus-Box-1e3f1d38--fit {
          width: 1;
          height: 1;
        }
        .animus-Box-1e3f1d38--isolate {
          position: relative;
          z-index: 1;
        }
        .animus-FlexBox-69d7c5b6--center {
          justify-content: center;
          align-items: center;
        }
        .animus-FlexBox-69d7c5b6--column {
          flex-direction: column;
        }
        .animus-GridBox-8b414422--fit {
          width: 1;
          height: 1;
        }
        .animus-GridBox-8b414422--isolate {
          position: relative;
          z-index: 1;
        }
        .animus-GridBox-8b414422--center {
          justify-content: center;
          align-items: center;
        }
        .animus-GridBox-8b414422--row {
          grid-auto-flow: row;
        }
        .animus-GridBox-8b414422--column {
          grid-auto-flow: column;
        }
        .animus-Ol-b0d0fb33--plain {
          margin: 0;
          padding: 0;
        }
        .animus-Ul-b086c289--plain {
          margin: 0;
          padding: 0;
        }
      }

      @layer anm-system {
        .animus-u-e89af0e6 {
          margin: 0;
        }
        .animus-u-ad8bb6ca {
          gap: 1.5rem;
        }
        .animus-dyn-bg {
          background-color: var(--animus-bg);
        }
        .animus-u-513be584 {
          background-color: var(--color-background-current);
        }
        .animus-u-cf1110ae {
          background-color: var(--color-syntax-background);
        }
        @media (min-width: 480px) {
          .animus-dyn-bg-xs {
            background-color: var(--animus-bg-xs);
          }
        }
        @media (min-width: 768px) {
          .animus-dyn-bg-sm {
            background-color: var(--animus-bg-sm);
          }
        }
        @media (min-width: 1024px) {
          .animus-dyn-bg-md {
            background-color: var(--animus-bg-md);
          }
        }
        @media (min-width: 1200px) {
          .animus-dyn-bg-lg {
            background-color: var(--animus-bg-lg);
          }
        }
        @media (min-width: 1440px) {
          .animus-dyn-bg-xl {
            background-color: var(--animus-bg-xl);
          }
        }
        .animus-u-928188b3 {
          background-image: flowBgX;
        }
        .animus-u-ab1427e1 {
          color: var(--color-primary);
        }
        .animus-u-6617225d {
          display: none;
        }
        @media (min-width: 480px) {
          .animus-u-6617225d {
            display: flex;
          }
        }
        .animus-u-7424fb53 {
          font-family: 'IBM Plex Mono', monospace;
        }
        .animus-u-036780e0 {
          font-size: 1.125rem;
        }
        @media (min-width: 480px) {
          .animus-u-036780e0 {
            font-size: 1.375rem;
          }
        }
        @media (min-width: 1024px) {
          .animus-u-036780e0 {
            font-size: 1.625rem;
          }
        }
        .animus-u-35d1de23 {
          font-size: 0.875rem;
        }
        .animus-u-409732dd {
          font-size: 1.625rem;
        }
        @media (min-width: 768px) {
          .animus-u-409732dd {
            font-size: 2.125rem;
          }
        }
        .animus-u-43518676 {
          font-size: 1rem;
        }
        .animus-u-cf2103b3 {
          font-size: 1.375rem;
        }
        @media (min-width: 768px) {
          .animus-u-cf2103b3 {
            font-size: 1.625rem;
          }
        }
        .animus-u-d794ef4b {
          font-size: 1.25rem;
        }
        @media (min-width: 768px) {
          .animus-u-d794ef4b {
            font-size: 1.375rem;
          }
        }
        .animus-u-fda600e3 {
          font-size: 1rem;
        }
        @media (min-width: 768px) {
          .animus-u-fda600e3 {
            font-size: 1.125rem;
          }
        }
        .animus-u-03300cad {
          font-weight: 700;
        }
        .animus-u-698aa09a {
          font-weight: 400;
        }
        .animus-u-eab07453 {
          font-weight: 500;
        }
        .animus-u-f77b155c {
          font-weight: 600;
        }
        .animus-u-18431030 {
          height: 1px;
        }
        .animus-u-5ecf4959 {
          letter-spacing: 1px;
        }
        .animus-u-29920021 {
          logo-size: md;
        }
        @media (min-width: 480px) {
          .animus-u-29920021 {
            logo-size: lg;
          }
        }
        @media (min-width: 768px) {
          .animus-u-29920021 {
            logo-size: xl;
          }
        }
        @media (min-width: 1200px) {
          .animus-u-29920021 {
            logo-size: xxl;
          }
        }
        .animus-u-13dc4ab5 {
          margin-bottom: 1rem;
        }
        .animus-u-27b60d7c {
          margin-bottom: 1.5rem;
        }
        .animus-u-b634bc2b {
          margin-bottom: 0.5rem;
        }
        .animus-u-f22d713c {
          margin-right: 0.25rem;
        }
        .animus-u-0e7f24d5 {
          margin-top: 3rem;
          margin-bottom: 3rem;
        }
        .animus-u-307728eb {
          margin-top: 1.5rem;
        }
        @media (min-width: 768px) {
          .animus-u-307728eb {
            margin-top: 0;
          }
        }
        .animus-u-44869ead {
          margin-top: 1.5rem;
          margin-bottom: 1.5rem;
        }
        .animus-u-5ae615a9 {
          margin-top: 2rem;
          margin-bottom: 2rem;
        }
        .animus-u-00592666 {
          max-width: 720;
        }
        .animus-u-4a084f5a {
          max-width: 1;
        }
        .animus-u-f836914d {
          padding-bottom: 4rem;
        }
        .animus-u-d1d2ac9b {
          padding-top: 4rem;
          padding-bottom: 4rem;
        }
        .animus-u-f55739b5 {
          padding-top: 2rem;
          padding-bottom: 2rem;
        }
        @media (min-width: 768px) {
          .animus-u-f55739b5 {
            padding-top: 4rem;
            padding-bottom: 4rem;
          }
        }
        .animus-u-8803e93e {
          text-align: center;
        }
        .animus-u-e19b4d12 {
          text-transform: capitalize;
        }
        .animus-dyn-width {
          width: var(--animus-width);
        }
        .animus-u-3a3dd994 {
          width: 640;
        }
        @media (min-width: 480px) {
          .animus-dyn-width-xs {
            width: var(--animus-width-xs);
          }
        }
        @media (min-width: 768px) {
          .animus-dyn-width-sm {
            width: var(--animus-width-sm);
          }
        }
        @media (min-width: 1024px) {
          .animus-dyn-width-md {
            width: var(--animus-width-md);
          }
        }
        @media (min-width: 1200px) {
          .animus-dyn-width-lg {
            width: var(--animus-width-lg);
          }
        }
        @media (min-width: 1440px) {
          .animus-dyn-width-xl {
            width: var(--animus-width-xl);
          }
        }
      }

      @layer anm-custom {
        .animus-dyn-69aaff4e-logo-size {
          font-size: var(--animus-logo-size);
        }
        .animus-u-32669d2c {
          font-size: 64;
        }
        @media (min-width: 480px) {
          .animus-u-32669d2c {
            font-size: 72;
          }
        }
        @media (min-width: 768px) {
          .animus-u-32669d2c {
            font-size: 96;
          }
        }
        @media (min-width: 1200px) {
          .animus-u-32669d2c {
            font-size: 128;
          }
        }
        @media (min-width: 480px) {
          .animus-dyn-69aaff4e-logo-size-xs {
            font-size: var(--animus-logo-size-xs);
          }
        }
        @media (min-width: 768px) {
          .animus-dyn-69aaff4e-logo-size-sm {
            font-size: var(--animus-logo-size-sm);
          }
        }
        @media (min-width: 1024px) {
          .animus-dyn-69aaff4e-logo-size-md {
            font-size: var(--animus-logo-size-md);
          }
        }
        @media (min-width: 1200px) {
          .animus-dyn-69aaff4e-logo-size-lg {
            font-size: var(--animus-logo-size-lg);
          }
        }
        @media (min-width: 1440px) {
          .animus-dyn-69aaff4e-logo-size-xl {
            font-size: var(--animus-logo-size-xl);
          }
        }
      }

      "
    `);
  });

  test('deterministic', () => {
    const m2 = JSON.parse(
      analyzeProject(
        JSON.stringify(fileEntries),
        theme,
        variableMap,
        null,
        config,
        groupRegistry,
        layer5PackageMap
      )
    );
    expect(m2.css).toBe(manifest.css);
  });

  test('extraction report is present', () => {
    expect(manifest.report.components_total).toBeGreaterThanOrEqual(23);
    expect(manifest.report.variants_total).toBeGreaterThan(0);
    expect(manifest.report.states_total).toBeGreaterThan(0);
  });

  test('dynamic_props populated with correct metadata', () => {
    const dp = manifest.dynamic_props;
    // Should have at least one dynamic prop if the doc site uses any identifiers/expressions
    if (Object.keys(dp).length > 0) {
      for (const [_propName, meta] of Object.entries(dp) as [string, any][]) {
        // var_name should be kebab-case with --animus- prefix
        expect(meta.var_name).toMatch(/^--animus-[a-z-]+$/);
        // slot_class should start with animus-dyn-
        expect(meta.slot_class).toMatch(/^animus-dyn-[a-z-]+$/);
        // property should be a non-empty CSS property
        expect(meta.property.length).toBeGreaterThan(0);
        // CSS should contain the slot class
        expect(manifest.css).toContain(meta.slot_class);
        // CSS should contain the var reference
        expect(manifest.css).toContain(`var(${meta.var_name})`);
      }
    }
  });

  test('variable slot CSS uses breakpoint fallback chains', () => {
    const dp = manifest.dynamic_props;
    if (Object.keys(dp).length > 0) {
      // At least one dynamic prop should have breakpoint fallback chains
      const anyProp = Object.values(dp)[0] as any;
      // Fallback chain: var(--animus-{prop}-{bp}, var(--animus-{prop}))
      const fallbackPattern = `var(${anyProp.var_name}-`;
      expect(manifest.css).toContain(fallbackPattern);
    }
  });

  test('dynamicPropConfig in replacement when dynamic props present', () => {
    const dp = manifest.dynamic_props;
    if (Object.keys(dp).length > 0) {
      // At least one component should have dynamicPropConfig as 5th arg
      const hasAnyDynamic = Object.values(manifest.components).some((c: any) =>
        c.replacement.includes('dynamicPropConfig')
      );
      expect(hasAnyDynamic).toBe(true);
    }
  });
});

// ===========================================================================
// PACKAGE RESOLUTION TESTS
//
// Validates that the analyze_project NAPI function correctly routes
// package-specifier imports (e.g. @my-ui/components) to their barrel files
// using the package_resolution_json map, enabling cross-package JSX usage
// tracking and reconciliation.
// ===========================================================================

describe('chain recognition: package resolution', () => {
  const barrelSource = readFileSync(
    join(FIXTURES, 'pkg-barrel/index.ts'),
    'utf-8'
  );
  const boxSource = readFileSync(
    join(FIXTURES, 'pkg-barrel/elements/Box.tsx'),
    'utf-8'
  );
  const consumerSource = readFileSync(
    join(FIXTURES, 'pkg-consumer.tsx'),
    'utf-8'
  );

  // Package resolution map: @my-ui/components → the barrel file
  const packageMap = JSON.stringify({
    '@my-ui/components': 'pkg-barrel/index.ts',
  });

  const manifestJson = analyzeProject(
    JSON.stringify([
      { path: 'pkg-barrel/index.ts', source: barrelSource },
      { path: 'pkg-barrel/elements/Box.tsx', source: boxSource },
      { path: 'pkg-consumer.tsx', source: consumerSource },
    ]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    packageMap
  );
  const manifest = JSON.parse(manifestJson);

  test('resolves components through package barrel import', () => {
    // Box and FlexBox should be found (defined in pkg-barrel/elements/Box.tsx)
    const ids = Object.keys(manifest.components);
    expect(ids.some((id) => id.includes('Box'))).toBe(true);
    expect(ids.some((id) => id.includes('FlexBox'))).toBe(true);
  });

  test('reconciliation keeps package-imported components', () => {
    // Box and FlexBox are rendered via package import in consumer JSX
    expect(manifest.css).toContain('animus-Box-');
    expect(manifest.css).toContain('animus-FlexBox-');
    expect(manifest.css).toContain('animus-Card-');
  });

  test('utility CSS from package component callsites', () => {
    // <Box p={8}> and <FlexBox p={16}> produce utility classes
    expect(manifest.css).toContain('@layer anm-system');
    expect(manifest.css).toContain('padding: 0.5rem'); // p={8}
    expect(manifest.css).toContain('padding: 1rem'); // p={16}
  });

  test('responsive utility from package component callsite', () => {
    // <Box mt={{ _: 8, sm: 16 }}> produces responsive utility
    expect(manifest.css).toContain('margin-top: 0.5rem');
    expect(manifest.css).toContain('@media (min-width: 768px)');
    expect(manifest.css).toContain('margin-top: 1rem');
  });

  test('backward compat: empty package map works', () => {
    const m2 = JSON.parse(
      analyzeProject(
        JSON.stringify([{ path: 'pkg-consumer.tsx', source: consumerSource }]),
        theme,
        variableMap,
        null,
        config,
        groupRegistry,
        '{}'
      )
    );
    // Without the package map, Box/FlexBox are unresolvable
    // Only Card (defined in consumer) should be found
    const ids = Object.keys(m2.components);
    expect(ids.some((id) => id.includes('Card'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Correctness: Unknown chain method bail
// ---------------------------------------------------------------------------

describe('chain recognition: bail conditions', () => {
  // A source file that uses a method not in CHAIN_METHODS.
  // The extractor must bail (not silently skip the unknown method).
  const unknownMethodSource = `
import { animus } from '@animus-ui/core';
export const Box = animus.styles({ display: 'flex' }).unknownFutureMethod({}).asElement('div');
`.trim();

  const result = extract(
    unknownMethodSource,
    'unknown-method.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('bails on unknown chain method', () => {
    // The chain should not be extracted — the result is not extractable.
    expect(result.extractable).toBe(false);
  });

  test('source code is unchanged when bail occurs', () => {
    expect(result.code).toBe(unknownMethodSource);
  });

  test('error reports the unknown method name', () => {
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('unknown chain method');
  });

  test('no CSS generated for bailed chain', () => {
    expect(result.css).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Correctness: Dead import stripping after transformation
// ---------------------------------------------------------------------------

describe('transform emission: dead import stripping', () => {
  // Use the button fixture — it imports `animus` from `@animus-ui/core` and has two
  // extractable primary chains. After extraction the `animus` import is dead code.
  const buttonSource = readFileSync(join(FIXTURES, 'button.tsx'), 'utf-8');
  const result = extract(
    buttonSource,
    'button.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
  });

  test('strips dead @animus-ui/core import from transformed output', () => {
    // The original source imports `animus` from `@animus-ui/core`.
    // After extraction, that import is dead — it must be removed.
    expect(result.code).not.toContain(
      "import { animus } from '@animus-ui/core'"
    );
  });

  test('runtime import is present', () => {
    expect(result.code).toContain(
      "import { createComponent } from '@animus-ui/system'"
    );
  });

  test('transformFile also strips dead import', () => {
    // Verify the same stripping occurs via the project-level transform_file path.
    const manifestJson = analyzeProject(
      JSON.stringify([{ path: 'button.tsx', source: buttonSource }]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const tfResult = transformFile(buttonSource, 'button.tsx', manifestJson);
    expect(tfResult.hasComponents).toBe(true);
    expect(tfResult.code).not.toContain(
      "import { animus } from '@animus-ui/core'"
    );
    expect(tfResult.code).toContain(
      "import { createComponent } from '@animus-ui/system'"
    );
  });
});

// ── Per-property bail tests ──────────────────────────────────────────────────

describe('style evaluation: per-property bail', () => {
  const source = readFileSync(join(FIXTURES, 'per-property-bail.tsx'), 'utf-8');
  const result = extract(
    source,
    'per-property-bail.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('Hero extracts with partial styles (skips non-static background)', () => {
    expect(result.extractable).toBe(true);
    // Hero has static display, color, p — these should all be extracted
    expect(result.css).toContain('animus-Hero-');
    expect(result.css).toContain('display: flex');
    expect(result.css).toContain('color: var(--color-primary)');
    expect(result.css).toContain('padding: 1.5rem');
  });

  test('Hero skip warning for non-static background', () => {
    const skipWarnings = result.errors.filter((e: string) =>
      e.startsWith('[skip]')
    );
    const heroSkips = skipWarnings.filter((e: string) => e.includes('Hero'));
    expect(heroSkips.length).toBeGreaterThan(0);
    expect(heroSkips.some((e: string) => e.includes('background'))).toBe(true);
  });

  test('HoverCard extracts with per-property skip inside pseudo block', () => {
    // HoverCard has p: 16 in base, and &:hover with { color: hoverColor, bg: 'secondary' }
    // color should be skipped inside hover, bg should be extracted
    expect(result.css).toContain('animus-HoverCard-');
    expect(result.css).toContain('padding: 1rem');
    // The :hover block should have the static bg extracted
    expect(result.css).toContain(':hover');
  });

  test('SpreadComponent bails entirely (structural bail)', () => {
    // Spread is structural — the entire component should fail to extract.
    // It should NOT have a class name in the CSS.
    expect(result.css).not.toContain('animus-SpreadComponent-');
    // Should have an error (not a skip) for SpreadComponent
    const spreadErrors = result.errors.filter(
      (e: string) => e.includes('SpreadComponent') && !e.startsWith('[skip]')
    );
    expect(spreadErrors.length).toBeGreaterThan(0);
    expect(spreadErrors[0]).toContain('spread');
  });

  test('skip warnings do not prevent extraction', () => {
    // Even with skip warnings, extractable is true because Hero and HoverCard have static properties
    expect(result.extractable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Token Alias Syntax
// ---------------------------------------------------------------------------

describe('token alias resolution', () => {
  const source = readFileSync(join(FIXTURES, 'token-alias.tsx'), 'utf-8');
  const result = extract(
    source,
    'token-alias.tsx',
    theme,
    variableMap,
    config,
    '{}'
  );

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
  });

  test('Card: resolves {colors.primary} to var reference in compound border', () => {
    expect(result.css).toContain('border: 1px solid var(--color-primary)');
  });

  test('Overlay: resolves {colors.primary/50} to color-mix', () => {
    expect(result.css).toContain(
      'background: color-mix(in srgb, var(--color-primary) 50%, transparent)'
    );
  });

  test('Shadow: resolves alpha alias in box-shadow compound', () => {
    expect(result.css).toContain(
      'box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 20%, transparent)'
    );
  });

  test('Broken: unresolved alias passes through as-is', () => {
    // {colors.nonexistent} should remain in the output since it can't be resolved
    expect(result.css).toContain('{colors.nonexistent}');
  });

  test('non-alias properties still resolve normally', () => {
    // p: 16 → padding: 1rem (via standard scale lookup)
    expect(result.css).toContain('padding: 1rem');
    // p: 8 → padding: 0.5rem
    expect(result.css).toContain('padding: 0.5rem');
    // display: 'flex' → display: flex (passthrough)
    expect(result.css).toContain('display: flex');
  });
});

// ─── Bug reproduction: variant + groups in analyzeProject ───────────

describe('reconciliation: multi-component analysis', () => {
  const defSource = readFileSync(join(FIXTURES, 'variant-groups.tsx'), 'utf-8');

  // Consumer file that renders the components inside .map() and directly
  const consumerSource = `
    import { StratumRow, SimpleVariantGroups, VariantOnly, GroupsOnly } from './variant-groups';
    export default function App() {
      const items = [1, 2, 3];
      return (
        <>
          {items.map((i) => (
            <StratumRow key={i} kind="terminal" />
          ))}
          <SimpleVariantGroups />
          <VariantOnly kind="active" />
          <GroupsOnly p={8} />
        </>
      );
    }
  `;

  // Per-file extract should work for all components
  const perFileResult = extract(
    defSource,
    'variant-groups.tsx',
    theme,
    variableMap,
    config,
    groupRegistry
  );

  // analyzeProject with both definition and consumer files
  const manifestJson = analyzeProject(
    JSON.stringify([
      { path: 'variant-groups.tsx', source: defSource },
      { path: 'app.tsx', source: consumerSource },
    ]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('per-file extract includes all 4 components', () => {
    expect(perFileResult.extractable).toBe(true);
    expect(perFileResult.css).toContain('StratumRow');
    expect(perFileResult.css).toContain('SimpleVariantGroups');
    expect(perFileResult.css).toContain('VariantOnly');
    expect(perFileResult.css).toContain('GroupsOnly');
  });

  test('analyzeProject manifest includes all 4 components', () => {
    const comps = manifest.files?.['variant-groups.tsx'] || [];
    expect(comps).toContain('variant-groups.tsx::StratumRow');
    expect(comps).toContain('variant-groups.tsx::SimpleVariantGroups');
    expect(comps).toContain('variant-groups.tsx::VariantOnly');
    expect(comps).toContain('variant-groups.tsx::GroupsOnly');
  });

  test('analyzeProject CSS includes all components (reconciler keeps rendered)', () => {
    expect(manifest.css).toContain('StratumRow');
    expect(manifest.css).toContain('VariantOnly');
    expect(manifest.css).toContain('GroupsOnly');
    expect(manifest.css).toContain('SimpleVariantGroups');
  });

  test('reconciler recognizes .map() callback JSX usage', () => {
    // StratumRow is rendered inside items.map() — scanner must walk CallExpression args
    const report = manifest.report;
    const eliminated = (report?.eliminated_details || []).map(
      (d: any) => d.component
    );
    expect(eliminated).not.toContain('StratumRow');
  });
});

// ─── Variant/state tracking inside .map() callbacks ─────────────────

describe('reconciliation: .map() callback tracking', () => {
  const defSource = readFileSync(join(FIXTURES, 'variant-groups.tsx'), 'utf-8');

  // Consumer that renders TrackedVariant inside .map() with only 'active' value
  // and once with no prop (implicit default 'idle')
  const consumerSource = `
    import { TrackedVariant } from './variant-groups';
    export default function App() {
      const items = [1, 2, 3];
      return (
        <>
          {items.map((i) => (
            <TrackedVariant key={i} mode="active" />
          ))}
          <TrackedVariant />
        </>
      );
    }
  `;

  const manifestJson = analyzeProject(
    JSON.stringify([
      { path: 'variant-groups.tsx', source: defSource },
      { path: 'app.tsx', source: consumerSource },
    ]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('TrackedVariant is not eliminated as component', () => {
    const componentEliminations = (manifest.report?.eliminated_details || [])
      .filter((d: any) => d.kind === 'component')
      .map((d: any) => d.component);
    expect(componentEliminations).not.toContain('TrackedVariant');
    // But it IS in rendered_components
    expect(manifest.usage?.rendered_components).toContain('TrackedVariant');
  });

  test('variant "active" used inside .map() is kept', () => {
    // The CSS should contain the active variant class
    expect(manifest.css).toContain('TrackedVariant');
    // Check that active variant option survives reconciliation
    const eliminated = (manifest.report?.eliminated_details || []).filter(
      (d: any) => d.component === 'TrackedVariant' && d.kind === 'variant'
    );
    const prunedNames = eliminated.map((d: any) => d.name);
    expect(prunedNames).not.toContain('active');
  });

  test('default variant "idle" used via absent prop is kept', () => {
    // <TrackedVariant /> with no mode prop → __default__ → resolves to 'idle'
    const eliminated = (manifest.report?.eliminated_details || []).filter(
      (d: any) => d.component === 'TrackedVariant' && d.kind === 'variant'
    );
    const prunedNames = eliminated.map((d: any) => d.name);
    expect(prunedNames).not.toContain('idle');
  });

  test('unused variant "disabled" is pruned', () => {
    // 'disabled' is never used in JSX — should be pruned
    const eliminated = (manifest.report?.eliminated_details || []).filter(
      (d: any) => d.component === 'TrackedVariant' && d.kind === 'variant'
    );
    const prunedNames = eliminated.map((d: any) => d.name);
    expect(prunedNames).toContain('disabled');
  });
});

// ─── Incremental HMR cache canary tests ──────────────────────────────────────

/**
 * Helper: run analyzeProject with optional hashes and dev_mode.
 * Returns the parsed manifest.
 */
function analyzeWithCache(
  files: { path: string; source: string; hash?: string }[],
  devMode?: boolean
) {
  const manifestJson = analyzeProject(
    JSON.stringify(files),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}',
    devMode ?? null
  );
  return JSON.parse(manifestJson);
}

/** Simple content hash for test fixtures. */
function testHash(source: string): string {
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

describe('incremental analysis cache', () => {
  const parentSource = readFileSync(
    join(FIXTURES, 'extension-parent.tsx'),
    'utf-8'
  );
  const childSource = readFileSync(
    join(FIXTURES, 'extension-child.tsx'),
    'utf-8'
  );
  const layoutSource = readFileSync(join(FIXTURES, 'layout.tsx'), 'utf-8');

  // Clean cache state before each test
  beforeEach(() => {
    clearAnalysisCache();
  });

  test('7.1: cached result matches full analysis', () => {
    const files = [
      { path: 'extension-parent.tsx', source: parentSource },
      { path: 'extension-child.tsx', source: childSource },
      { path: 'layout.tsx', source: layoutSource },
    ];

    // First call: no hashes (full analysis, populates nothing in cache)
    const full = analyzeWithCache(files);

    // Second call: same files with hashes (populates cache)
    const filesWithHash = files.map((f) => ({
      ...f,
      hash: testHash(f.source),
    }));
    clearAnalysisCache();
    const firstCached = analyzeWithCache(filesWithHash);

    // Third call: same files + same hashes (should use cache)
    const secondCached = analyzeWithCache(filesWithHash);

    // Structural comparison: same component set
    expect(Object.keys(secondCached.components).sort()).toEqual(
      Object.keys(firstCached.components).sort()
    );

    // Same CSS content
    expect(secondCached.css).toEqual(firstCached.css);

    // Same component count as full analysis
    expect(Object.keys(secondCached.components).length).toEqual(
      Object.keys(full.components).length
    );

    // Each component has matching class_name and extends_from
    for (const id of Object.keys(full.components)) {
      expect(secondCached.components[id]?.class_name).toEqual(
        full.components[id].class_name
      );
      expect(secondCached.components[id]?.extends_from).toEqual(
        full.components[id].extends_from
      );
    }
  });

  test('7.2: changed file reflects edit, unchanged stays same', () => {
    const files = [
      {
        path: 'extension-parent.tsx',
        source: parentSource,
        hash: testHash(parentSource),
      },
      {
        path: 'extension-child.tsx',
        source: childSource,
        hash: testHash(childSource),
      },
    ];

    // First call: populates cache
    const before = analyzeWithCache(files);
    const beforeCount = Object.keys(before.components).length;

    // Modify parent source: change color from 'primary' to 'secondary'
    const modifiedParent = parentSource.replace(
      "color: 'primary'",
      "color: 'secondary'"
    );
    const modifiedFiles = [
      {
        path: 'extension-parent.tsx',
        source: modifiedParent,
        hash: testHash(modifiedParent),
      },
      {
        path: 'extension-child.tsx',
        source: childSource,
        hash: testHash(childSource), // same hash → cache hit
      },
    ];

    // Second call: parent changed, child cached
    const after = analyzeWithCache(modifiedFiles);

    // Parent's CSS should reflect the edit
    expect(after.css).toContain('var(--color-secondary)');

    // Child should still exist and have merged CSS from updated parent
    const childId = Object.keys(after.components).find((id) =>
      id.includes('NavLink')
    );
    expect(childId).toBeDefined();

    // Same number of components
    expect(Object.keys(after.components).length).toEqual(beforeCount);
  });

  test('7.3: dev_mode retains all components but surfaces prospective eliminations', () => {
    // Use reconciliation fixture which has unused variants AND an unrendered component
    const reconSource = readFileSync(
      join(FIXTURES, 'reconciliation.tsx'),
      'utf-8'
    );

    const files = [
      {
        path: 'reconciliation.tsx',
        source: reconSource,
        hash: testHash(reconSource),
      },
    ];

    // Prod mode: reconciliation actually prunes unused variants + unrendered components
    const prodResult = analyzeWithCache(files, false);

    clearAnalysisCache();

    // Dev mode: all variants/components retained, but prospective eliminations surfaced
    const devResult = analyzeWithCache(files, true);

    // Dev CSS ≥ prod CSS (dev keeps everything, prod may prune)
    expect(devResult.css.length).toBeGreaterThanOrEqual(prodResult.css.length);

    // Dev mode must NOT record actual eliminations
    expect(devResult.report?.components_eliminated ?? 0).toBe(0);
    expect(devResult.report?.variants_eliminated ?? 0).toBe(0);
    expect(devResult.report?.states_eliminated ?? 0).toBe(0);

    // But if prod mode eliminated any components, dev must carry matching
    // prospective entries (kind: "prospective_component") so extraction
    // diagnostics can warn at authoring time. This closes the silent
    // dev/build divergence.
    const prodComponentEliminations = (
      prodResult.report?.eliminated_details ?? []
    ).filter((d: { kind: string }) => d.kind === 'component');
    const devProspective = (devResult.report?.eliminated_details ?? []).filter(
      (d: { kind: string }) => d.kind === 'prospective_component'
    );

    expect(devProspective.length).toBe(prodComponentEliminations.length);

    if (devProspective.length > 0) {
      const devBindings = devProspective
        .map((d: { component: string }) => d.component)
        .sort();
      const prodBindings = prodComponentEliminations
        .map((d: { component: string }) => d.component)
        .sort();
      expect(devBindings).toEqual(prodBindings);
      expect(devProspective[0].reason).toContain('would be eliminated');
    }
  });

  test('7.4: extension chain with cached parent reflects parent changes', () => {
    const files = [
      {
        path: 'extension-parent.tsx',
        source: parentSource,
        hash: testHash(parentSource),
      },
      {
        path: 'extension-child.tsx',
        source: childSource,
        hash: testHash(childSource),
      },
    ];

    // First call: populates cache
    analyzeWithCache(files);

    // Modify parent: add a new base style
    const modifiedParent = parentSource.replace(
      "display: 'inline-block',",
      "display: 'inline-block',\n    fontFamily: 'base',"
    );

    const modifiedFiles = [
      {
        path: 'extension-parent.tsx',
        source: modifiedParent,
        hash: testHash(modifiedParent), // different hash → cache miss
      },
      {
        path: 'extension-child.tsx',
        source: childSource,
        hash: testHash(childSource), // same hash → cache hit
      },
    ];

    // Second call: parent re-parsed, child cached, merge runs in topo order
    const after = analyzeWithCache(modifiedFiles);

    // Parent's CSS should contain the new style
    expect(after.css).toContain("font-family: 'Geist', sans-serif");

    // Child's merged CSS should ALSO contain the inherited style
    // (pre-merge child is cached, but merge phase reads fresh parent)
    const childId = Object.keys(after.components).find((id) =>
      id.includes('NavLink')
    );
    expect(childId).toBeDefined();

    // The child's CSS class should appear after the parent's in CSS output
    // (topological ordering: parent before child)
    const parentId = Object.keys(after.components).find((id) =>
      id.includes('Anchor')
    );
    expect(parentId).toBeDefined();

    const parentClassPos = after.css.indexOf(
      after.components[parentId!].class_name
    );
    const childClassPos = after.css.indexOf(
      after.components[childId!].class_name
    );
    expect(parentClassPos).toBeLessThan(childClassPos);
  });
});

// ─── Custom prop (.props()) runtime wiring ──────────────────────────────────

describe('custom props', () => {
  const manifest = analyzeFixtures([
    { name: 'custom-props.tsx', fixture: 'custom-props.tsx' },
  ]);

  test('CSS contains @layer custom with utility classes', () => {
    expect(manifest.css).toContain('@layer anm-custom {');
    // density="compact" should produce a utility class with gap
    expect(manifest.css).toContain('gap:');
  });

  test('custom dynamic prop slot class appears in @layer custom', () => {
    // sizing has dynamic usage (sizing={dynamicSize}) → should have a slot class
    // Slot class is component-scoped: animus-dyn-{hash8}-sizing
    expect(manifest.css).toMatch(/animus-dyn-[a-f0-9]+-sizing/);
    expect(manifest.css).toContain('var(--animus-sizing)');
  });

  test('transformed JS contains customPropMap in config', () => {
    const cardId = Object.keys(manifest.components).find((id) =>
      id.includes('Card')
    );
    expect(cardId).toBeDefined();
    const card = manifest.components[cardId!];
    expect(card.replacement).toContain('customPropMap');
    // density="compact" should be in the custom prop map
    expect(card.replacement).toContain('density');
  });

  test('inline MapScale resolves to correct value', () => {
    // density="compact" should resolve to gap: 4px via inline scale { compact: '4px', ... }
    expect(manifest.css).toContain('gap: 4px');
    // density="loose" should resolve to gap: 16px
    expect(manifest.css).toContain('gap: 16px');
  });

  test('custom prop with negative flag resolves negated scale value', () => {
    // pull={-8} with negative: true should resolve to margin-top: -0.5rem
    expect(manifest.css).toContain('margin-top: -0.5rem');
  });

  test('transformed JS contains customDynamicConfig with inline transform function', () => {
    const cardId = Object.keys(manifest.components).find((id) =>
      id.includes('Card')
    );
    expect(cardId).toBeDefined();
    const card = manifest.components[cardId!];
    // sizing has inline transform function → emitted directly, not via transforms registry
    expect(card.replacement).toContain('customDynamicConfig');
    // Inline function body appears directly in config (not transforms.size)
    expect(card.replacement).toContain('"transform":');
    expect(card.replacement).not.toContain('transforms.size');
    expect(card.replacement).not.toContain('transformName');
  });
});

// ─── Compound variants ──────────────────────────────────────────────────────

describe('compound variants', () => {
  const manifest = analyzeFixtures([
    { name: 'compound-variants.tsx', fixture: 'compound-variants.tsx' },
  ]);

  test('compound CSS emitted in @layer compounds', () => {
    expect(manifest.css).toContain('@layer anm-compounds {');
    expect(manifest.css).toContain('--compound-0');
    expect(manifest.css).toContain('--compound-1');
  });

  test('compound class names use --compound-{index} suffix', () => {
    const compId = Object.keys(manifest.components).find(
      (k) => k.includes('CompoundBtn') && !k.includes('CompoundArrayBtn')
    );
    expect(compId).toBeDefined();
    const comp = manifest.components[compId!];
    expect(comp.replacement).toContain('compounds');
    expect(comp.replacement).toContain('compound-0');
    expect(comp.replacement).toContain('compound-1');
  });

  test('compound config includes conditions and className', () => {
    const compId = Object.keys(manifest.components).find(
      (k) => k.includes('CompoundBtn') && !k.includes('CompoundArrayBtn')
    );
    const comp = manifest.components[compId!];
    // The replacement should contain the condition keys
    expect(comp.replacement).toContain('"size"');
    expect(comp.replacement).toContain('"variant"');
    expect(comp.replacement).toContain('"sm"');
    expect(comp.replacement).toContain('"ghost"');
  });

  test('cascade order: compounds after variants in CSS', () => {
    const variantsPos = manifest.css.indexOf('@layer anm-variants {');
    const compoundsPos = manifest.css.indexOf('@layer anm-compounds {');
    expect(variantsPos).toBeGreaterThan(-1);
    expect(compoundsPos).toBeGreaterThan(-1);
    expect(variantsPos).toBeLessThan(compoundsPos);
  });

  test('array condition: compound extracted with array values', () => {
    const compId = Object.keys(manifest.components).find((k) =>
      k.includes('CompoundArrayBtn')
    );
    expect(compId).toBeDefined();
    const comp = manifest.components[compId!];
    // The replacement should contain array condition values
    expect(comp.replacement).toContain('compounds');
    expect(comp.replacement).toContain('"fill"');
    expect(comp.replacement).toContain('"ghost"');
    // Array conditions should contain both values in an array
    expect(comp.replacement).toContain('compound-0');
  });

  test('array condition: CSS generated for array compound', () => {
    const compId = Object.keys(manifest.components).find((k) =>
      k.includes('CompoundArrayBtn')
    );
    expect(compId).toBeDefined();
    // The compound should produce CSS with letter-spacing
    expect(manifest.css).toContain('letter-spacing');
  });
});

// ─── Negative scale values ──────────────────────────────────────────────────

describe('scale resolution: negative values', () => {
  const manifest = analyzeFixtures([
    { name: 'negative-margin.tsx', fixture: 'negative-margin.tsx' },
  ]);

  test('negative margin resolves to negated scale value', () => {
    // mt: -8 → space.8 = "0.5rem" → "-0.5rem"
    expect(manifest.css).toContain('margin-top: -0.5rem');
  });

  test('negative position resolves to negated scale value', () => {
    // top: -16 → "1rem" → Rust sees negative, but top has transform: size
    // The size transform handles the numeric value
    expect(manifest.css).toMatch(/top:.*-/);
  });

  test('negative margin-left resolves to negated scale value', () => {
    // ml: -4 → space.4 = "0.25rem" → "-0.25rem"
    expect(manifest.css).toContain('margin-left: -0.25rem');
  });

  test('negative system prop usage resolves correctly', () => {
    // <Overlap m={-8} /> as JSX system prop
    expect(manifest.css).toContain('margin: -0.5rem');
  });
});

// ─── .asClass() terminal ────────────────────────────────────────────────────

describe('chain recognition: .asClass() terminal', () => {
  const manifest = analyzeFixtures([
    { name: 'as-class.tsx', fixture: 'as-class.tsx' },
  ]);

  test('static .asClass() chain extracts with CSS in @layer base', () => {
    expect(manifest.css).toContain('@layer anm-base {');
    expect(manifest.css).toContain('display: flex');
  });

  test('dynamic .asClass() chain extracts with variant CSS in @layer variants', () => {
    expect(manifest.css).toContain('@layer anm-variants {');
  });

  test('transform emits createClassResolver for .asClass() chains', () => {
    const cardId = Object.keys(manifest.components).find((k) =>
      k.includes('card')
    );
    expect(cardId).toBeDefined();
    const cardComp = manifest.components[cardId!];
    expect(cardComp.replacement).toContain('createClassResolver');
    expect(cardComp.replacement).not.toContain('createComponent');
  });

  test('transform emits createComponent for .asElement() chains in same file', () => {
    const boxId = Object.keys(manifest.components).find((k) =>
      k.includes('Box')
    );
    expect(boxId).toBeDefined();
    const boxComp = manifest.components[boxId!];
    expect(boxComp.replacement).toContain('createComponent');
    expect(boxComp.replacement).not.toContain('createClassResolver');
  });

  test('dynamic .asClass() includes variant config in replacement', () => {
    const buttonId = Object.keys(manifest.components).find((k) =>
      k.includes('button')
    );
    expect(buttonId).toBeDefined();
    const buttonComp = manifest.components[buttonId!];
    expect(buttonComp.replacement).toContain('createClassResolver');
    expect(buttonComp.replacement).toContain('"size"');
  });
});

// ---------------------------------------------------------------------------
// Contextual vars — resolution, auto-emission, self-referential guard
// ---------------------------------------------------------------------------

describe('contextual variables', () => {
  const source = readFileSync(join(FIXTURES, 'contextual-vars.tsx'), 'utf-8');

  // Build a config with currentVar on bg
  const configWithCurrentVar = JSON.stringify({
    ...JSON.parse(config),
    bg: {
      ...JSON.parse(config).bg,
      currentVar: '--current-bg',
    },
  });

  const localContextualVarsJson = JSON.stringify({
    colors: ['current-bg'],
  });

  const manifestJson = analyzeProject(
    JSON.stringify([{ path: 'contextual-vars.tsx', source }]),
    theme,
    variableMap,
    localContextualVarsJson,
    configWithCurrentVar,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);
  const allCss: string = typeof manifest.css === 'string' ? manifest.css : '';

  test('7.3: contextual var as direct value resolves to var(--name)', () => {
    // Divider has borderColorTop: 'current-bg' (core naming convention)
    // Should resolve to: border-color-top: var(--current-bg)
    expect(allCss).toContain('var(--current-bg)');
    // The Divider component should have the contextual var resolved
    expect(allCss).toContain('animus-Divider');
  });

  test('7.4: token ref {colors.current-bg} resolves to var(--current-bg)', () => {
    // GlowBox has boxShadow: '0 0 8px {colors.current-bg}'
    expect(allCss).toContain('box-shadow: 0 0 8px var(--current-bg)');
  });

  test('7.5: bg auto-emits --current-bg sibling declaration', () => {
    // Card has bg: 'background' → should emit both background-color AND --current-bg
    expect(allCss).toContain('background-color: var(--color-background)');
    expect(allCss).toContain('--current-bg: var(--color-background)');
  });

  test('7.6: self-referential guard — bg: current-bg does NOT emit circular --current-bg', () => {
    // InheritBg has bg: 'current-bg' → should emit background-color: var(--current-bg)
    // but NOT --current-bg: var(--current-bg)
    expect(allCss).toContain('background-color: var(--current-bg)');
    // Count occurrences of --current-bg: var(--current-bg) — should be 0
    const circularPattern = '--current-bg: var(--current-bg)';
    expect(allCss).not.toContain(circularPattern);
  });

  test('7.7: responsive bg emits --current-bg per breakpoint', () => {
    // ResponsiveCard has bg: { _: 'background', md: 'primary' }
    // Default should have --current-bg: var(--color-background)
    // md breakpoint should have --current-bg: var(--color-primary)
    expect(allCss).toContain('--current-bg: var(--color-background)');
    expect(allCss).toContain('--current-bg: var(--color-primary)');
  });
});

// ─── Custom Breakpoint Keys ────────────────────────────────────────────────────

describe('responsive: custom breakpoint keys', () => {
  const customTheme = JSON.stringify({
    'space.8': '0.5rem',
    'space.16': '1rem',
    'colors.primary': '#ff0000',
    'breakpoints.mobile': '480',
    'breakpoints.tablet': '768',
    'breakpoints.desktop': '1024',
  });

  const customSource = `
    import { animus } from '@animus-ui/core';
    export const Card = animus
      .styles({
        padding: { _: 8, tablet: 16 },
        color: 'primary',
      })
      .asElement('div');
    export default function App() {
      return <Card />;
    }
  `;

  const result = extract(
    customSource,
    'custom-bp.tsx',
    customTheme,
    '{}',
    config,
    '{}'
  );

  test('extracts with custom breakpoint keys', () => {
    expect(result.extractable).toBe(true);
  });

  test('generates @media query for custom breakpoint', () => {
    expect(result.css).toContain('@media (min-width: 768px)');
  });

  test('default value appears outside media query', () => {
    // padding: 8 is the default (no media query) — raw passthrough since padding isn't in prop config
    expect(result.css).toContain('padding: 8');
  });

  test('responsive value appears inside media query', () => {
    // tablet breakpoint (768px) should contain the responsive padding value
    expect(result.css).toContain('@media (min-width: 768px)');
    expect(result.css).toContain('padding: 16');
  });

  // Multi-breakpoint test: verifies that multiple custom breakpoints produce
  // distinct @media queries (catches ordering/detection regressions)
  const multiSource = `
    import { animus } from '@animus-ui/core';
    export const Box = animus
      .styles({
        padding: { _: 8, mobile: 12, tablet: 16, desktop: 24 },
      })
      .asElement('div');
    export default function App() {
      return <Box />;
    }
  `;

  const multiResult = extract(
    multiSource,
    'multi-bp.tsx',
    customTheme,
    '{}',
    config,
    '{}'
  );

  test('multi-breakpoint: all three custom media queries emitted', () => {
    expect(multiResult.css).toContain('@media (min-width: 480px)');
    expect(multiResult.css).toContain('@media (min-width: 768px)');
    expect(multiResult.css).toContain('@media (min-width: 1024px)');
  });

  test('multi-breakpoint: default value outside media queries', () => {
    expect(multiResult.css).toContain('padding: 8');
  });

  test('multi-breakpoint: each breakpoint has its own value', () => {
    expect(multiResult.css).toContain('padding: 12');
    expect(multiResult.css).toContain('padding: 16');
    expect(multiResult.css).toContain('padding: 24');
  });
});

// ---------------------------------------------------------------------------
// compose() — composed variant CSS emission
// ---------------------------------------------------------------------------

describe('compose: composed variant CSS', () => {
  const source = `
    import { animus } from '@animus-ui/core';
    import { compose } from '@animus-ui/system';

    const Root = animus
      .styles({ display: 'flex' })
      .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
      .asElement('div');

    const Child = animus
      .styles({ display: 'block' })
      .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
      .variant({ prop: 'tone', variants: { muted: { opacity: '0.5' } } })
      .asElement('span');

    export const Family = compose({ Root, Child }, { shared: { size: true } });

    export const App = () => (
      <Family.Root size="sm">
        <Family.Child tone="muted" />
      </Family.Root>
    );
  `;

  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'compose-family.tsx', source }]),
      theme,
      variableMap,
      contextualVarsJson,
      config,
      groupRegistry,
      '{}',
      false,
      'animus'
    )
  );
  const css = manifest.css;

  test('both composed rules emitted for shared variant', () => {
    // Rule 1 (inheritance): .Root--size-sm .Child — (0,2,0)
    expect(css).toMatch(/\.animus-Root-\w+--size-sm\s+\.animus-Child-\w+/);
    // Rule 2 (override): .Root .Child.Child--size-sm — (0,3,0)
    expect(css).toMatch(
      /\.animus-Root-\w+\s+\.animus-Child-\w+\.animus-Child-\w+--size-sm/
    );
  });

  test('inheritance rule emitted before override rule', () => {
    const inheritanceMatch = css.match(
      /\.animus-Root-\w+--size-sm\s+\.animus-Child-\w+/
    );
    const overrideMatch = css.match(
      /\.animus-Root-\w+\s+\.animus-Child-\w+\.animus-Child-\w+--size-sm/
    );
    expect(inheritanceMatch).toBeTruthy();
    expect(overrideMatch).toBeTruthy();
    expect(inheritanceMatch!.index!).toBeLessThan(overrideMatch!.index!);
  });

  test('standalone variant CSS still present for components in family', () => {
    // Direct variant rules for Child
    expect(css).toMatch(/\.animus-Child-\w+--size-sm\s*\{/);
    expect(css).toMatch(/\.animus-Child-\w+--size-lg\s*\{/);
  });

  test('non-shared variant has no composed rules', () => {
    // tone is not shared, so no composed rules involving --tone
    expect(css).not.toMatch(/\.animus-Root-\w+.*--tone/);
  });

  test('composed rules only for shared variants on children, not root', () => {
    // Root doesn't get composed rules targeting itself
    expect(css).not.toMatch(
      /\.animus-Root-\w+--size-\w+\s+\.animus-Root-\w+\s*\{/
    );
  });
});

describe('compose: defaultVariant sidecar class', () => {
  const source = `
    import { animus } from '@animus-ui/core';
    import { compose } from '@animus-ui/system';

    const Root = animus
      .styles({ display: 'flex' })
      .variant({ prop: 'density', defaultVariant: 'comfortable', variants: { compact: { p: 4 }, comfortable: { p: 16 } } })
      .asElement('div');

    const Child = animus
      .styles({ display: 'block' })
      .variant({ prop: 'density', defaultVariant: 'comfortable', variants: { compact: { fontSize: 12 }, comfortable: { fontSize: 16 } } })
      .asElement('span');

    export const Family = compose({ Root, Child }, { shared: { density: true } });

    export const App = () => (
      <Family.Root density="compact">
        <Family.Child />
      </Family.Root>
    );
  `;

  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'sidecar-test.tsx', source }]),
      theme,
      variableMap,
      contextualVarsJson,
      config,
      groupRegistry,
      '{}',
      false,
      'animus'
    )
  );
  const css = manifest.css;

  test('sidecar --density-default rule emitted for child with defaultVariant', () => {
    expect(css).toMatch(/\.animus-Child-\w+--density-default\s*\{/);
  });

  test('sidecar only emitted when default option survives reconciliation', () => {
    // Root is only used with density="compact" in JSX, so "comfortable" (the default)
    // is pruned by reconciler. No sidecar emitted for Root — correct behavior.
    // Child's comfortable option survives (compose pre-population keeps all options).
    expect(css).not.toMatch(/\.animus-Root-\w+--density-default\s*\{/);
    expect(css).toMatch(/\.animus-Child-\w+--density-default\s*\{/);
  });

  test('sidecar declarations match default option declarations', () => {
    // The default is "comfortable" which has fontSize: 16 → 1rem
    // Both --density-comfortable and --density-default should have font-size: 1rem
    const comfortableMatch = css.match(
      /\.animus-Child-\w+--density-comfortable\s*\{([^}]+)\}/
    );
    const defaultMatch = css.match(
      /\.animus-Child-\w+--density-default\s*\{([^}]+)\}/
    );
    expect(comfortableMatch).toBeTruthy();
    expect(defaultMatch).toBeTruthy();
    expect(defaultMatch![1].trim()).toBe(comfortableMatch![1].trim());
  });

  test('compose inheritance rule still at (0,3,0) — no doubled child class', () => {
    // Inheritance: .Root.Root--density-compact .Child (NOT .Child.Child)
    expect(css).toMatch(
      /\.animus-Root-\w+--density-compact\s+\.animus-Child-\w+\s*\{/
    );
  });

  test('compose override rule still at (0,3,0)', () => {
    expect(css).toMatch(
      /\.animus-Root-\w+\s+\.animus-Child-\w+\.animus-Child-\w+--density-compact/
    );
  });
});

describe('compose: context flag extraction', () => {
  test('context: true detected, CSS emission unchanged', () => {
    const source = `
      import { animus } from '@animus-ui/core';
      import { compose } from '@animus-ui/system';

      const Root = animus
        .styles({ display: 'flex' })
        .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
        .asElement('div');

      const Child = animus
        .styles({ display: 'block' })
        .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
        .asElement('span');

      export const Family = compose({ Root, Child }, { shared: { size: true }, context: true });

      export const App = () => (
        <Family.Root size="sm">
          <Family.Child />
        </Family.Root>
      );
    `;

    const manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([{ path: 'context-family.tsx', source }]),
        theme,
        variableMap,
        contextualVarsJson,
        config,
        groupRegistry,
        '{}',
        false,
        'animus'
      )
    );

    // CSS still emitted — context doesn't affect CSS generation
    expect(manifest.css).toMatch(
      /\.animus-Root-\w+--size-sm\s+\.animus-Child-\w+/
    );
    expect(manifest.css).toMatch(
      /\.animus-Root-\w+\s+\.animus-Child-\w+\.animus-Child-\w+--size-sm/
    );
    // File flagged for "use client"
    expect(manifest.use_client_files).toContain('context-family.tsx');
  });

  test('"use client" injected for context: true family', () => {
    const source = `import { animus } from '@animus-ui/core';
import { compose } from '@animus-ui/system';

const Root = animus
  .styles({ display: 'flex' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .asElement('div');

const Child = animus
  .styles({ display: 'block' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .asElement('span');

export const Family = compose({ Root, Child }, { shared: { size: true }, context: true });
`;

    const manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([{ path: 'ctx-inject.tsx', source }]),
        theme,
        variableMap,
        contextualVarsJson,
        config,
        groupRegistry,
        '{}',
        false,
        'animus'
      )
    );

    const result = transformFile(
      source,
      'ctx-inject.tsx',
      JSON.stringify(manifest)
    );
    expect(result.code.startsWith("'use client'")).toBe(true);
  });

  test('"use client" preserved when already present', () => {
    const source = `'use client';
import { animus } from '@animus-ui/core';
import { compose } from '@animus-ui/system';

const Root = animus
  .styles({ display: 'flex' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .asElement('div');

const Child = animus
  .styles({ display: 'block' })
  .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
  .asElement('span');

export const Family = compose({ Root, Child }, { shared: { size: true }, context: true });
`;

    const manifest = JSON.parse(
      analyzeProject(
        JSON.stringify([{ path: 'ctx-preserve.tsx', source }]),
        theme,
        variableMap,
        contextualVarsJson,
        config,
        groupRegistry,
        '{}',
        false,
        'animus'
      )
    );

    const result = transformFile(
      source,
      'ctx-preserve.tsx',
      JSON.stringify(manifest)
    );
    // Exactly one directive, no duplicate
    const count = (result.code.match(/use client/g) || []).length;
    expect(count).toBe(1);
    expect(result.code.startsWith("'use client'")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assembleStylesheet: canonical anm- layer names
// ---------------------------------------------------------------------------
describe('assembleStylesheet: anm- layer names', () => {
  const { assembleStylesheet: assemble } = require('../dist/index.mjs');

  test('default produces anm- prefixed layer declaration', () => {
    const css = assemble({});
    expect(css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
  });

  test('custom layers with TW interleaving', () => {
    const css = assemble({
      layers: [
        'base',
        'anm-global',
        'anm-base',
        'anm-variants',
        'anm-compounds',
        'anm-states',
        'anm-system',
        'anm-custom',
        'utilities',
      ],
    });
    expect(css).toContain(
      '@layer base, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, utilities;'
    );
  });

  test('custom layers with bookends', () => {
    const css = assemble({
      layers: [
        'reset',
        'anm-global',
        'anm-base',
        'anm-variants',
        'anm-compounds',
        'anm-states',
        'anm-system',
        'anm-custom',
        'overrides',
      ],
    });
    expect(css).toContain(
      '@layer reset, anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom, overrides;'
    );
  });
});

describe('assembleStylesheet: split mode', () => {
  const { assembleStylesheet: assemble } = require('../dist/index.mjs');

  const opts = {
    variableCss:
      ':root { --color-primary: red; }\n[data-color-mode="dark"] { --color-primary: blue; }',
    globalCss: '@layer anm-global { body { margin: 0; } }',
    componentCss:
      '@layer anm-global, anm-base;\n@layer anm-base { .btn { padding: 8px; } }',
  };

  test('split: true returns object with declaration, variables, body', () => {
    const result = assemble({ ...opts, split: true });
    expect(result).toHaveProperty('declaration');
    expect(result).toHaveProperty('variables');
    expect(result).toHaveProperty('body');
  });

  test('declaration contains @layer statement, not in body', () => {
    const { declaration, body } = assemble({ ...opts, split: true });
    expect(declaration).toContain('@layer anm-global, anm-base');
    expect(body).not.toMatch(/^@layer\s+[\w-]+(\s*,\s*[\w-]+)*\s*;/m);
  });

  test('variables contains :root block, not in body', () => {
    const { variables, body } = assemble({ ...opts, split: true });
    expect(variables).toContain(':root');
    expect(variables).toContain('--color-primary');
    expect(body).not.toContain(':root');
  });

  test('body contains @layer blocks', () => {
    const { body } = assemble({ ...opts, split: true });
    expect(body).toContain('@layer anm-global {');
    expect(body).toContain('@layer anm-base {');
  });

  test('concatenated split equals non-split return', () => {
    const splitResult = assemble({ ...opts, split: true });
    const stringResult = assemble(opts);
    const joined = [
      splitResult.declaration,
      splitResult.variables,
      splitResult.body,
    ]
      .filter(Boolean)
      .join('\n');
    expect(joined).toEqual(stringResult);
  });
});

// ---------------------------------------------------------------------------
// Rust crate: canonical anm- layer names
// ---------------------------------------------------------------------------
describe('Rust crate: anm- layer names', () => {
  const source = readFileSync(join(FIXTURES, 'reconciliation.tsx'), 'utf-8');
  const manifestJson = analyzeProject(
    JSON.stringify([{ path: 'reconciliation.tsx', source }]),
    theme,
    variableMap,
    null,
    config,
    groupRegistry,
    '{}',
    false // dev_mode
  );
  const manifest = JSON.parse(manifestJson);

  test('layer declaration uses anm- names', () => {
    expect(manifest.css).toContain(
      '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;'
    );
  });

  test('base layer block uses anm- name', () => {
    expect(manifest.css).toContain('@layer anm-base {');
  });

  test('variants layer uses anm- name', () => {
    expect(manifest.css).toContain('@layer anm-variants {');
  });

  test('sheets.declaration uses anm- names', () => {
    expect(manifest.sheets.declaration).toContain('anm-base');
    expect(manifest.sheets.declaration).toContain('anm-system');
  });
});

// ---------------------------------------------------------------------------
// compose() replacement — transform emitter replaces compose() with createComposedFamily()
// ---------------------------------------------------------------------------

describe('compose: transform replacement (context: false)', () => {
  const source = `
    import { animus } from '@animus-ui/core';
    import { compose } from '@animus-ui/system';

    const CardRoot = animus
      .styles({ display: 'flex' })
      .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
      .asElement('div');

    const CardBody = animus
      .styles({ p: 16 })
      .asElement('div');

    export const Card = compose({ Root: CardRoot, Body: CardBody }, { shared: { size: true }, name: 'Card' });

    export const App = () => (
      <Card.Root size="sm">
        <Card.Body />
      </Card.Root>
    );
  `;

  const emitterConfig = JSON.stringify({
    runtime_import: '@animus-ui/system/runtime',
    css_module_id: '.animus/styles.css',
  });

  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'card-compose.tsx', source }]),
      theme,
      variableMap,
      contextualVarsJson,
      config,
      groupRegistry,
      '{}',
      false,
      emitterConfig
    )
  );

  test('manifest contains compose replacement descriptor', () => {
    expect(manifest.compose_replacements).toBeDefined();
    expect(manifest.compose_replacements.length).toBe(1);
    expect(manifest.compose_replacements[0].name).toBe('Card');
    expect(manifest.compose_replacements[0].context).toBe(false);
    expect(manifest.compose_replacements[0].shared_keys).toEqual(['size']);
  });

  test('transform replaces compose() with createComposedFamily()', () => {
    const result = transformFile(
      source,
      'card-compose.tsx',
      JSON.stringify(manifest)
    );
    expect(result.hasComponents).toBe(true);
    expect(result.code).toContain('createComposedFamily(');
    expect(result.code).not.toContain('createComposedFamilyWithContext(');
    expect(result.code).toContain(
      "import { createComponent, createComposedFamily } from '@animus-ui/system/runtime'"
    );
  });

  test('compose import from @animus-ui/system is stripped', () => {
    const result = transformFile(
      source,
      'card-compose.tsx',
      JSON.stringify(manifest)
    );
    expect(result.code).not.toMatch(/from ['"]@animus-ui\/system['"]/);
  });

  test('no use client directive for context: false', () => {
    const result = transformFile(
      source,
      'card-compose.tsx',
      JSON.stringify(manifest)
    );
    expect(result.code).not.toContain('use client');
  });
});

describe('composeWithContext: transform replacement', () => {
  const source = `
    import { animus } from '@animus-ui/core';
    import { composeWithContext } from '@animus-ui/system/compose-with-context';

    const DialogRoot = animus
      .styles({ display: 'flex' })
      .variant({ prop: 'size', variants: { sm: { p: 4 }, lg: { p: 16 } } })
      .asElement('div');

    const DialogBody = animus
      .styles({ p: 16 })
      .asElement('div');

    export const Dialog = composeWithContext({ Root: DialogRoot, Body: DialogBody }, { shared: { size: true }, name: 'Dialog' });

    export const App = () => (
      <Dialog.Root size="sm">
        <Dialog.Body />
      </Dialog.Root>
    );
  `;

  const emitterConfig = JSON.stringify({
    runtime_import: '@animus-ui/system/runtime',
    css_module_id: '.animus/styles.css',
  });

  const manifest = JSON.parse(
    analyzeProject(
      JSON.stringify([{ path: 'dialog-compose.tsx', source }]),
      theme,
      variableMap,
      contextualVarsJson,
      config,
      groupRegistry,
      '{}',
      false,
      emitterConfig
    )
  );

  test('manifest marks file for use client', () => {
    expect(manifest.use_client_files).toContain('dialog-compose.tsx');
  });

  test('compose replacement has context: true', () => {
    expect(manifest.compose_replacements[0].context).toBe(true);
  });

  test('transform replaces composeWithContext() with createComposedFamilyWithContext()', () => {
    const result = transformFile(
      source,
      'dialog-compose.tsx',
      JSON.stringify(manifest)
    );
    expect(result.hasComponents).toBe(true);
    expect(result.code).toContain('createComposedFamilyWithContext(');
    expect(result.code).not.toContain('composeWithContext(');
    expect(result.code).toContain(
      "import { createComposedFamilyWithContext } from '@animus-ui/system/compose-with-context'"
    );
  });

  test('original composeWithContext import is stripped', () => {
    const result = transformFile(
      source,
      'dialog-compose.tsx',
      JSON.stringify(manifest)
    );
    // The original `import { composeWithContext }` line should be removed
    expect(result.code).not.toContain('composeWithContext }');
    // But the emitter-injected createComposedFamilyWithContext import should remain
    expect(result.code).toContain('createComposedFamilyWithContext');
  });

  test('transform injects use client directive', () => {
    const result = transformFile(
      source,
      'dialog-compose.tsx',
      JSON.stringify(manifest)
    );
    expect(result.code).toMatch(/^['"]use client['"]/);
  });
});

// ---------------------------------------------------------------------------
// createTransform extraction
// ---------------------------------------------------------------------------

describe('createTransform extraction', () => {
  test('self-contained transform is extracted', () => {
    const source = `
import { createTransform } from '@animus-ui/system';
export const myTransform = createTransform('myTransform', (value) => {
  if (typeof value === 'number') return \`\${value}px\`;
  return String(value);
});
`;
    const manifestJson = analyzeProject(
      JSON.stringify([{ path: 'transforms.ts', source }]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const manifest = JSON.parse(manifestJson);
    // Transforms are consumed internally by Rust (no longer in manifest).
    // Verify that the transform was extracted by checking diagnostics are clean.
    const transformDiag = manifest.diagnostics.find((d: any) =>
      d.component.includes('myTransform')
    );
    expect(transformDiag).toBeUndefined();
  });

  test('transform with external reference fails validation', () => {
    const source = `
import { createTransform } from '@animus-ui/system';
import { helper } from './utils';
export const bad = createTransform('bad', (value) => {
  return helper(value);
});
`;
    const manifestJson = analyzeProject(
      JSON.stringify([{ path: 'bad-transform.ts', source }]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const manifest = JSON.parse(manifestJson);
    // Should have a diagnostic about the external reference (failed validation)
    const diag = manifest.diagnostics.find((d: any) =>
      d.message.includes('helper')
    );
    expect(diag).toBeDefined();
  });

  test('aliased createTransform import is recognized', () => {
    const source = `
import { createTransform as ct } from '@animus-ui/system';
export const aliased = ct('aliased', (v) => String(v));
`;
    const manifestJson = analyzeProject(
      JSON.stringify([{ path: 'aliased.ts', source }]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const manifest = JSON.parse(manifestJson);
    // Transforms are consumed internally — verify no diagnostics for valid transform
    const aliasDiag = manifest.diagnostics.find((d: any) =>
      d.component.includes('aliased')
    );
    expect(aliasDiag).toBeUndefined();
  });

  test('non-string first argument emits diagnostic', () => {
    const source = `
import { createTransform } from '@animus-ui/system';
const name = 'dynamic';
export const bad = createTransform(name, (v) => v);
`;
    const manifestJson = analyzeProject(
      JSON.stringify([{ path: 'dynamic-name.ts', source }]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const manifest = JSON.parse(manifestJson);
    const diag = manifest.diagnostics.find((d: any) =>
      d.message.includes('static string name')
    );
    expect(diag).toBeDefined();
  });

  test('well-known globals allowed in callback', () => {
    const source = `
import { createTransform } from '@animus-ui/system';
export const mathTransform = createTransform('mathTransform', (v) => {
  const n = parseFloat(String(v));
  if (isNaN(n)) return String(v);
  return Math.round(n * 100) / 100;
});
`;
    const manifestJson = analyzeProject(
      JSON.stringify([{ path: 'math.ts', source }]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const manifest = JSON.parse(manifestJson);
    // Transforms are consumed internally — verify no diagnostics for valid transform
    const mathDiag = manifest.diagnostics.find((d: any) =>
      d.component.includes('mathTransform')
    );
    expect(mathDiag).toBeUndefined();
  });
});

// ─── Global style block resolution ─────────────────────────────────
// Validates that analyzeProject resolves global style blocks through
// the Rust theme_resolver (prop shorthand, scale lookup, token aliases,
// transform placeholders) and emits them into @layer anm-global.

describe('global style resolution', () => {
  test('prop shorthand resolved in global styles', () => {
    const globalBlocks = JSON.stringify({
      reset: {
        '*, *::before, *::after': {
          boxSizing: 'border-box',
        },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.sheets.global).toContain('@layer anm-global');
    expect(manifest.sheets.global).toContain('box-sizing: border-box');
  });

  test('scale lookup resolved in global styles', () => {
    const globalBlocks = JSON.stringify({
      base: {
        body: {
          p: 4,
        },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.sheets.global).toContain('@layer anm-global');
    // p: 4 → scale lookup for spacing.4 → resolved value
    expect(manifest.sheets.global).toContain('padding:');
  });

  test('token alias resolved in global styles', () => {
    const globalBlocks = JSON.stringify({
      base: {
        body: {
          color: '{colors.text}',
        },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.sheets.global).toContain('@layer anm-global');
    // Token alias should resolve to var(--...) or literal value
    expect(manifest.sheets.global).toContain('color:');
    expect(manifest.sheets.global).not.toContain('{colors.text}');
  });

  test('transform placeholder emitted in global styles', () => {
    const globalBlocks = JSON.stringify({
      base: {
        body: {
          w: 0.5,
        },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.sheets.global).toContain('@layer anm-global');
    // w: 0.5 with size transform → evaluator not available for built-in
    // transforms (defined in system package, not in analyzed files), so
    // raw value "0.5" passes through. applyUnitFallback handles units in plugin.
    expect(manifest.sheets.global).toContain('0.5');
  });

  test('@keyframes resolved in global styles', () => {
    const globalBlocks = JSON.stringify({
      animations: {
        '@keyframes fadeIn': {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.sheets.global).toContain('@layer anm-global');
    expect(manifest.sheets.global).toContain('@keyframes fadeIn');
    expect(manifest.sheets.global).toContain('0%');
    expect(manifest.sheets.global).toContain('100%');
    expect(manifest.sheets.global).toContain('opacity:');
  });

  test('global CSS excluded from concatenated css (flows through sheets.global)', () => {
    const globalBlocks = JSON.stringify({
      reset: {
        body: { margin: 0 },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    // Global CSS content should NOT be in the concatenated css field — it flows
    // through sheets.global and is assembled by the plugin to avoid double-emission.
    expect(manifest.css).not.toContain('margin: 0');
    // But it should be in sheets.global
    expect(manifest.sheets.global).toContain('margin: 0');
  });

  test('no global blocks produces empty global sheet', () => {
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}'
    );
    const manifest = JSON.parse(manifestJson);
    expect(manifest.sheets.global).toBe('');
  });

  test('global_css field contains raw CSS without layer wrapper', () => {
    const globalBlocks = JSON.stringify({
      reset: {
        body: { margin: 0 },
      },
    });
    const manifestJson = analyzeProject(
      JSON.stringify([]),
      theme,
      variableMap,
      null,
      config,
      groupRegistry,
      '{}',
      null,
      null,
      null,
      null,
      globalBlocks
    );
    const manifest = JSON.parse(manifestJson);
    // global_css is raw, without @layer wrapper
    expect(manifest.global_css).toContain('margin: 0');
    expect(manifest.global_css).not.toContain('@layer');
  });
});
