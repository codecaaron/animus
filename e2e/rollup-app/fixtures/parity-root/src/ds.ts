// Watch/build parity fixture system. Two things here are load-bearing for
// scripts/assert-watch-build-parity.mjs:
//   1. `asset('./assets/brand.woff2')` resolves INSIDE the fixture root, so
//      the parity check can rewrite the asset's bytes mid-watch and produce
//      a superseded content-hashed copy in the session's assets directory.
//   2. The system registers global styles, so that copy is referenced from
//      the emitted stylesheet and published beside it.
import { asset, createSystem, createTheme } from '@animus-ui/system';

export const theme = createTheme()
  .addColors({ gray: { 100: '#f5f5f5', 700: '#404040' } })
  .build();

const bundle = createSystem().build(theme);

export const globalStyles = bundle.createGlobalStyles(
  { body: { margin: 0 } },
  {
    fontFaces: [
      {
        family: 'AnimusParityFont',
        src: [
          {
            url: asset('./assets/brand.woff2'),
            format: 'woff2',
          },
        ],
        display: 'swap',
      },
    ],
  }
);

export const ds = bundle.registerGlobalStyles({ globalStyles }).seal();
