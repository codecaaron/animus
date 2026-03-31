/**
 * ANIMUS — Declaration
 *
 * Void and vermilion. Serif fury. Zero compromise.
 * The builder chain IS the cascade. The config IS the language.
 *
 * createSystem() → one file, one instance, one truth.
 */
import { createSystem, createTheme, createTransform } from '@animus-ui/system';
import {
  background,
  border,
  color,
  flex,
  grid,
  layout,
  positioning,
  shadows,
  space,
  transitions,
  typography,
} from '@animus-ui/system/groups';
import { ds as testDs } from '@animus-ui/test-ds';

// ─── Custom Transforms ──────────────────────────────────────

const fluid = createTransform('fluid', (value) => {
  const [min, max] = String(value).split('-').map(Number);
  if (!min || !max) return String(value);
  const minRem = min / 16;
  const maxRem = max / 16;
  const slope = ((max - min) / 880) * 100;
  const intercept = minRem - (slope / 100) * (480 / 16);
  return `clamp(${minRem.toFixed(3)}rem, ${intercept.toFixed(3)}rem + ${slope.toFixed(2)}vw, ${maxRem.toFixed(3)}rem)`;
});

const ratio = createTransform('ratio', (value) => {
  const str = String(value);
  if (str.includes(':')) {
    return str.replace(':', ' / ');
  }
  return str;
});

// ─── Tokens ─────────────────────────────────────────────────

