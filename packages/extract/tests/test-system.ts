/**
 * Shared test fixture: theme + system for extract test fixtures.
 *
 * Provides:
 * - `tokens` — a built theme with scales matching the canary test theme JSON
 * - `ds` — a system builder instance with all prop groups
 *
 * This matches the consumer API pattern (showcase/ds.ts uses the same approach).
 * Fixture files import `ds` and use `ds.styles({...}).asElement('div')` etc.
 *
 * The Rust chain walker detects builder chains structurally — it looks for
 * .styles()/.variant()/.states()/.system()/.asElement() patterns, not import
 * source. So `ds.styles({...})` works identically to the legacy `animus.styles({...})`.
 */
import { createSystem, createTheme } from '@animus-ui/system';
import {
  background,
  border,
  color,
  flex,
  grid,
  layout,
  mode,
  positioning,
  shadows,
  space,
  transitions,
  typography,
  vars,
} from '@animus-ui/system/groups';

// ─── Theme ─────────────────────────────────────────────────
// Mirrors the flattened theme in canary.test.ts
export const tokens = createTheme()
  .addBreakpoints({ xs: 480, sm: 768, md: 1024, lg: 1200, xl: 1440 })
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
      base: 'calc(2px + 2.8ex + 2px)',
      title: 'calc(2px + 2.8ex + 2px)',
    },
  })
  .addScale({
    name: 'radii',
    values: { 2: '2px', 4: '4px' },
  })
  .addScale({
    name: 'transitions',
    values: {
      text: '100ms linear text-shadow',
      bg: '500ms ease background-position',
    },
  })
  .addColors({
    background: '#1a1a2e',
    'background-current': '#1a1a2e',
    'background-muted': '#262640',
    text: '#e8e0d0',
    primary: '#ff2800',
    'primary-hover': '#ff5030',
    secondary: '#c4a000',
    'secondary-hover': '#d4b020',
    transparent: 'transparent',
    'syntax-background': '#0d0d1a',
  })
  .addColorModes('dark', {
    dark: {
      background: 'background',
      text: 'text',
      primary: 'primary',
      secondary: 'secondary',
    },
    light: {
      background: 'text',
      text: 'background',
      primary: 'secondary',
      secondary: 'primary',
    },
  })
  .declareContextualVars({
    colors: ['background-current'],
  })
  .build();

type TestTheme = typeof tokens;

declare module '@animus-ui/system' {
  interface Theme extends TestTheme {}
}

// ─── System ────────────────────────────────────────────────

export const { system: ds } = createSystem()
  .addGroup('flex', flex)
  .addGroup('grid', grid)
  .addGroup('mode', mode)
  .addGroup('vars', vars)
  .addGroup('space', space)
  .addGroup('color', color)
  .addGroup('layout', layout)
  .addGroup('borders', border)
  .addGroup('shadows', shadows)
  .addGroup('background', background)
  .addGroup('typography', typography)
  .addGroup('positioning', positioning)
  .addGroup('transitions', transitions)
  .build();
