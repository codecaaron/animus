/**
 * Minimal test configurations for snapshot testing
 * Using small scales to reduce snapshot noise while maintaining behavior coverage
 */

// Minimal space scale for testing
export const minimalSpace = {
  m: { property: 'margin', scale: 'space' },
  mx: {
    property: 'margin',
    properties: ['marginLeft', 'marginRight'],
    scale: 'space',
  },
  my: {
    property: 'margin',
    properties: ['marginTop', 'marginBottom'],
    scale: 'space',
  },
  p: { property: 'padding', scale: 'space' },
  px: {
    property: 'padding',
    properties: ['paddingLeft', 'paddingRight'],
    scale: 'space',
  },
  py: {
    property: 'padding',
    properties: ['paddingTop', 'paddingBottom'],
    scale: 'space',
  },
} as const;

// Minimal color scale for testing
export const minimalColor = {
  color: { property: 'color', scale: 'colors' },
  bg: { property: 'backgroundColor', scale: 'colors' },
} as const;

// Minimal typography for testing
export const minimalTypography = {
  fontSize: { property: 'fontSize', scale: 'fontSizes' },
  fontWeight: { property: 'fontWeight', scale: 'fontWeights' },
} as const;

// Test theme with minimal scales
export const testTheme = {
  space: {
    0: 0,
    1: '4px',
    2: '8px',
    3: '16px',
  },
  colors: {
    primary: '#007bff',
    white: '#ffffff',
    black: '#000000',
  },
  fontSizes: {
    sm: '14px',
    md: '16px',
    lg: '20px',
  },
  fontWeights: {
    normal: 400,
    bold: 700,
  },
} as const;

// Group definitions for testing
export const groupDefinitions = {
  space: minimalSpace,
  color: minimalColor,
  typography: minimalTypography,
} as const;
