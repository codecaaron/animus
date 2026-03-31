import { createSystem, createTheme } from '@animus-ui/system';
import {
  border,
  color,
  layout,
  space,
  typography,
} from '@animus-ui/system/groups';

// ─── Tokens ─────────────────────────────────────────────────

export const tokens = createTheme({
  breakpoints: { sm: 640, md: 768, lg: 1024 },
})
  .addColors({
    gray: {
      100: '#f5f5f5',
      300: '#d4d4d4',
      500: '#737373',
      700: '#404040',
      900: '#171717',
    },
    blue: { 500: '#3b82f6', 700: '#1d4ed8' },
    red: { 500: '#ef4444', 700: '#b91c1c' },
    green: { 500: '#22c55e', 700: '#15803d' },
    amber: { 500: '#f59e0b', 700: '#b45309' },
  })
  .addColorModes('dark', {
    dark: {
      primary: { _: 'blue-500', hover: 'blue-700' },
      secondary: 'green-500',
      danger: { _: 'red-500', hover: 'red-700' },
      background: 'gray-900',
      surface: 'gray-700',
      text: { _: 'gray-100', muted: 'gray-300' },
      border: 'gray-500',
    },
  })
  .addScale({
    name: 'space',
    values: {
      0: '0',
      4: '0.25rem',
      8: '0.5rem',
      12: '0.75rem',
      16: '1rem',
      24: '1.5rem',
      32: '2rem',
    },
  })
  .addScale({
    name: 'fontSizes',
    values: {
      14: '0.875rem',
      16: '1rem',
      20: '1.25rem',
      24: '1.5rem',
      32: '2rem',
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
  .addGroup('layout', layout)
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border })
  .build();

// ─── Global Styles ──────────────────────────────────────────

export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  html: { WebkitFontSmoothing: 'antialiased' },
  body: {
    m: 0,
    fontFamily: 'system-ui, sans-serif',
    lineHeight: '1.5',
    bg: 'background',
    color: 'text',
  },
});
