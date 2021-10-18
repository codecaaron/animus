import { createTheme } from '@animus/theming';
import { darken, lighten } from 'polished';

export const theme = createTheme({
  breakpoints: {
    xs: `@media only screen and (min-width: 480px)`,
    sm: `@media only screen and (min-width: 768px)`,
    md: `@media only screen and (min-width: 1024px)`,
    lg: `@media only screen and (min-width: 1200px)`,
    xl: `@media only screen and (min-width: 1440px)`,
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
  lineHeight: {
    base: 1.5,
    title: 1,
  },
  fontWeight: {
    400: 400,
    700: 700,
  },
  fontFamily: {
    base: '"Open Sans", sans-serif',
    title: '"Share Tech Mono", monospace, sans-serif',
  },
})
  .addColors({
    pink: {
      '200': lighten(0.3, '#93264F'),
      '300': lighten(0.2, '#93264F'),
      '400': lighten(0.1, '#93264F'),
      '500': '#93264F',
      '600': darken(0.1, '#93264F'),
      '700': darken(0.2, '#93264F'),
      '800': darken(0.3, '#93264F'),
    },
    navy: {
      '100': '#F3F3F5',
      '200': '#DBDCE0',
      '300': '#C3C5CB',
      '400': '#9FA2AC',
      '500': '#707382',
      '600': '#585C6D',
      '700': '#232940',
      '800': '#10162F',
      '900': '#0A0D1C',
    },
    blue: {
      '0': '#F5FCFF',
      '300': '#66C4FF',
      '400': '#3388FF',
      '500': '#1557FF',
      '800': '#1D2340',
    },
    yellow: {
      '0': '#FFFAE5',
      '400': '#CCA900',
      '500': '#FFD300',
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
        _: 'pink-500',
        hover: 'blue-400',
      },
      secondary: {
        _: 'navy-800',
        hover: 'navy-700',
      },
    },
    dark: {
      text: 'white',
      scrollbar: 'modifier-lighten-200',
      background: {
        _: 'pink-500',
        current: 'pink-500',
        muted: 'modifier-darken-200',
        emphasized: 'modifier-darken-100',
      },
      primary: {
        _: 'white',
        hover: 'navy-100',
      },
      secondary: {
        _: 'white',
        hover: 'navy-100',
      },
    },
  })
  .addScale('borders', ({ colors }) => ({
    1: `1px solid ${colors.secondary}`,
    2: `2px solid ${colors.secondary}`,
    4: `4px solid ${colors.secondary}`,
  }))
  .build();
