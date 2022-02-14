import { createTheme } from '@animus-ui/theming';
import { darken, lighten } from 'polished';

export const theme = createTheme({
  breakpoints: {
    xs: 480,
    sm: 768,
    md: 1024,
    lg: 1200,
    xl: 1440,
  },
  space: [
    -96, -64, -48, -40, -32, -24, -16, -12, -8, -4, -2, 0, 2, 4, 8, 12, 16, 24,
    32, 40, 48, 64, 96,
  ] as const,
  fontSizes: [64, 44, 34, 30, 26, 22, 20, 18, 16, 14] as const,
  fontWeights: {
    400: 400,
    600: 600,
    700: 700,
  },
  lineHeights: {
    base: 'calc(2px + 2ex + 2px)',
    title: 'calc(2px + 1.5ex + 2px)',
  },
  fonts: {
    base: '"Inter", sans-serif',
    title: '"Major Mono Display", monospace, sans-serif',
    mono: '"PT Mono", monospace',
  },
  transitions: {
    text: '100ms linear text-shadow',
  },
})
  .addColors({
    neon: { 500: '#AEE938' },
    yellow: { 300: '#ffff80', 600: darken(0.5, '#ffff80') },
    navy: {
      '200': lighten(0.775, '#282a36'),
      '300': lighten(0.5, '#282a36'),
      '600': lighten(0.1, '#282a36'),
      '700': '#282a36',
      '800': darken(0.08, '#282a36'),
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
      700: '#2ed22e',
    },
    orange: {
      500: '#ff401a',
    },
    purple: {
      300: lighten(0.2, '#9580ff'),
      400: lighten(0.1, '#9580ff'),
      500: '#9580ff',
      600: darken(0.1, '#9580ff'),
      700: darken(0.2, '#9580ff'),
    },
    pink: {
      300: lighten(0.2, '#ff80bf'),
      400: lighten(0.1, '#ff80bf'),
      500: '#ff80bf',
      600: darken(0.1, '#ff80bf'),
      700: darken(0.2, '#ff80bf'),
      800: darken(0.3, '#ff80bf'),
    },
    white: '#FFFFFF',
    modifier: {
      lighten: {
        100: 'rgba(255, 255, 255, 0.05)',
        200: 'rgba(255, 255, 255, 0.1)',
        300: 'rgba(255, 255, 255, 0.15)',
      },
      darken: {
        100: 'rgba(0, 0, 0, 0.05)',
        200: 'rgba(0, 0, 0, 0.1)',
        300: 'rgba(0, 0, 0, 0.15)',
      },
    },
  })
  .addColorModes('dark', {
    light: {
      text: 'navy-700',
      scrollbar: 'modifier-darken-200',
      background: {
        _: 'white',
        current: 'white',
        muted: 'modifier-darken-200',
        emphasized: 'modifier-darken-100',
      },
      primary: {
        _: 'purple-700',
        hover: 'purple-600',
      },
      secondary: {
        _: 'navy-800',
        hover: 'navy-700',
      },
      tertiary: {
        _: 'pink-700',
        hover: 'pink-600',
      },
      syntax: {
        background: 'navy-200',
        text: 'navy-800',
        imortant: 'blue-300',
        unit: 'neon-500',
        keyword: 'pink-800',
        value: 'orange-500',
        property: 'purple-600',
        number: 'purple-700',
      },
    },
    dark: {
      text: 'white',
      scrollbar: 'modifier-lighten-200',
      background: {
        _: 'navy-900',
        current: 'navy-900',
        muted: 'modifier-lighten-100',
        emphasized: 'modifier-lighten-200',
      },
      primary: {
        _: 'pink-600',
        hover: 'pink-500',
      },
      secondary: {
        _: 'white',
        hover: 'navy-300',
      },
      tertiary: {
        _: 'purple-700',
        hover: 'purple-600',
      },
      syntax: {
        background: 'navy-800',
        plain: 'white',
        imortant: 'blue-300',
        unit: 'neon-500',
        keyword: 'pink-500',
        value: 'yellow-300',
        property: 'green-400',
        number: 'purple-500',
      },
    },
  })
  .createScaleVariables('fonts')
  .createScaleVariables('fontSizes')
  .createScaleVariables('space')
  .build();

export type AnimusTheme = typeof theme;

declare module '@emotion/react' {
  export interface Theme extends AnimusTheme {}
}
