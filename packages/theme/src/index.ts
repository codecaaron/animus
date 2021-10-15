import { createTheme } from '@animus/theming';

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
    base: 'sans-serif',
    title: 'serif',
  },
})
  .addColors({
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
  })
  .addColorModes('light', {
    light: {
      text: 'navy-800',
      background: { _: 'white', current: 'white' },
      primary: {
        _: 'blue-500',
        hover: 'blue-400',
      },
      secondary: {
        _: 'navy-800',
        hover: 'navy-700',
      },
    },
    dark: {
      text: 'white',
      background: { _: 'navy-800', current: 'navy-800' },
      primary: {
        _: 'yellow-500',
        hover: 'yellow-400',
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
