/**
 * Programmatic theme fixture for canary tests.
 *
 * Structurally modeled on the showcase theme (packages/showcase/src/ds.ts).
 * Uses createTheme() and exports the serialized output, replacing
 * the hand-maintained JSON blobs in canary.test.ts.
 *
 * Some scales referenced by prop configs (gradients, letterSpacings, etc.)
 * are intentionally absent — the extraction pipeline handles missing scales
 * gracefully. What matters is the structural pattern matches production.
 */
import { createTheme } from '@animus-ui/system';

export const tokens = createTheme()
  .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
  .addColors({
    gray: {
      50: '#fafafa',
      100: '#f0f0f0',
      200: '#e0e0e0',
      600: '#2a2a2a',
      700: '#1a1a1a',
      800: '#111111',
      900: '#080808',
      950: '#000000',
    },
    fire: {
      400: '#FF6B35',
      500: '#FF2800',
      600: '#E63946',
      700: '#C1121F',
    },
    warm: {
      100: '#F2EBE0',
      200: '#E8E0D0',
      400: '#A39888',
    },
    gold: {
      300: '#FFB627',
    },
  })
  .addColorModes('dark', {
    dark: {
      background: { _: 'gray.950', current: 'gray.950', muted: 'gray.900' },
      text: 'warm.200',
      primary: { _: 'fire.500', hover: 'fire.600' },
      secondary: { _: 'fire.400', hover: 'gold.300' },
      accent: 'gold.300',
      border: { _: 'gray.600' },
      'syntax-background': 'gray.900',
    },
    light: {
      background: { _: 'warm.100', current: 'warm.100', muted: 'warm.200' },
      text: 'gray.800',
      primary: { _: 'fire.700', hover: 'fire.500' },
      secondary: { _: 'fire.600', hover: 'gold.300' },
      accent: 'gold.300',
      border: { _: 'warm.200' },
      'syntax-background': 'warm.200',
    },
  })
  .addScale({
    name: 'space',
    values: {
      0: '0',
      2: '0.125rem',
      4: '0.25rem',
      8: '0.5rem',
      12: '0.75rem',
      16: '1rem',
      24: '1.5rem',
      32: '2rem',
      40: '2.5rem',
      48: '3rem',
      64: '4rem',
      96: '6rem',
      120: '7.5rem',
      256: '16rem',
    },
  })
  .addScale({
    name: 'fontSizes',
    values: {
      14: '0.875rem',
      16: '1rem',
      18: '1.125rem',
      20: '1.25rem',
      22: '1.375rem',
      26: '1.625rem',
      30: '1.875rem',
      34: '2.125rem',
      44: '2.75rem',
      64: '4rem',
    },
  })
  .addScale({
    name: 'fontWeights',
    values: { 400: '400', 500: '500', 600: '600', 700: '700' },
  })
  .addScale({
    name: 'lineHeights',
    values: {
      none: '1',
      tight: '1.1',
      base: 'calc(2px + 2.8ex + 2px)',
      title: 'calc(2px + 2.8ex + 2px)',
      relaxed: '1.7',
    },
  })
  .addScale({
    name: 'fonts',
    values: {
      base: "'Geist', sans-serif",
      heading: "'IBM Plex Mono', monospace",
      mono: "'IBM Plex Mono', monospace",
    },
  })
  .addScale({
    name: 'radii',
    values: { 0: '0', 2: '2px', 4: '4px' },
  })
  .addScale({
    name: 'transitions',
    values: {
      text: '100ms linear text-shadow',
      bg: '500ms ease background-position',
    },
  })
  .addScale({
    name: 'shadows',
    values: {
      none: 'none',
      glow: '0 0 8px {colors.fire.500/40}',
    },
  })
  .declareContextualVars({
    colors: ['current-bg'],
  })
  .build();

// ─── Serialized Output ─────────────────────────────────────

const serialized = tokens.serialize();

export const themeJson = serialized.scalesJson;
export const variableMapJson = serialized.variableMapJson;
const variableCss = serialized.variableCss;
export const contextualVarsJson = serialized.contextualVarsJson;
