import { createSystem, createTheme } from '@animus-ui/system';
import {
  border,
  color,
  flex,
  layout,
  space,
  typography,
} from '@animus-ui/system/groups';
import { system as testDs } from '@animus-ui/test-ds/definition';

// DELIBERATE legacy lane (openspec: first-class-extension, Migration Plan
// step 2 / G6): this fixture keeps the deprecated `tokens` export name — it
// witnesses the loader's accepted fallback (rust-system-loader › "tokens
// fallback accepted"). Do not rename to `theme` while the deprecation window
// is open; every non-legacy fixture already uses `theme`.
export const tokens = createTheme()
  .addColors({
    blue: { 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' },
    gray: { 100: '#f5f5f5', 500: '#737373', 800: '#262626', 950: '#0a0a0a' },
    green: { 500: '#22c55e', 700: '#15803d' },
    red: { 500: '#ef4444', 700: '#b91c1c' },
  })
  .addColorModes('dark', {
    dark: {
      primary: { _: 'blue.500', hover: 'blue.700' },
      secondary: 'green.500',
      danger: 'red.500',
      background: 'gray.950',
      surface: 'gray.800',
      text: { _: 'gray.100', muted: 'gray.500' },
      border: 'gray.500',
    },
    light: {
      primary: { _: 'blue.700', hover: 'blue.500' },
      secondary: 'green.700',
      danger: 'red.700',
      background: 'gray.100',
      surface: 'gray.100',
      text: { _: 'gray.950', muted: 'gray.500' },
      border: 'gray.500',
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
      12: '0.75rem',
      14: '0.875rem',
      16: '1rem',
      24: '1.5rem',
      32: '2rem',
    },
  })
  .build();

export type ReactRouterTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends ReactRouterTheme {}
}

// DELIBERATE legacy lane (openspec: first-class-extension, Migration Plan
// step 2 / G6): this fixture is the `from()` deprecation-window witness — the
// chain keeps from()'s frozen semantics (type admission + discovery anchor,
// NO runtime registry merge), so every group the components need is still
// registered locally. next-app covers the `includes:` constructor alias;
// vite-app/next16-app/vinext-app use `.extend()` (showcase remains on
// `includes:` pending its deferred migration — registry row 13; see its
// ds.ts). Do not migrate this lane until removal is specced.
export const { system: ds, createGlobalStyles } = createSystem()
  .from(testDs)
  .addGroup('space', space)
  .addGroup('layout', { ...layout, ...flex })
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border })
  .build();

export const globalStyles = createGlobalStyles({
  '*, *::before, *::after': { boxSizing: 'border-box' },
  body: {
    m: 0,
    bg: 'background',
    color: 'text',
    fontFamily: 'system-ui, sans-serif',
  },
});
