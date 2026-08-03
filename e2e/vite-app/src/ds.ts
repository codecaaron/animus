import { createSystem, createTheme } from '@animus-ui/system';
import {
  border,
  color,
  flex,
  layout,
  positioning,
  space,
  typography,
} from '@animus-ui/system/groups';
import { ds as testDs } from '@animus-ui/test-ds';

export const tokens = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
  .addColors({
    blue: { 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' },
    gray: { 100: '#f5f5f5', 500: '#737373', 700: '#404040', 900: '#171717' },
    red: { 500: '#ef4444', 700: '#b91c1c' },
    green: { 500: '#22c55e' },
  })
  // System participation (openspec: system-color-scheme, D2). App-LOCAL theme,
  // shared with nothing — the parity harness builds
  // `packages/extract/tests/test-system.ts`, not this module.
  //
  // This lane is the VITE delivery witness: the guarded media blocks emitted
  // here travel the same build as an UNGUARDED author-written `_osDark`
  // condition block (src/components/Card.tsx), which is exactly what keeps the
  // G2 guard assertion honest — it must accept the author block and still
  // require the guard on every root-targeting rule.
  .addColorModes(
    'dark',
    {
      dark: {
        primary: { _: 'blue.500', hover: 'blue.700' },
        secondary: 'green.500',
        danger: 'red.500',
        background: 'gray.900',
        surface: 'gray.700',
        text: { _: 'gray.100', muted: 'gray.500' },
        border: 'gray.700',
      },
      light: {
        primary: { _: 'blue.700', hover: 'blue.500' },
        secondary: 'green.500',
        danger: 'red.700',
        background: 'gray.100',
        surface: 'gray.100',
        text: { _: 'gray.900', muted: 'gray.500' },
        border: 'gray.100',
      },
    },
    {
      systemPreference: { light: 'light', dark: 'dark' },
      // Empty on purpose — this lane is the end-to-end witness for the D3
      // amendment: both modes are mapping-named, so their classifications
      // default to light/dark and the emission must be identical to spelling
      // them out (the assert lane pins color-scheme on :root, both mode
      // blocks, and both guarded blocks). next-app keeps explicit entries, so
      // both spellings stay covered.
      browserColorScheme: {},
    }
  )
  .addScale({
    name: 'space',
    values: {
      0: '0',
      4: '0.25rem',
      8: '0.5rem',
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
      20: '1.25rem',
      24: '1.5rem',
    },
  })
  .build();

export type ViteAppTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends ViteAppTheme {}
}

export const {
  system: ds,
  createGlobalStyles,
  createKeyframes,
} = createSystem({
  includes: [testDs],
})
  .addGroup('space', space)
  .addGroup('layout', { ...layout, ...flex })
  .addGroup('text', typography)
  .addGroup('surface', { ...color, ...border })
  .addGroup('positioning', positioning)
  // Condition alias registry (modern-css-surface inc 03). Registered here so
  // aliased condition blocks (e.g. `_motionReduce`) resolve during THIS app's
  // extraction — proving the manifest `conditionAliases` field flows through
  // the full plugin glue (loadSystemConfig → analyze args → engine adapter).
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
  })
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

export const animations = createKeyframes({
  fadeIn: {
    '0%': { opacity: 0, bg: 'background' },
    '100%': { opacity: 1, bg: 'surface' },
  },
  pulse: {
    '0%, 100%': { transform: 'scale(1)' },
    '50%': { transform: 'scale(1.05)' },
  },
});
