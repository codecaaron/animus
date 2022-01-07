import { createTheme } from '@animus/theming';
import { darken, lighten } from 'polished';

export const theme = createTheme({
  breakpoints: {
    xs: 480,
    sm: 768,
    md: 1024,
    lg: 1200,
    xl: 1440,
  },
  spacing: {
    0: 0,
    4: 4,
    8: 8,
    12: 12,
    16: 16,
    24: 24,
    32: 32,
    40: 40,
    48: 48,
    64: 64,
    96: 96,
  },
  fontSize: {
    64: 64,
    44: 44,
    34: 34,
    26: 26,
    22: 22,
    20: 20,
    18: 18,
    16: 16,
    14: 14,
  },
  fontWeight: {
    400: 400,
    600: 600,
    700: 700,
  },
  lineHeight: {
    base: 1.5,
    title: 1,
  },
  fontFamily: {
    base: '"Inter", sans-serif',
    title: '"Major Mono Display", monospace, sans-serif',
    mono: '"PT Mono", monospace',
  },
})
  .addColors({
    navy: {
      '100': lighten(0.5, '#282a36'),
      '700': lighten(0.1, '#282a36'),
      '800': '#282a36',
      '900': darken(0.1, '#282a36'),
    },
    blue: {
      '0': '#F5FCFF',
      '300': '#66C4FF',
      '400': '#3388FF',
      '500': '#1557FF',
      '800': '#1D2340',
    },
    green: {
      400: '#8aff80',
    },
    purple: {
      400: lighten(0.1, '#9580ff'),
      500: '#9580ff',
      600: darken(0.1, '#9580ff'),
    },
    pink: {
      400: lighten(0.1, '#ff80bf'),
      500: '#ff80bf',
      600: darken(0.1, '#ff80bf'),
    },
    white: '#FFFFFF',
    modifier: {
      lighten: {
        100: 'rgba(255, 255, 255, 0.1)',
        200: 'rgba(255, 255, 255, 0.2)',
        300: 'rgba(255, 255, 255, 0.3)',
      },
      darken: {
        100: 'rgba(0, 0, 0, 0.1)',
        200: 'rgba(0, 0, 0, 0.2)',
        300: 'rgba(0, 0, 0, 0.3)',
      },
    },
  })
  .addColorModes('dark', {
    light: {
      text: 'navy-800',
      scrollbar: 'modifier-darken-200',
      background: {
        _: 'white',
        current: 'white',
        muted: 'modifier-darken-200',
        emphasized: 'modifier-darken-100',
      },
      primary: {
        _: 'purple-600',
        hover: 'purple-500',
      },
      secondary: {
        _: 'navy-800',
        hover: 'navy-700',
      },
      tertiary: {
        _: 'pink-600',
        hover: 'pink-500',
      },
    },
    dark: {
      text: 'white',
      scrollbar: 'modifier-darken-200',
      background: {
        _: 'navy-800',
        current: 'navy-800',
        muted: 'modifier-darken-200',
        emphasized: 'modifier-darken-100',
      },
      primary: {
        _: 'pink-600',
        hover: 'pink-500',
      },
      secondary: {
        _: 'white',
        hover: 'navy-100',
      },
      tertiary: {
        _: 'purple-600',
        hover: 'purple-500',
      },
    },
  })
  .addScale('borders', ({ colors }) => ({
    1: `1px solid ${colors.secondary}`,
    2: `2px solid ${colors.secondary}`,
    4: `4px solid ${colors.secondary}`,
  }))
  .build();

export type AnimusTheme = typeof theme;

declare module '@emotion/react' {
  export interface Theme extends AnimusTheme {}
}