export const tokens = createTheme()
  .addBreakpoints({
    '2xs': 400,
    xs: 480,
    sm: 768,
    md: 1024,
    lg: 1200,
    xl: 1440,
  })
  .addColors({
    // ─── Gray (pure achromatic) ──────────────────────────
    gray: {
      50: '#fafafa',
      100: '#f0f0f0',
      200: '#e0e0e0',
      300: '#c0c0c0',
      400: '#888888',
      500: '#555555',
      600: '#2a2a2a',
      700: '#1a1a1a',
      800: '#111111',
      900: '#080808',
      950: '#000000',
    },
    // ─── Fire (ember → spark spectrum) ───────────────────
    fire: {
      50: '#fff5f0',
      100: '#ffe0d4',
      200: '#ffc2a8',
      300: '#ff9b6e',
      400: '#FF6B35',
      500: '#FF2800',
      600: '#E63946',
      700: '#C1121F',
      800: '#8c0f18',
      900: '#5c0a10',
      950: '#2e0508',
    },
    // ─── Warm (parchment / sand) ─────────────────────────
    warm: {
      50: '#faf8f5',
      100: '#F2EBE0',
      200: '#E8E0D0',
      300: '#D4C9B8',
      400: '#A39888',
      500: '#8a7f70',
      600: '#6b6255',
      700: '#4d473e',
      800: '#302c27',
      900: '#1a1815',
      950: '#0d0c0a',
    },
    // ─── Gold (accent / spark spectrum) ──────────────────
    gold: {
      50: '#fffbf0',
      100: '#fff3d4',
      200: '#ffe6a8',
      300: '#FFB627',
      400: '#e6a020',
      500: '#cc8c1a',
      600: '#996914',
      700: '#66460d',
      800: '#4d3509',
      900: '#332306',
      950: '#1a1203',
    },
    // ─── Ocean (cool blue) ──────────────────────────────
    ocean: {
      50: '#f0f7ff',
      100: '#d6e8ff',
      200: '#a8d1ff',
      300: '#6bb3ff',
      400: '#3d94ff',
      500: '#1a75ff',
      600: '#0055cc',
      700: '#003d99',
      800: '#002966',
      900: '#001a40',
      950: '#000d1a',
    },
    // ─── Forest (green / growth) ────────────────────────
    forest: {
      50: '#f0faf4',
      100: '#d4f0df',
      200: '#a8e0bf',
      300: '#6bc99a',
      400: '#3db577',
      500: '#22a05e',
      600: '#1a7a48',
      700: '#145c36',
      800: '#0d3d24',
      900: '#072614',
      950: '#03130a',
    },
    // ─── Violet (purple / creative) ─────────────────────
    violet: {
      50: '#f8f0ff',
      100: '#ead4ff',
      200: '#d6a8ff',
      300: '#b76bff',
      400: '#9d3dff',
      500: '#8b1aff',
      600: '#6b00cc',
      700: '#4f0099',
      800: '#350066',
      900: '#200040',
      950: '#10001a',
    },
    // ─── Cyan (ocean complement / teal) ─────────────────
    cyan: {
      50: '#f0fdff',
      100: '#ccf7fe',
      200: '#99effd',
      300: '#5ce1f8',
      400: '#22d3ee',
      500: '#06b6d4',
      600: '#0891b2',
      700: '#0e7490',
      800: '#155e75',
      900: '#164e63',
      950: '#083344',
    },
    // ─── Lime (forest complement / bright green) ────────
    lime: {
      50: '#f7fee7',
      100: '#ecfccb',
      200: '#d9f99d',
      300: '#bef264',
      400: '#a3e635',
      500: '#84cc16',
      600: '#65a30d',
      700: '#4d7c0f',
      800: '#3f6212',
      900: '#365314',
      950: '#1a2e05',
    },
    // ─── Rose (violet complement / warm pink) ───────────
    rose: {
      50: '#fff1f2',
      100: '#ffe4e6',
      200: '#fecdd3',
      300: '#fda4af',
      400: '#fb7185',
      500: '#f43f5e',
      600: '#e11d48',
      700: '#be123c',
      800: '#9f1239',
      900: '#881337',
      950: '#4c0519',
    },
    // ─── Copper (terracotta / adobe / earth) ───────────
    copper: {
      50: '#fdf6f0',
      100: '#f8e8d8',
      200: '#f0d0b0',
      300: '#d4a574',
      400: '#b8834a',
      500: '#9a6830',
      600: '#7a5028',
      700: '#5c3a1e',
      800: '#3d2614',
      900: '#24160c',
      950: '#140c06',
    },
  })
  .addColorModes('dark', {
    dark: {
      primary: { _: 'fire.500', hover: 'fire.600' },
      secondary: 'fire.400',
      accent: 'gold.300',
      bg: { _: 'gray.950', muted: 'gray.900', inverse: 'warm.100' },
      surface: { _: 'gray.800', hover: 'gray.700' },
      text: { _: 'warm.200', muted: 'warm.400', dim: 'warm.600' },
      border: { _: 'gray.600', strong: 'gray.500' },
      code: { _: 'gray.800', text: 'gold.300', border: 'gray.600' },
      scrollbar: { _: 'fire.500', track: 'gray.950', muted: 'fire.800' },
      selection: { _: 'fire.500', text: 'gray.950' },
      glow: { _: 'fire.500', subtle: 'fire.800', strong: 'fire.400' },
      status: { success: 'gold.300', warning: 'fire.400', error: 'fire.600' },
      scheme: {
        50: 'fire.50',
        100: 'fire.100',
        200: 'fire.200',
        300: 'fire.300',
        400: 'fire.400',
        500: 'fire.500',
        600: 'fire.600',
        700: 'fire.700',
        800: 'fire.800',
        900: 'fire.900',
        950: 'fire.950',
      },
    },
    light: {
      primary: { _: 'fire.700', hover: 'fire.500' },
      secondary: 'fire.600',
      accent: 'gold.700',
      bg: { _: 'warm.100', muted: 'warm.200', inverse: 'gray.900' },
      surface: { _: 'warm.300', hover: 'warm.400' },
      text: { _: 'gray.800', muted: 'gray.500', dim: 'warm.500' },
      border: { _: 'warm.300', strong: 'warm.400' },
      code: { _: 'warm.200', text: 'fire.700', border: 'warm.300' },
      scrollbar: { _: 'fire.700', track: 'warm.100', muted: 'fire.300' },
      selection: { _: 'fire.700', text: 'warm.50' },
      glow: { _: 'fire.700', subtle: 'fire.200', strong: 'fire.500' },
      status: { success: 'fire.700', warning: 'fire.400', error: 'fire.600' },
      scheme: {
        50: 'warm.50',
        100: 'fire.100',
        200: 'fire.300',
        300: 'fire.400',
        400: 'fire.600',
        500: 'fire.700',
        600: 'fire.800',
        700: 'fire.900',
        800: 'fire.100',
        900: 'fire.50',
        950: 'fire.950',
      },
    },
    midnight: {
      primary: { _: 'fire.500', hover: 'fire.400' },
      secondary: 'gold.300',
      accent: 'gold.200',
      bg: { _: 'gray.950', muted: 'gray.900', inverse: 'gray.100' },
      surface: { _: 'gray.900', hover: 'gray.800' },
      text: { _: 'gray.200', muted: 'gray.400', dim: 'warm.600' },
      border: { _: 'gray.700', strong: 'gray.600' },
      code: { _: 'gray.900', text: 'gold.200', border: 'gray.700' },
      scrollbar: { _: 'gold.300', track: 'gray.950', muted: 'gold.700' },
      selection: { _: 'gold.300', text: 'gray.950' },
      glow: { _: 'gold.300', subtle: 'gold.800', strong: 'gold.200' },
      status: { success: 'gold.300', warning: 'fire.400', error: 'fire.600' },
      scheme: {
        50: 'fire.50',
        100: 'fire.100',
        200: 'fire.200',
        300: 'fire.300',
        400: 'fire.400',
        500: 'fire.500',
        600: 'fire.600',
        700: 'fire.700',
        800: 'fire.800',
        900: 'fire.900',
        950: 'fire.950',
      },
    },
    ember: {
      primary: { _: 'fire.400', hover: 'fire.300' },
      secondary: 'gold.300',
      accent: 'fire.200',
      bg: { _: 'fire.950', muted: 'fire.900', inverse: 'warm.50' },
      surface: { _: 'fire.900', hover: 'fire.800' },
      text: { _: 'warm.100', muted: 'warm.400', dim: 'warm.500' },
      border: { _: 'fire.800', strong: 'fire.700' },
      code: { _: 'fire.900', text: 'gold.200', border: 'fire.800' },
      scrollbar: { _: 'fire.400', track: 'fire.950', muted: 'fire.700' },
      selection: { _: 'fire.400', text: 'fire.950' },
      glow: { _: 'fire.400', subtle: 'fire.800', strong: 'fire.300' },
      status: { success: 'gold.300', warning: 'fire.300', error: 'fire.500' },
      scheme: {
        50: 'fire.50',
        100: 'fire.100',
        200: 'fire.200',
        300: 'fire.300',
        400: 'fire.400',
        500: 'fire.500',
        600: 'fire.600',
        700: 'fire.700',
        800: 'fire.800',
        900: 'fire.900',
        950: 'fire.950',
      },
    },
    ocean: {
      primary: { _: 'ocean.700', hover: 'ocean.500' },
      secondary: 'ocean.600',
      accent: 'cyan.700',
      bg: { _: 'ocean.50', muted: 'ocean.100', inverse: 'ocean.900' },
      surface: { _: 'ocean.200', hover: 'ocean.300' },
      text: { _: 'gray.800', muted: 'ocean.700', dim: 'ocean.600' },
      border: { _: 'ocean.200', strong: 'ocean.300' },
      code: { _: 'ocean.100', text: 'ocean.700', border: 'ocean.200' },
      scrollbar: { _: 'ocean.700', track: 'ocean.50', muted: 'ocean.300' },
      selection: { _: 'ocean.700', text: 'ocean.50' },
      glow: { _: 'ocean.700', subtle: 'ocean.200', strong: 'ocean.500' },
      status: { success: 'cyan.700', warning: 'gold.600', error: 'fire.700' },
      scheme: {
        50: 'ocean.50',
        100: 'ocean.100',
        200: 'ocean.200',
        300: 'ocean.300',
        400: 'ocean.400',
        500: 'ocean.500',
        600: 'ocean.600',
        700: 'ocean.700',
        800: 'ocean.800',
        900: 'ocean.900',
        950: 'ocean.950',
      },
    },
    forest: {
      primary: { _: 'forest.700', hover: 'forest.500' },
      secondary: 'forest.600',
      accent: 'lime.700',
      bg: { _: 'forest.50', muted: 'forest.100', inverse: 'forest.900' },
      surface: { _: 'forest.200', hover: 'forest.300' },
      text: { _: 'gray.800', muted: 'forest.700', dim: 'forest.600' },
      border: { _: 'forest.200', strong: 'forest.300' },
      code: { _: 'forest.100', text: 'forest.700', border: 'forest.200' },
      scrollbar: { _: 'forest.700', track: 'forest.50', muted: 'forest.300' },
      selection: { _: 'forest.700', text: 'forest.50' },
      glow: { _: 'forest.700', subtle: 'forest.200', strong: 'forest.500' },
      status: { success: 'lime.700', warning: 'gold.600', error: 'fire.700' },
      scheme: {
        50: 'forest.50',
        100: 'forest.100',
        200: 'forest.200',
        300: 'forest.300',
        400: 'forest.400',
        500: 'forest.500',
        600: 'forest.600',
        700: 'forest.700',
        800: 'forest.800',
        900: 'forest.900',
        950: 'forest.950',
      },
    },
    violet: {
      primary: { _: 'violet.400', hover: 'violet.300' },
      secondary: 'violet.300',
      accent: 'rose.400',
      bg: { _: 'violet.950', muted: 'violet.900', inverse: 'violet.50' },
      surface: { _: 'violet.900', hover: 'violet.800' },
      text: { _: 'gray.100', muted: 'violet.300', dim: 'warm.500' },
      border: { _: 'violet.800', strong: 'violet.700' },
      code: { _: 'violet.900', text: 'rose.300', border: 'violet.800' },
      scrollbar: { _: 'violet.400', track: 'violet.950', muted: 'violet.700' },
      selection: { _: 'violet.500', text: 'violet.950' },
      glow: { _: 'violet.400', subtle: 'violet.800', strong: 'rose.400' },
      status: { success: 'cyan.400', warning: 'gold.300', error: 'rose.500' },
      scheme: {
        50: 'violet.50',
        100: 'violet.100',
        200: 'violet.200',
        300: 'violet.300',
        400: 'violet.400',
        500: 'violet.500',
        600: 'violet.600',
        700: 'violet.700',
        800: 'violet.800',
        900: 'violet.900',
        950: 'violet.950',
      },
    },
    rose: {
      primary: { _: 'rose.700', hover: 'rose.500' },
      secondary: 'rose.600',
      accent: 'violet.600',
      bg: { _: 'rose.50', muted: 'rose.100', inverse: 'rose.900' },
      surface: { _: 'rose.200', hover: 'rose.300' },
      text: { _: 'gray.800', muted: 'gray.500', dim: 'rose.600' },
      border: { _: 'rose.200', strong: 'rose.300' },
      code: { _: 'rose.100', text: 'rose.700', border: 'rose.200' },
      scrollbar: { _: 'rose.700', track: 'rose.50', muted: 'rose.300' },
      selection: { _: 'rose.700', text: 'rose.50' },
      glow: { _: 'rose.700', subtle: 'rose.200', strong: 'rose.500' },
      status: { success: 'forest.700', warning: 'gold.600', error: 'fire.700' },
      scheme: {
        50: 'rose.50',
        100: 'rose.100',
        200: 'rose.200',
        300: 'rose.300',
        400: 'rose.400',
        500: 'rose.500',
        600: 'rose.600',
        700: 'rose.700',
        800: 'rose.800',
        900: 'rose.900',
        950: 'rose.950',
      },
    },
    // ─── Copper Dark (earth + cyan complement) ─────────
    terra: {
      primary: { _: 'copper.400', hover: 'copper.300' },
      secondary: 'copper.300',
      accent: 'cyan.300',
      bg: { _: 'copper.950', muted: 'copper.900', inverse: 'copper.50' },
      surface: { _: 'copper.900', hover: 'copper.800' },
      text: { _: 'warm.200', muted: 'copper.300', dim: 'copper.500' },
      border: { _: 'copper.800', strong: 'copper.700' },
      code: { _: 'copper.900', text: 'cyan.300', border: 'copper.800' },
      scrollbar: { _: 'copper.400', track: 'copper.950', muted: 'copper.700' },
      selection: { _: 'copper.400', text: 'copper.950' },
      glow: { _: 'copper.400', subtle: 'copper.800', strong: 'cyan.300' },
      status: { success: 'cyan.500', warning: 'gold.300', error: 'fire.500' },
      scheme: {
        50: 'copper.50',
        100: 'copper.100',
        200: 'copper.200',
        300: 'copper.300',
        400: 'copper.400',
        500: 'copper.500',
        600: 'copper.600',
        700: 'copper.700',
        800: 'copper.800',
        900: 'copper.900',
        950: 'copper.950',
      },
    },
    // ─── Copper Light (adobe + ocean complement) ───────
    adobe: {
      primary: { _: 'copper.700', hover: 'copper.500' },
      secondary: 'copper.600',
      accent: 'ocean.700',
      bg: { _: 'copper.50', muted: 'copper.100', inverse: 'copper.900' },
      surface: { _: 'copper.200', hover: 'copper.300' },
      text: { _: 'gray.800', muted: 'copper.700', dim: 'copper.600' },
      border: { _: 'copper.200', strong: 'copper.300' },
      code: { _: 'copper.100', text: 'copper.700', border: 'copper.200' },
      scrollbar: { _: 'copper.700', track: 'copper.50', muted: 'copper.300' },
      selection: { _: 'copper.700', text: 'copper.50' },
      glow: { _: 'copper.700', subtle: 'copper.200', strong: 'copper.500' },
      status: { success: 'forest.700', warning: 'gold.600', error: 'fire.700' },
      scheme: {
        50: 'copper.50',
        100: 'copper.100',
        200: 'copper.200',
        300: 'copper.300',
        400: 'copper.400',
        500: 'copper.500',
        600: 'copper.600',
        700: 'copper.700',
        800: 'copper.800',
        900: 'copper.900',
        950: 'copper.950',
      },
    },
  })
  .addScale({
    name: 'space',
    values: {
      0: '0',
      2: '0.125rem',
      4: '0.25rem',
      6: '0.375rem',
      8: '0.5rem',
      12: '0.75rem',
      16: '1rem',
      20: '1.25rem',
      24: '1.5rem',
      32: '2rem',
      48: '3rem',
      64: '4rem',
      96: '6rem',
      128: '8rem',
      160: '10rem',
      192: '12rem',
    },
  })
  .addScale({
    name: 'fontSizes',
    values: {
      11: '0.6875rem',
      12: '0.75rem',
      13: '0.8125rem',
      14: '0.875rem',
      16: '1rem',
      18: '1.125rem',
      20: '1.25rem',
      24: '1.5rem',
      32: '2rem',
      40: '2.5rem',
      48: '3rem',
      56: '3.5rem',
      72: '4.5rem',
      96: '6rem',
      128: '8rem',
      160: '10rem',
      192: '12rem',
    },
  })
  .addScale({
    name: 'fontWeights',
    values: { 300: '300', 400: '400', 500: '500', 700: '700', 800: '800' },
  })
  .addScale({
    name: 'lineHeights',
    values: {
      none: '1',
      tight: '1.1',
      snug: '1.3',
      base: '1.5',
      relaxed: '1.7',
      loose: '2',
    },
  })
  .addScale({
    name: 'fonts',
    values: {
      display: "'IBM Plex Mono', monospace",
      logo: "'Major Mono Display', monospace",
      body: "'Geist', sans-serif",
      mono: "'IBM Plex Mono', monospace",
    },
  })
  .addScale({ name: 'radii', values: { 0: '0' } })
  .addScale({
    name: 'borders',
    values: {
      1: '1px solid ',
      2: '2px solid ',
      3: '3px solid {colors.scheme.100}',
    },
  })
  .addScale({
    name: 'elevation',
    values: {
      0: 'none',
      glow: '0 0 8px {colors.glow/40}, 0 0 24px {colors.glow/10}',
      'glow-strong':
        '0 0 12px {colors.glow.strong/60}, 0 0 40px {colors.glow.strong/20}',
      'glow-subtle': '0 0 4px {colors.glow.subtle/40}',
    },
  })
  .addScale({
    name: 'shadows',
    values: {
      logo: '.12em calc(.08em * -1) rgb(255, 255, 255), calc(.12em + 1px) calc((.08em * -1) + 1px) rgba(0, 0, 0, 0.7), calc(.12em + 1px) calc((.08em * -1) + -1px) rgba(0, 0, 0, 0.7), calc(.12em + -1px) calc((.08em * -1) + -1px) rgba(0, 0, 0, 0.7), calc(.12em + -1px) calc((.08em * -1) + 1px) rgba(0, 0, 0, 0.7)',
      'glow-accent': '0 0 8px {colors.glow.subtle/30}',
      'glow-md': '0 0 12px {colors.glow/50}',
      'glow-lg': '0 0 12px {colors.glow/60}',
      'glow-fire': '0 0 12px {colors.glow/40}, 0 0 40px {colors.glow/10}',
      // Text shadow glow presets (semantic, shift per mode)
      'glow-text': '0 0 30px {colors.glow/40}, 0 0 80px {colors.glow/15}',
      'glow-text-strong':
        '0 0 50px {colors.glow/70}, 0 0 120px {colors.glow/25}',
    },
  })
  .addScale({
    name: 'rings',
    values: { 1: '0 0 0 1px currentColor', 2: '0 0 0 2px currentColor' },
  })
  .addScale({
    name: 'aspects',
    values: {
      square: '1 / 1',
      video: '16 / 9',
      wide: '21 / 9',
      golden: '1.618 / 1',
    },
  })
  .addScale({
    name: 'sizes',
    emit: true,
    values: { navHeight: '48px', sidebarWidth: '200px', tocWidth: '180px' },
  })
  .declareContextualVars({
    colors: ['current-bg'],
  })
  .build();

