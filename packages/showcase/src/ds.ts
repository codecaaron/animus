/**
 * ANIMUS — The Forge
 *
 * Vermilion on void. Monospace dominance. Zero border-radius.
 * The builder chain IS the cascade. The extraction pipeline IS the fire.
 *
 * createSystem() → one file, one instance, one truth.
 */
import { createSystem, createTransform } from '@animus-ui/system';
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
import { createTheme } from '@animus-ui/theming';

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

const tokens = createTheme({
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
    24: '1.5rem',
    32: '2rem',
    48: '3rem',
    64: '4rem',
    96: '6rem',
  }))
  .addScale('fontSizes', () => ({
    11: '0.6875rem',
    12: '0.75rem',
    14: '0.875rem',
    16: '1rem',
    18: '1.125rem',
    20: '1.25rem',
    24: '1.5rem',
    32: '2rem',
    40: '2.5rem',
    56: '3.5rem',
    72: '4.5rem',
  }))
  .addScale('fontWeights', () => ({
    400: '400',
    500: '500',
    700: '700',
    800: '800',
  }))
  .addScale('lineHeights', () => ({
    none: '1',
    tight: '1.15',
    snug: '1.3',
    base: '1.5',
    loose: '1.7',
  }))
  .addScale('fonts', () => ({
    logo: "'Major Mono Display', monospace",
    heading: "'Barlow Condensed', sans-serif",
    body: "'JetBrains Mono', monospace",
    mono: "'JetBrains Mono', monospace",
  }))
  .addScale('radii', () => ({
    0: '0',
  }))
  .addScale('borders', () => ({
    1: '1px solid currentColor',
    2: '2px solid currentColor',
    4: '4px solid currentColor',
  }))
  .addScale('elevation', () => ({
    0: 'none',
    glow: '0 0 8px rgba(255,40,0,0.4), 0 0 24px rgba(255,40,0,0.1)',
    'glow-strong': '0 0 12px rgba(255,40,0,0.5), 0 0 32px rgba(255,40,0,0.15)',
    'glow-subtle': '0 0 4px rgba(255,40,0,0.2)',
  }))
  .addScale('rings', () => ({
    1: '0 0 0 1px currentColor',
    2: '0 0 0 2px currentColor',
    3: '0 0 0 3px currentColor',
    4: '0 0 0 4px currentColor',
  }))
  .addScale('aspects', () => ({
    square: '1 / 1',
    video: '16 / 9',
    wide: '21 / 9',
    photo: '4 / 3',
    portrait: '3 / 4',
    golden: '1.618 / 1',
  }))
  .addColors({
    // Void spectrum
    void: '#000000',
    carbon: '#0A0A0A',
    coal: '#141414',
    graphite: '#1E1E1E',
    ash: '#333333',
    smoke: '#666666',
    // Fire spectrum
    ember: '#FF2800',
    flame: '#E63946',
    scorch: '#C1121F',
    heat: '#FF6B35',
    spark: '#FFB627',
    // Output spectrum
    bone: '#E8E4E0',
    white: '#FAFAFA',
    // Light mode surfaces
    paper: '#F5F0EB',
    parchment: '#EDE8E2',
    linen: '#E5E0DA',
    thread: '#C8C2BA',
    dust: '#8A847E',
  })
  .addColorModes('dark', {
    dark: {
      primary: 'ember',
      primaryHover: 'flame',
      secondary: 'heat',
      accent: 'spark',
      background: 'carbon',
      backgroundMuted: 'coal',
      surface: 'graphite',
      surfaceHover: 'ash',
      text: 'bone',
      textMuted: 'smoke',
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
      background: 'paper',
      backgroundMuted: 'parchment',
      surface: 'linen',
      surfaceHover: 'thread',
      text: 'carbon',
      textMuted: 'dust',
      border: 'thread',
      borderStrong: 'dust',
      success: 'scorch',
      warning: 'heat',
      error: 'flame',
    },
  })
  .build();

export type ShowcaseTheme = typeof tokens;

// ─── System ─────────────────────────────────────────────────

export const ds = createSystem()
  .withTokens(() => tokens)
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
  .build();

// ─── Primitives ─────────────────────────────────────────────

export const Panel = ds
  .styles({
    bg: 'surface',
    border: 1,
    borderColor: 'border',
    borderRadius: 0,
    p: 24,
    transition: 'border-color 0.15s ease',
    '&:hover': {
      borderColor: 'primary',
    },
  })
  .groups({ surface: true, space: true })
  .asElement('div');

export const Arrange = ds
  .styles({
    display: 'flex',
  })
  .groups({ arrange: true, space: true })
  .asElement('div');

export const GridArrange = ds
  .styles({
    display: 'grid',
  })
  .groups({ arrange: true, space: true })
  .asElement('div');

export const Prose = ds
  .styles({
    fontFamily: 'body',
    fontSize: 16,
    lineHeight: 'base',
    color: 'text',
    m: 0,
  })
  .groups({ text: true, surface: true, space: true })
  .asElement('p');

export const Chip = ds
  .styles({
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: 'mono',
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    borderRadius: 0,
    lineHeight: 'snug',
    px: 8,
    py: 4,
    border: 1,
    borderColor: 'primary',
    color: 'primary',
    bg: 'transparent',
    transition: 'all 0.15s ease',
  })
  .groups({ surface: true, space: true })
  .asElement('span');
