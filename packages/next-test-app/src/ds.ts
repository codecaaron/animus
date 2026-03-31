import { createSystem, createTheme, createTransform } from '@animus-ui/system';
import {
  border,
  color,
  flex,
  layout,
  positioning,
  shadows,
  space,
  typography,
} from '@animus-ui/system/groups';
import { ds as testDs } from '@animus-ui/test-ds';

// ─── Transforms ─────────────────────────────────────────────

export const size = createTransform('size', (value) => {
  const num = Number(value);
  if (!Number.isNaN(num) && num !== 0) return `${num}px`;
  return String(value);
});

// ─── Tokens ─────────────────────────────────────────────────

export const tokens = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024, xl: 1280 })
  .addColors({
    gray: {
      50: '#fafafa',
      100: '#f5f5f5',
      200: '#e5e5e5',
      300: '#d4d4d4',
      400: '#a3a3a3',
      500: '#737373',
      600: '#525252',
      700: '#404040',
      800: '#262626',
      900: '#171717',
      950: '#0a0a0a',
    },
    blue: {
      50: '#eff6ff',
      100: '#dbeafe',
      300: '#93c5fd',
      500: '#3b82f6',
      700: '#1d4ed8',
      900: '#1e3a5f',
    },
    red: {
      50: '#fef2f2',
      100: '#fee2e2',
      300: '#fca5a5',
      500: '#ef4444',
      700: '#b91c1c',
      900: '#7f1d1d',
    },
    green: {
      50: '#f0fdf4',
      100: '#dcfce7',
      300: '#86efac',
      500: '#22c55e',
      700: '#15803d',
      900: '#14532d',
    },
    amber: {
      50: '#fffbeb',
      100: '#fef3c7',
      300: '#fcd34d',
      500: '#f59e0b',
      700: '#b45309',
      900: '#78350f',
    },
  })
  .addColorModes('dark', {
    dark: {
      primary: { _: 'blue.500', hover: 'blue.700' },
      secondary: 'green.500',
      accent: 'amber.500',
      danger: { _: 'red.500', hover: 'red.700' },
      background: 'gray.950',
      surface: { _: 'gray.800', hover: 'gray.700' },
      text: { _: 'gray.100', muted: 'gray.400' },
      border: { _: 'gray.600', strong: 'gray.500' },
      code: { _: 'gray.800', text: 'amber.300' },
    },
    light: {
      primary: { _: 'blue.700', hover: 'blue.500' },
      secondary: 'green.700',
      accent: 'amber.700',
      danger: { _: 'red.700', hover: 'red.500' },
      background: 'gray.50',
      surface: { _: 'gray.200', hover: 'gray.300' },
      text: { _: 'gray.900', muted: 'gray.500' },
      border: { _: 'gray.300', strong: 'gray.400' },
      code: { _: 'gray.100', text: 'blue.700' },
    },
  })
  .addScale({
    name: 'space',
    values: {
      0: '0',
      1: '0.125rem',
      2: '0.25rem',
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
    },
  })
  .addScale({
    name: 'fontSizes',
    values: {
      12: '0.75rem',
      14: '0.875rem',
      16: '1rem',
      18: '1.125rem',
      20: '1.25rem',
      24: '1.5rem',
      32: '2rem',
      48: '3rem',
    },
  })
  .addScale({
    name: 'fontWeights',
    values: {
      300: '300',
      400: '400',
      500: '500',
      600: '600',
      700: '700',
    },
  })
  .addScale({
    name: 'lineHeights',
    values: {
      tight: '1.25',
      base: '1.5',
      relaxed: '1.75',
    },
  })
  .addScale({
    name: 'radii',
    values: {
      0: '0',
      2: '2px',
      4: '4px',
      8: '8px',
      16: '16px',
      full: '9999px',
    },
  })
  .addScale({
    name: 'shadows',
    values: {
      sm: '0 1px 2px rgba(0,0,0,0.05)',
      md: '0 4px 6px rgba(0,0,0,0.1)',
      lg: '0 10px 15px rgba(0,0,0,0.15)',
    },
  })
  .build();

export type TestTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends TestTheme {}
}

// ─── System ─────────────────────────────────────────────────

export const { system: ds, createGlobalStyles } = createSystem()
  .addGroup('space', space)
  .addGroup('layout', { ...layout, ...flex })
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border, ...shadows })
  .addGroup('positioning', positioning)
  .includes([testDs])
  .build();

// ─── Global Styles ──────────────────────────────────────────

export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  html: { WebkitFontSmoothing: 'antialiased' },
  body: {
    m: 0,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    lineHeight: '1.5',
    bg: 'background',
    color: 'text',
  },
  a: { color: 'primary', textDecoration: 'none' },
  'code, kbd': { fontFamily: 'ui-monospace, monospace', fontSize: 14 },
});