export type ShowcaseTheme = typeof tokens;

declare module '@animus-ui/system' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Theme extends ShowcaseTheme {}
}

// ─── System ─────────────────────────────────────────────────

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('surface', {
    ...color,
    ...border,
    ...shadows,
    ...background,
    ring: { property: 'boxShadow', scale: 'rings' },
  })
  .addGroup('arrange', {
    ...flex,
    ...grid,
    ...layout,
    ratio: { property: 'aspectRatio', transform: ratio } as const,
  })
  .addGroup('text', {
    ...typography,
    fluidSize: { property: 'fontSize', transform: fluid } as const,
  })
  .addGroup('motion', { ...transitions })
  .addGroup('space', space)
  .addGroup('positioning', positioning)
  .includes([testDs])
  .build();

// ─── Global Styles ──────────────────────────────────────────

export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  html: {
    fontFamily: 'sans-serif',
    lineHeight: '1.15',
    WebkitTextSizeAdjust: '100%',
    WebkitTapHighlightColor: 'rgba(0, 0, 0, 0)',
    WebkitFontSmoothing: 'antialiased',
  },
  body: {
    m: 0,
    fontWeight: '400',
    lineHeight: '1.625',
    textAlign: 'left',
  },
  '[tabindex="-1"]:focus': { outline: '0 !important' },
  hr: { boxSizing: 'content-box', height: '0', overflow: 'visible' },
  'h1, h2, h3, h4, h5, h6': { marginTop: '0' },
  p: { marginTop: '0', marginBottom: '1rem' },
  'pre, code, kbd, samp': {
    fontFamily: 'monospace, monospace',
    fontSize: '1em',
  },
  pre: { marginTop: '0', marginBottom: '1rem', overflow: 'auto' },
  img: { verticalAlign: 'middle', borderStyle: 'none' },
  button: { borderRadius: '0', background: 'transparent' },
  'input, button, select, optgroup, textarea': {
    margin: '0',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },
  'html, body': { bg: 'bg', color: 'text' },
  a: {
    color: 'primary',
    textDecoration: 'none',
    backgroundColor: 'transparent',
  },
  'a:hover': { textDecoration: 'underline' },
  '::-webkit-scrollbar': { width: '3px', height: '3px' },
  '::-webkit-scrollbar-track': { background: 'transparent' },
  '::-webkit-scrollbar-thumb': { bg: 'scrollbar' },
  'pre ::-webkit-scrollbar': { height: '3px' },
  'pre ::-webkit-scrollbar-track': { background: 'transparent' },
  'pre ::-webkit-scrollbar-thumb': { bg: 'scrollbar.muted' },
  '::selection': { bg: 'selection', color: 'selection.text' },
  'body::after': {
    content: '""',
    position: 'fixed',
    top: '0',
    right: '0',
    bottom: '0',
    left: '0',
    pointerEvents: 'none',
    zIndex: '9999',
    opacity: '0.04',
    backgroundImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='g'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23g)' opacity='1'/%3E%3C/svg%3E\")",
    backgroundSize: '150px 150px',
  },
  // Keyframe definitions
  '@keyframes ember': {
    '0%, 100%': { textShadow: 'glow-text' },
    '50%': { textShadow: 'glow-text-strong' },
  },
  '@keyframes flow': {
    '0%': { backgroundPosition: '200% 0' },
    '100%': { backgroundPosition: '-200% 0' },
  },
  '@keyframes tally-pulse': {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.02)' },
  },
});
