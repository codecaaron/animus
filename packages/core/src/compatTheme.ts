import { numericOrStringScale } from './scales/createScale';

export const compatTheme = {
  breakpoints: {
    xs: 480,
    sm: 768,
    md: 1024,
    lg: 1200,
    xl: 1440,
  },
  space: [0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64, 96],
  fontSizes: [64, 44, 34, 26, 22, 20, 18, 16, 14],
  lineHeights: numericOrStringScale,
  letterSpacings: {},
  fontWeights: numericOrStringScale,
  fonts: {},
  radii: numericOrStringScale,
  borders: numericOrStringScale,
  borderWidths: numericOrStringScale,
  colors: {},
  gradients: {},
  shadows: {},
  modes: {},
  transitions: {},
  animations: {},
  zIndices: {},
  opacities: {},
  mode: undefined,
} as const;

export type CompatTheme = typeof compatTheme;
