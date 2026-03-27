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
    glow: '0 0 8px {colors.ember/40}, 0 0 24px {colors.ember/10}',
    'glow-strong': '0 0 12px {colors.ember/60}, 0 0 40px {colors.ember/20}',
    'glow-subtle': '0 0 4px {colors.ember/20}',
  }))
  .addScale('shadows', () => ({
    logo: '.12em calc(.08em * -1) rgb(255, 255, 255), calc(.12em + 1px) calc((.08em * -1) + 1px) rgba(0, 0, 0, 0.7), calc(.12em + 1px) calc((.08em * -1) + -1px) rgba(0, 0, 0, 0.7), calc(.12em + -1px) calc((.08em * -1) + -1px) rgba(0, 0, 0, 0.7), calc(.12em + -1px) calc((.08em * -1) + 1px) rgba(0, 0, 0, 0.7)',
    'glow-spark': '0 0 8px {colors.spark/20}',
    'glow-ember': '0 0 8px {colors.ember/30}',
    'glow-ember-md': '0 0 12px {colors.ember/50}',
    'glow-ember-lg': '0 0 12px {colors.ember/60}',
    'glow-fire': '0 0 12px {colors.ember/40}, 0 0 40px {colors.ember/10}',
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
    // Void
    void: '#000000',
    carbon: '#080808',
    coal: '#111111',
    graphite: '#1a1a1a',
    ash: '#2a2a2a',
    smoke: '#555555',
    fog: '#888888',
    // Fire
    ember: '#FF2800',
    flame: '#E63946',
    scorch: '#C1121F',
    heat: '#FF6B35',
    spark: '#FFB627',
    // Parchment
    bone: '#E8E0D0',
    cream: '#F2EBE0',
    parchment: '#D4C9B8',
    dust: '#A39888',
  })
  .addColorModes('dark', {
    dark: {
      primary: 'ember',
      primaryHover: 'flame',
      secondary: 'heat',
      accent: 'spark',
      background: 'void',
      backgroundMuted: 'carbon',
      surface: 'coal',
      surfaceHover: 'graphite',
      text: 'bone',
      textMuted: 'smoke',
      textDim: 'ash',
      border: 'ash',
      borderStrong: 'smoke',
      success: 'spark',
      warning: 'heat',
      error: 'flame',
    },
    light: {
      primary: 'scorch',
      primaryHover: 'ember',
      secondary: 'flame',
      accent: 'heat',
      background: 'cream',
      backgroundMuted: 'bone',
      surface: 'parchment',
      surfaceHover: 'dust',
      text: 'coal',
      textMuted: 'smoke',
      textDim: 'fog',
      border: 'parchment',
      borderStrong: 'dust',
      success: 'scorch',
      warning: 'heat',
      error: 'flame',
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
      'html, body': { bg: 'background', color: 'text' },
      a: {
        color: 'primary',
        textDecoration: 'none',
        backgroundColor: 'transparent',
      },
      'a:hover': { textDecoration: 'underline' },
      '::-webkit-scrollbar': { width: '3px', height: '3px' },
      '::-webkit-scrollbar-track': { background: 'transparent' },
      '::-webkit-scrollbar-thumb': { background: '{colors.ember}' },
      'pre ::-webkit-scrollbar': { height: '3px' },
      'pre ::-webkit-scrollbar-track': { background: 'transparent' },
      'pre ::-webkit-scrollbar-thumb': { background: '{colors.ember/40}' },
      '::selection': { background: '{colors.ember}', color: '{colors.void}' },
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
        '0%, 100%': {
          textShadow:
            '0 0 30px rgba(255,40,0,0.4), 0 0 80px rgba(255,40,0,0.15)',
        },
        '50%': {
          textShadow:
            '0 0 50px rgba(255,40,0,0.7), 0 0 120px rgba(255,40,0,0.25)',
        },
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
