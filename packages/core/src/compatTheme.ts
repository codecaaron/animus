export const compatTheme = {
  breakpoints: {
    xs: 480,
    sm: 768,
    md: 1024,
    lg: 1200,
    xl: 1440,
  },
  spacing: [0, 4, 8, 12, 16, 24, 32, 40, 48, 64, 96],
  fontSize: [64, 44, 34, 26, 22, 20, 18, 16, 14],
  lineHeight: [1, 1.625, 2],
  fontWeight: [400, 600, 700],
  fontFamily: {
    body: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif',
    heading:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif',
    monospace: 'Menlo,monospace',
  },
  radii: [2, 4, 6, 8],
  borders: [1, 2, 3],
  colors: {},
  modes: {},
  mode: undefined,
} as const;

export type CompatTheme = typeof compatTheme;
