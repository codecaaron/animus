import { createTheme } from '@animus-ui/system';

/**
 * Reference theme for test-ds components.
 *
 * Documents the token vocabulary that test-ds components depend on.
 * Consumers must include these tokens (or equivalent) in their own theme.
 * This theme is NOT loaded by the consumer's plugin — it exists for
 * documentation, type reference, and future unpack() composition.
 */
export const referenceTokens = createTheme({
  breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 },
})
  .addColors({
    gray: {
      50: '#fafafa',
      100: '#f5f5f5',
      200: '#e5e5e5',
      300: '#d4d4d4',
      500: '#737373',
      700: '#404040',
      800: '#262626',
      900: '#171717',
    },
    blue: { 500: '#3b82f6', 700: '#1d4ed8' },
    red: { 500: '#ef4444', 700: '#b91c1c' },
    green: { 500: '#22c55e', 700: '#15803d' },
    amber: { 500: '#f59e0b' },
  })
  .addColorModes('dark', {
    dark: {
      primary: { _: 'blue-500', hover: 'blue-700' },
      secondary: 'green-500',
      neutral: { _: 'gray-200', subtle: 'gray-500' },
      danger: { _: 'red-500', hover: 'red-700' },
      background: 'gray-900',
      surface: { _: 'gray-800', hover: 'gray-700' },
      text: { _: 'gray-100', muted: 'gray-500' },
    },
    light: {
      primary: { _: 'blue-700', hover: 'blue-500' },
      secondary: 'green-700',
      neutral: { _: 'gray-700', subtle: 'gray-300' },
      danger: { _: 'red-700', hover: 'red-500' },
      background: 'gray-50',
      surface: { _: 'gray-100', hover: 'gray-200' },
      text: { _: 'gray-900', muted: 'gray-500' },
    },
  })
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
