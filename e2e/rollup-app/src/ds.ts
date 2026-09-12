import { asset, createSystem, createTheme } from '@animus-ui/system';
import { system as testDs } from '@animus-ui/test-ds/definition';

export const theme = createTheme()
  .addBreakpoints({ sm: 640, md: 768, lg: 1024 })
  .addColors({
    blue: { 100: '#dbeafe', 500: '#3b82f6', 700: '#1d4ed8' },
    gray: { 100: '#f5f5f5', 500: '#737373', 700: '#404040', 900: '#171717' },
    red: { 500: '#ef4444', 700: '#b91c1c' },
    green: { 500: '#22c55e' },
  })
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
      // Empty on purpose: both modes are mapping-named, so classifications
      // default to light/dark and emission matches spelling them out.
      browserColorScheme: {},
    }
  )
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
      20: '1.25rem',
      24: '1.5rem',
    },
  })
  .build();

export type RollupAppTheme = typeof theme;

declare module '@animus-ui/system' {
  interface Theme extends RollupAppTheme {}
}

const bundle = createSystem()
  .extend(testDs)
  // The kit already carries `_motionReduce`; re-asserting it with an
  // identical value keeps a local witness (post-extend calls override).
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
  })
  .build();

export const { createGlobalStyles, createKeyframes } = bundle;

export const globalStyles = createGlobalStyles(
  {
    '*, *::before, *::after': { boxSizing: 'border-box' },
    body: {
      m: 0,
      bg: 'background',
      color: 'text',
      fontFamily: 'system-ui, sans-serif',
    },
  },
  {
    fontFaces: [
      {
        family: 'AnimusTestFont',
        src: [
          {
            url: asset('@animus-ui/test-ds/assets/test-font.woff2'),
            format: 'woff2',
          },
        ],
        display: 'swap',
      },
    ],
  }
);

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

export const ds = bundle
  .registerKeyframes({ animations })
  .registerGlobalStyles({ globalStyles })
  .seal();
