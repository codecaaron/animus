import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const { extract } = require('../index.js');

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
import { serializedConfig } from './fixtures/serialize-config';
const config = serializedConfig;

describe('Canary: Button extraction', () => {
  const source = readFileSync(join(FIXTURES, 'button.tsx'), 'utf-8');
  const result = extract(source, 'button.tsx', theme, config);

  test('extracts successfully', () => {
    expect(result.extractable).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('CSS contains @layer declaration', () => {
    expect(result.css).toContain(
      '@layer base, variants, states, system, custom;'
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
    // borderRadius: 4 → scale lookup → "4px", then size transform
    expect(result.css).toContain('border-radius: 4px;');
  });

  test('transformed JS contains createComponent calls', () => {
    expect(result.code).toContain("createComponent('button'");
    expect(result.code).toContain("createComponent('span'");
    expect(result.code).toContain(
      "import { createComponent } from '@animus-ui/runtime'"
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
  const result = extract(source, 'layout.tsx', theme, config);

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

describe('Canary: Bail on groups', () => {
  const source = readFileSync(join(FIXTURES, 'bail.tsx'), 'utf-8');
  const result = extract(source, 'bail.tsx', theme, config);

  test('does not extract', () => {
    expect(result.extractable).toBe(false);
  });

  test('source code unchanged', () => {
    expect(result.code).toBe(source);
  });

  test('no CSS generated', () => {
    expect(result.css).toBe('');
  });

  test('error reports bail reason', () => {
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('groups');
  });
});
