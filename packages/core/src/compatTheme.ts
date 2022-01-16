export const compatTheme = {
  spacing: [0, 4, 8, 12, 16, 24, 32, 40, 48, 64, 96],
  fontSize: [64, 44, 34, 26, 22, 20, 18, 16, 14],
  lineHeight: {
    body: 1.5,
    heading: 1,
  },
  fontWeight: [400, 600, 700],
  fontFamily: {
    body: 'Verdana, sans-serif',
    heading: 'Verdana, Lato, sans-serif',
    monospace: 'monospace',
  },
  radii: [2, 4, 6, 8],
  borders: [1, 2, 3],
  colors: {},
  mode: undefined,
} as const;

export type CompatTheme = typeof compatTheme;
