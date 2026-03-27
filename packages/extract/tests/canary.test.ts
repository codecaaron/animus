import { beforeEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join, relative } from 'path';

const { extract, analyzeProject, transformFile, clearAnalysisCache } =
  require('../index.js');

const FIXTURES = join(__dirname, 'fixtures');

/**
 * Flattened theme — mirrors the doc site theme evaluated at build time.
 * In production, the Vite plugin evaluates theme.ts and flattens all scales.
 */
const theme = JSON.stringify({
  'space.0': '0',
  'space.2': '0.125rem',
  'space.4': '0.25rem',
  'space.8': '0.5rem',
  'space.12': '0.75rem',
  'space.16': '1rem',
  'space.24': '1.5rem',
  'space.32': '2rem',
  'space.40': '2.5rem',
  'space.48': '3rem',
  'space.64': '4rem',
  'space.96': '6rem',
  'space.120': '7.5rem',
  'space.256': '16rem',
  'colors.background': 'var(--colors-background)',
  'colors.background-current': 'var(--colors-background-current)',
  'colors.background-muted': 'var(--colors-background-muted)',
  'colors.text': 'var(--colors-text)',
  'colors.primary': 'var(--colors-primary)',
  'colors.primary-hover': 'var(--colors-primary-hover)',
  'colors.secondary': 'var(--colors-secondary)',
  'colors.secondary-hover': 'var(--colors-secondary-hover)',
  'colors.transparent': 'transparent',
  'colors.syntax-background': 'var(--colors-syntax-background)',
  'gradients.flowX': 'var(--gradients-flowX)',
  'gradients.flowY': 'var(--gradients-flowY)',
  'shadows.none': 'none',
  'shadows.flush': 'var(--shadows-flush)',
  'shadows.link-raised': 'var(--shadows-link-raised)',
  'shadows.link-hover': 'var(--shadows-link-hover)',
  'shadows.link-pressed': 'var(--shadows-link-pressed)',
  'shadows.link-hover-raised': 'var(--shadows-link-hover-raised)',
  'fontWeights.400': '400',
  'fontWeights.500': '500',
  'fontWeights.600': '600',
  'fontWeights.700': '700',
  'lineHeights.base': 'calc(2px + 2.8ex + 2px)',
  'lineHeights.title': 'calc(2px + 2.8ex + 2px)',
  'fonts.base': 'var(--fonts-base)',
  'fonts.heading': 'var(--fonts-heading)',
  'fonts.mono': 'var(--fonts-mono)',
  'fontSizes.14': '0.875rem',
  'fontSizes.16': '1rem',
  'fontSizes.18': '1.125rem',
  'fontSizes.20': '1.25rem',
  'fontSizes.22': '1.375rem',
  'fontSizes.26': '1.625rem',
  'fontSizes.30': '1.875rem',
  'fontSizes.34': '2.125rem',
  'fontSizes.44': '2.75rem',
  'fontSizes.64': '4rem',
  'transitions.text': '100ms linear text-shadow',
  'transitions.bg': '500ms ease background-position',
  'radii.2': '2px',
  'radii.4': '4px',
  'breakpoints.xs': '480',
  'breakpoints.sm': '768',
  'breakpoints.md': '1024',
  'breakpoints.lg': '1200',
  'breakpoints.xl': '1440',
});

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

/**
 * Variable-name map — maps token paths to CSS variable names.
 * Built from theme entries whose values are var() references.
 * Enables {scale.path} token alias resolution in the Rust pipeline.
 */
const variableMap = JSON.stringify(
  Object.fromEntries(
    Object.entries(JSON.parse(theme))
      .filter(
        ([, v]) =>
          typeof v === 'string' && v.startsWith('var(') && v.endsWith(')')
      )
      .map(([k, v]) => [k, (v as string).slice(4, -1)])
  )
);

describe('Canary: Button extraction', () => {
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
      '@layer global, base, variants, compounds, states, system, custom;'
    );
  });

  test('CSS contains base layer with ButtonContainer styles', () => {
    expect(result.css).toContain('@layer base {');
    expect(result.css).toContain('animus-ButtonContainer-');
    expect(result.css).toContain('display: inline-flex;');
    expect(result.css).toContain('cursor: pointer;');
    expect(result.css).toContain('padding: 0;');
  });

  test('CSS contains variant layer with fill and stroke options', () => {
    expect(result.css).toContain('@layer variants {');
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

describe('Canary: Layout extraction (responsive + states)', () => {
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
    expect(result.css).toContain('@layer states {');
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

describe('Canary: asComponent on primary chain', () => {
  const source = readFileSync(join(FIXTURES, 'bail.tsx'), 'utf-8');
  const result = extract(source, 'bail.tsx', theme, variableMap, config, '{}');

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
  });

  test('generates CSS', () => {
    expect(result.css).toContain('FlowLink');
  });
});

describe('Canary: System prop extraction', () => {
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
    expect(result.css).toContain('@layer system {');
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
    expect(result.css).toContain('@layer base {');
    expect(result.css).toContain('display: flex');
  });

  test('state styles still in @layer states', () => {
    expect(result.css).toContain('@layer states {');
  });

  test('system layer comes after states in output', () => {
    const statesPos = result.css.indexOf('@layer states {');
    const systemPos = result.css.indexOf('@layer system {');
    expect(systemPos).toBeGreaterThan(statesPos);
  });
});

