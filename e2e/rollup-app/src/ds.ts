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
  // System participation (openspec: system-color-scheme). App-LOCAL theme,
  // shared with nothing — the parity harness builds
  // `packages/extract/tests/test-system.ts`, not this module.
  //
  // This lane is the STANDALONE (CLI + unplugin host) delivery witness.
  // The token surface deliberately mirrors e2e/vite-app/src/ds.ts so the
  // standalone drivers extract over the same vocabulary the Vite lane
  // pins; a divergence here is a deliberate lane decision, not drift.
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
      // Empty on purpose — this lane is the end-to-end witness for the D3
      // amendment: both modes are mapping-named, so their classifications
      // default to light/dark and the emission must be identical to spelling
      // them out (the assert lane pins color-scheme on :root, both mode
      // blocks, and both guarded blocks). next-app keeps explicit entries, so
      // both spellings stay covered.
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

export const {
  system: ds,
  createGlobalStyles,
  createKeyframes,
  // extend()-form witness (openspec: first-class-extension, D1/NS-1): this
  // lane consumes test-ds through the single extension verb — a REAL registry
  // merge. EVERY group here (space, layout, text, surface, positioning) and
  // the kit's condition aliases arrive through `.extend(testDs)` alone; the
  // app deliberately re-registers nothing, so the merged config IS the kit's
  // registry surface plus the local `_motionReduce` re-assertion below.
  // (Re-spreading kit groups locally would coalesce under D12 transform
  // equality — name + captured source — but pure extension is the
  // recommended consumption shape: the merge already provides them.)
  //
  // Box.tsx opts into the kit's `positioning` group and App.tsx uses
  // `top`/`zIndex`, making the emitted CSS the end-to-end witness that a
  // kit-registered prop flows through the MERGED config into extraction
  // output (rust-system-loader › "Merged configuration is the extraction
  // authority"). The legacy lanes stay deliberate elsewhere: next-app keeps
  // the deprecated `includes:` alias, react-router-app keeps the deprecated
  // `from()` chain (G6).
} = createSystem()
  .extend(testDs)
  // Condition alias registry (modern-css-surface inc 03). The kit already
  // carries `_motionReduce`; this local registration re-asserts it with an
  // identical value (post-extend app calls override silently, NS-4) so the
  // manifest `conditionAliases` plugin glue keeps a local witness here.
  .addConditions({
    _motionReduce: '@media (prefers-reduced-motion: reduce)',
  })
  .build();

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
    // asset() witness (standardize-inheritance-and-assets): a package-owned
    // font resolves through the host bundler — the assert lane pins the
    // hashed URL in the delivered CSS and the emitted file in dist/.
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
