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

export const tokens = createTheme({
  breakpoints: { xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 },
})
  .addScale('space', () => ({
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
  }))
  .addScale('fontSizes', () => ({
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
  }))
  .addScale('fontWeights', () => ({
    300: '300',
    400: '400',
    500: '500',
    700: '700',
    800: '800',
  }))
  .addScale('lineHeights', () => ({
    none: '1',
    tight: '1.1',
    snug: '1.3',
    base: '1.5',
    relaxed: '1.7',
    loose: '2',
  }))
  .addScale('fonts', () => ({
    display: "'IBM Plex Mono', monospace",
    logo: "'Major Mono Display', monospace",
    body: "'Geist', sans-serif",
    mono: "'IBM Plex Mono', monospace",
  }))
  .addScale('radii', () => ({
    0: '0',
  }))
  .addScale('borders', () => ({
    1: '1px solid ',
    2: '2px solid ',
    3: '3px solid ',
  }))
  .addScale('elevation', () => ({
    0: 'none',
    glow: '0 0 8px {colors.glow/40}, 0 0 24px {colors.glow/10}',
    'glow-strong': '0 0 12px {colors.glow-strong/60}, 0 0 40px {colors.glow-strong/20}',
    'glow-subtle': '0 0 4px {colors.glow-subtle/40}',
  }))
  .addScale('shadows', () => ({
    logo: '.12em calc(.08em * -1) rgb(255, 255, 255), calc(.12em + 1px) calc((.08em * -1) + 1px) rgba(0, 0, 0, 0.7), calc(.12em + 1px) calc((.08em * -1) + -1px) rgba(0, 0, 0, 0.7), calc(.12em + -1px) calc((.08em * -1) + -1px) rgba(0, 0, 0, 0.7), calc(.12em + -1px) calc((.08em * -1) + 1px) rgba(0, 0, 0, 0.7)',
    'glow-accent': '0 0 8px {colors.glow-subtle/30}',
    'glow-md': '0 0 12px {colors.glow/50}',
    'glow-lg': '0 0 12px {colors.glow/60}',
    'glow-fire': '0 0 12px {colors.glow/40}, 0 0 40px {colors.glow/10}',
    // Text shadow glow presets (semantic, shift per mode)
    'glow-text': '0 0 30px {colors.glow/40}, 0 0 80px {colors.glow/15}',
    'glow-text-strong': '0 0 50px {colors.glow/70}, 0 0 120px {colors.glow/25}',
  }))
  .addScale('rings', () => ({
    1: '0 0 0 1px currentColor',
    2: '0 0 0 2px currentColor',
  }))
  .addScale('aspects', () => ({
    square: '1 / 1',
    video: '16 / 9',
    wide: '21 / 9',
    golden: '1.618 / 1',
  }))
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
  })
  .addColorModes('dark', {
    dark: {
      primary: { _: 'fire-500', hover: 'fire-600' },
      secondary: 'fire-400',
      accent: 'gold-300',
      bg: { _: 'gray-950', muted: 'gray-900', inverse: 'warm-100' },
      surface: { _: 'gray-800', hover: 'gray-700' },
      text: { _: 'warm-200', muted: 'gray-500', dim: 'gray-600' },
      border: { _: 'gray-600', strong: 'gray-500' },
      code: { _: 'gray-800', text: 'gold-300', border: 'gray-600' },
      scrollbar: { _: 'fire-500', track: 'gray-950', muted: 'fire-800' },
      selection: { _: 'fire-500', text: 'gray-950' },
      glow: { _: 'fire-500', subtle: 'fire-800', strong: 'fire-400' },
      status: { success: 'gold-300', warning: 'fire-400', error: 'fire-600' },
      scheme: { 50: 'fire-50', 100: 'fire-100', 200: 'fire-200', 300: 'fire-300', 400: 'fire-400', 500: 'fire-500', 600: 'fire-600', 700: 'fire-700', 800: 'fire-800', 900: 'fire-900', 950: 'fire-950' },
    },
    light: {
      primary: { _: 'fire-700', hover: 'fire-500' },
      secondary: 'fire-600',
      accent: 'fire-400',
      bg: { _: 'warm-100', muted: 'warm-200', inverse: 'gray-900' },
      surface: { _: 'warm-300', hover: 'warm-400' },
      text: { _: 'gray-800', muted: 'gray-500', dim: 'gray-400' },
      border: { _: 'warm-300', strong: 'warm-400' },
      code: { _: 'warm-200', text: 'fire-700', border: 'warm-300' },
      scrollbar: { _: 'fire-700', track: 'warm-100', muted: 'fire-300' },
      selection: { _: 'fire-700', text: 'warm-50' },
      glow: { _: 'fire-700', subtle: 'fire-200', strong: 'fire-500' },
      status: { success: 'fire-700', warning: 'fire-400', error: 'fire-600' },
      scheme: { 50: 'warm-50', 100: 'fire-100', 200: 'fire-300', 300: 'fire-400', 400: 'fire-600', 500: 'fire-700', 600: 'fire-800', 700: 'fire-900', 800: 'fire-100', 900: 'fire-50', 950: 'fire-950' },
    },
    midnight: {
      primary: { _: 'fire-500', hover: 'fire-400' },
      secondary: 'gold-300',
      accent: 'gold-200',
      bg: { _: 'gray-950', muted: 'gray-900', inverse: 'gray-100' },
      surface: { _: 'gray-900', hover: 'gray-800' },
      text: { _: 'gray-200', muted: 'gray-400', dim: 'gray-600' },
      border: { _: 'gray-700', strong: 'gray-600' },
      code: { _: 'gray-900', text: 'gold-200', border: 'gray-700' },
      scrollbar: { _: 'gold-300', track: 'gray-950', muted: 'gold-700' },
      selection: { _: 'gold-300', text: 'gray-950' },
      glow: { _: 'gold-300', subtle: 'gold-800', strong: 'gold-200' },
      status: { success: 'gold-300', warning: 'fire-400', error: 'fire-600' },
      scheme: { 50: 'fire-50', 100: 'fire-100', 200: 'fire-200', 300: 'fire-300', 400: 'fire-400', 500: 'fire-500', 600: 'fire-600', 700: 'fire-700', 800: 'fire-800', 900: 'fire-900', 950: 'fire-950' },
    },
    ember: {
      primary: { _: 'fire-400', hover: 'fire-300' },
      secondary: 'gold-300',
      accent: 'fire-200',
      bg: { _: 'fire-950', muted: 'fire-900', inverse: 'warm-50' },
      surface: { _: 'fire-900', hover: 'fire-800' },
      text: { _: 'warm-100', muted: 'warm-400', dim: 'fire-700' },
      border: { _: 'fire-800', strong: 'fire-700' },
      code: { _: 'fire-900', text: 'gold-200', border: 'fire-800' },
      scrollbar: { _: 'fire-400', track: 'fire-950', muted: 'fire-700' },
      selection: { _: 'fire-400', text: 'fire-950' },
      glow: { _: 'fire-400', subtle: 'fire-800', strong: 'fire-300' },
      status: { success: 'gold-300', warning: 'fire-300', error: 'fire-500' },
      scheme: { 50: 'fire-50', 100: 'fire-100', 200: 'fire-200', 300: 'fire-300', 400: 'fire-400', 500: 'fire-500', 600: 'fire-600', 700: 'fire-700', 800: 'fire-800', 900: 'fire-900', 950: 'fire-950' },
    },
    ocean: {
      primary: { _: 'ocean-500', hover: 'ocean-400' },
      secondary: 'ocean-300',
      accent: 'cyan-300',
      bg: { _: 'ocean-950', muted: 'ocean-900', inverse: 'ocean-50' },
      surface: { _: 'ocean-900', hover: 'ocean-800' },
      text: { _: 'gray-100', muted: 'ocean-300', dim: 'ocean-600' },
      border: { _: 'ocean-800', strong: 'ocean-700' },
      code: { _: 'ocean-900', text: 'cyan-300', border: 'ocean-800' },
      scrollbar: { _: 'ocean-400', track: 'ocean-950', muted: 'ocean-700' },
      selection: { _: 'ocean-500', text: 'ocean-950' },
      glow: { _: 'ocean-400', subtle: 'ocean-800', strong: 'cyan-300' },
      status: { success: 'cyan-500', warning: 'gold-300', error: 'fire-500' },
      scheme: { 50: 'ocean-50', 100: 'ocean-100', 200: 'ocean-200', 300: 'ocean-300', 400: 'ocean-400', 500: 'ocean-500', 600: 'ocean-600', 700: 'ocean-700', 800: 'ocean-800', 900: 'ocean-900', 950: 'ocean-950' },
    },
    forest: {
      primary: { _: 'forest-500', hover: 'forest-400' },
      secondary: 'forest-300',
      accent: 'lime-300',
      bg: { _: 'forest-950', muted: 'forest-900', inverse: 'forest-50' },
      surface: { _: 'forest-900', hover: 'forest-800' },
      text: { _: 'gray-100', muted: 'forest-300', dim: 'forest-600' },
      border: { _: 'forest-800', strong: 'forest-700' },
      code: { _: 'forest-900', text: 'lime-300', border: 'forest-800' },
      scrollbar: { _: 'forest-400', track: 'forest-950', muted: 'forest-700' },
      selection: { _: 'forest-500', text: 'forest-950' },
      glow: { _: 'forest-400', subtle: 'forest-800', strong: 'lime-300' },
      status: { success: 'lime-400', warning: 'gold-300', error: 'fire-500' },
      scheme: { 50: 'forest-50', 100: 'forest-100', 200: 'forest-200', 300: 'forest-300', 400: 'forest-400', 500: 'forest-500', 600: 'forest-600', 700: 'forest-700', 800: 'forest-800', 900: 'forest-900', 950: 'forest-950' },
    },
    violet: {
      primary: { _: 'violet-500', hover: 'violet-400' },
      secondary: 'violet-300',
      accent: 'rose-400',
      bg: { _: 'violet-950', muted: 'violet-900', inverse: 'violet-50' },
      surface: { _: 'violet-900', hover: 'violet-800' },
      text: { _: 'gray-100', muted: 'violet-300', dim: 'violet-600' },
      border: { _: 'violet-800', strong: 'violet-700' },
      code: { _: 'violet-900', text: 'rose-300', border: 'violet-800' },
      scrollbar: { _: 'violet-400', track: 'violet-950', muted: 'violet-700' },
      selection: { _: 'violet-500', text: 'violet-950' },
      glow: { _: 'violet-400', subtle: 'violet-800', strong: 'rose-400' },
      status: { success: 'cyan-400', warning: 'gold-300', error: 'rose-500' },
      scheme: { 50: 'violet-50', 100: 'violet-100', 200: 'violet-200', 300: 'violet-300', 400: 'violet-400', 500: 'violet-500', 600: 'violet-600', 700: 'violet-700', 800: 'violet-800', 900: 'violet-900', 950: 'violet-950' },
    },
    rose: {
      primary: { _: 'rose-500', hover: 'rose-400' },
      secondary: 'rose-300',
      accent: 'violet-300',
      bg: { _: 'rose-950', muted: 'rose-900', inverse: 'rose-50' },
      surface: { _: 'rose-900', hover: 'rose-800' },
      text: { _: 'gray-100', muted: 'rose-300', dim: 'rose-600' },
      border: { _: 'rose-800', strong: 'rose-700' },
      code: { _: 'rose-900', text: 'violet-200', border: 'rose-800' },
      scrollbar: { _: 'rose-400', track: 'rose-950', muted: 'rose-700' },
      selection: { _: 'rose-500', text: 'rose-950' },
      glow: { _: 'rose-400', subtle: 'rose-800', strong: 'violet-300' },
      status: { success: 'forest-400', warning: 'gold-300', error: 'fire-500' },
      scheme: { 50: 'rose-50', 100: 'rose-100', 200: 'rose-200', 300: 'rose-300', 400: 'rose-400', 500: 'rose-500', 600: 'rose-600', 700: 'rose-700', 800: 'rose-800', 900: 'rose-900', 950: 'rose-950' },
    },
  })
  .build();

export type ShowcaseTheme = typeof tokens;

declare module '@animus-ui/system' {
  // eslint-disable-next-line @typescript-eslint/no-empty-interface
  interface Theme extends ShowcaseTheme {}
}

// ─── System ─────────────────────────────────────────────────

export const ds = createSystem()
  .withProperties((p) =>
    p
      .addGroup('surface', {
        ...color,
        ...border,
        ...shadows,
        ...background,
        ring: { property: 'boxShadow', scale: 'rings' } as const,
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
      .build()
  )
  .withGlobalStyles({
    reset: {
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
      button: { borderRadius: '0' },
      'input, button, select, optgroup, textarea': {
        margin: '0',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
      },
    },
    global: {
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
      'pre ::-webkit-scrollbar-thumb': { bg: 'scrollbar-muted' },
      '::selection': { bg: 'selection', color: 'selection-text' },
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
    },
  })
  .build();