describe('Canary: Groups chain extracts (Arc 2)', () => {
  // Inline source — component with groups but NO JSX usage in same file
  const source = `
    import { animus } from '@animus-ui/core';
    export const Box = animus
      .styles({ display: 'flex' })
      .groups({ space: true, layout: true })
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
    expect(result.css).toContain('@layer base {');
    expect(result.css).toContain('display: flex');
  });

  test('no utility CSS when no JSX usage in file', () => {
    // No JSX elements using Box in this file → no @layer system block
    expect(result.code).toContain("createComponent('div'");
    expect(result.css).not.toContain('@layer system {');
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
describe('Snapshot Layer 1: Styles + Variants', () => {
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
    expect(result.css).toMatchSnapshot();
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
describe('Snapshot Layer 2: System Props', () => {
  const source = readFileSync(join(FIXTURES, 'system-props.tsx'), 'utf-8');
  const result = extract(
    source,
    'system-props.tsx',
    theme,
    variableMap,
    config,
    groupRegistry
  );

  const EXPECTED_CSS = `@layer global, base, variants, compounds, states, system, custom;

@layer base {
  .animus-Box-46626db7 {
    display: flex;
    position: relative;
  }
  .animus-Text-597c55c1 {
    margin: 0;
  }
}

@layer states {
  .animus-Box-46626db7--hidden {
    opacity: 0;
    visibility: hidden;
  }
}

@layer system {
  .animus-u-50e5d508 {
    padding: 0.5rem;
  }
  .animus-u-c332c59e {
    padding: 1rem;
  }
  .animus-u-5061bfc4 {
    color: var(--colors-primary);
  }
  .animus-u-af4971f1 {
    color: var(--colors-text);
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
describe('Snapshot Layer 3: Extension Chain', () => {
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
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('CSS matches snapshot', () => {
    expect(manifest.css).toMatchSnapshot();
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

describe('Canary: manifest.sheets structured output', () => {
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
      '@layer global, base, variants, compounds, states, system, custom;'
    );
    // No rule blocks in the declaration
    expect(manifest.sheets.declaration).not.toContain('{');
  });

  test('base sheet contains @layer base block', () => {
    expect(manifest.sheets.base).toContain('@layer base {');
    expect(manifest.sheets.base).toContain('animus-');
  });

  test('sheets concatenation matches css field', () => {
    // The css field and concatenated sheets should contain the same rules
    expect(manifest.css).toContain(
      '@layer global, base, variants, compounds, states, system, custom;'
    );
    expect(manifest.css).toContain('@layer base {');
    if (manifest.sheets.variants) {
      expect(manifest.css).toContain('@layer variants {');
    }
    if (manifest.sheets.states) {
      expect(manifest.css).toContain('@layer states {');
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
    config,
    groupRegistry,
    '{}'
  );
  return JSON.parse(manifestJson);
}

describe('Canary: Extension chain extraction', () => {
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
    expect(manifest.css).toContain('@layer system');
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

describe('Canary: transform_file from manifest', () => {
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

describe('Canary: Backward compatibility with extract()', () => {
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
    expect(result.css).toContain('@layer base');
    expect(result.code).toContain("createComponent('button'");
  });
});

describe('Canary: Usage reconciliation', () => {
  const source = readFileSync(join(FIXTURES, 'reconciliation.tsx'), 'utf-8');
  const manifestJson = analyzeProject(
    JSON.stringify([{ path: 'reconciliation.tsx', source }]),
    theme,
    variableMap,
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
describe('Snapshot Layer 4: Usage Reconciliation', () => {
  const source = readFileSync(join(FIXTURES, 'reconciliation.tsx'), 'utf-8');
  const manifestJson = analyzeProject(
    JSON.stringify([{ path: 'reconciliation.tsx', source }]),
    theme,
    variableMap,
    config,
    groupRegistry,
    '{}'
  );
  const manifest = JSON.parse(manifestJson);

  test('CSS matches snapshot', () => {
    expect(manifest.css).toMatchSnapshot();
  });

  test('deterministic', () => {
    const m2 = JSON.parse(
      analyzeProject(
        JSON.stringify([{ path: 'reconciliation.tsx', source }]),
        theme,
        variableMap,
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

describe('Snapshot Layer 5: Real Doc Site', () => {
  const ROOT = join(__dirname, '../../..');
  const dirs = [
    join(ROOT, 'packages/ui/src'), // full UI package source (barrel + elements)
    join(ROOT, 'packages/_docs/elements'),
    join(ROOT, 'packages/_docs/components'),
    join(ROOT, 'packages/_docs/pages'),
  ];
  const exts = new Set(['.tsx', '.ts']);
  const allFiles: string[] = [];
  for (const d of dirs) allFiles.push(...discoverFiles(d, exts));
  allFiles.sort(); // deterministic order

  const fileEntries = allFiles.map((f) => ({
    path: relative(ROOT, f),
    source: readFileSync(f, 'utf-8'),
  }));

  // Package resolution: map @animus-ui/components to the UI package barrel
  const layer5PackageMap = JSON.stringify({
    '@animus-ui/components': 'packages/ui/src/index.ts',
  });

  const manifestJson = analyzeProject(
    JSON.stringify(fileEntries),
    theme,
    variableMap,
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
    expect(manifest.css).toMatchSnapshot();
  });

  test('deterministic', () => {
    const m2 = JSON.parse(
      analyzeProject(
        JSON.stringify(fileEntries),
        theme,
        variableMap,
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

describe('Canary: Package resolution', () => {
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
    expect(manifest.css).toContain('@layer system');
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

describe('Canary: Bails on unknown chain method', () => {
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

describe('Canary: Strips dead @animus-ui/core import from transformed output', () => {
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

describe('Canary: Per-property bail (mixed static + non-static)', () => {
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
    expect(result.css).toContain('color: var(--colors-primary)');
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

describe('Canary: Token alias syntax', () => {
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
    expect(result.css).toContain('border: 1px solid var(--colors-primary)');
  });

  test('Overlay: resolves {colors.primary/50} to color-mix', () => {
    expect(result.css).toContain(
      'background: color-mix(in srgb, var(--colors-primary) 50%, transparent)'
    );
  });

  test('Shadow: resolves alpha alias in box-shadow compound', () => {
    expect(result.css).toContain(
      'box-shadow: 0 4px 12px color-mix(in srgb, var(--colors-primary) 20%, transparent)'
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

describe('analyzeProject with JSX consumer file', () => {
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

describe('variant tracking inside .map() callbacks', () => {
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

describe('Canary: Incremental analysis cache', () => {
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
    expect(after.css).toContain('var(--colors-secondary)');

    // Child should still exist and have merged CSS from updated parent
    const childId = Object.keys(after.components).find((id) =>
      id.includes('NavLink')
    );
    expect(childId).toBeDefined();

    // Same number of components
    expect(Object.keys(after.components).length).toEqual(beforeCount);
  });

  test('7.3: dev_mode skips reconciliation', () => {
    // Use reconciliation fixture which has unused variants
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

    // Prod mode: reconciliation prunes unused variants
    const prodResult = analyzeWithCache(files, false);

    clearAnalysisCache();

    // Dev mode: reconciliation skipped, all variants retained
    const devResult = analyzeWithCache(files, true);

    // Dev mode CSS should be >= prod CSS (never smaller, may have more)
    expect(devResult.css.length).toBeGreaterThanOrEqual(prodResult.css.length);

    // Dev mode report should be empty (reconciliation skipped)
    expect(devResult.report?.eliminated_details?.length ?? 0).toBe(0);
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
    expect(after.css).toContain('font-family: var(--fonts-base)');

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

describe('Canary: Custom prop extraction', () => {
  const manifest = analyzeFixtures([
    { name: 'custom-props.tsx', fixture: 'custom-props.tsx' },
  ]);

  test('CSS contains @layer custom with utility classes', () => {
    expect(manifest.css).toContain('@layer custom {');
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

  test('transformed JS contains customDynamicConfig with transform reference', () => {
    const cardId = Object.keys(manifest.components).find((id) =>
      id.includes('Card')
    );
    expect(cardId).toBeDefined();
    const card = manifest.components[cardId!];
    // sizing has transform: 'size' → customDynamicConfig should reference transforms.size
    expect(card.replacement).toContain('customDynamicConfig');
    expect(card.replacement).toContain('transforms.size');
  });
});

// ─── Compound variants ──────────────────────────────────────────────────────

describe('Canary: Compound variant extraction', () => {
  const manifest = analyzeFixtures([
    { name: 'compound-variants.tsx', fixture: 'compound-variants.tsx' },
  ]);

  test('compound CSS emitted in @layer compounds', () => {
    expect(manifest.css).toContain('@layer compounds {');
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
    const variantsPos = manifest.css.indexOf('@layer variants {');
    const compoundsPos = manifest.css.indexOf('@layer compounds {');
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

describe('Canary: Negative scale value extraction', () => {
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
