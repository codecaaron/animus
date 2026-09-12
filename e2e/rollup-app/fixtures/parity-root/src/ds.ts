// The asset must resolve inside this fixture root and global styles must stay
// registered: the parity check rewrites the font bytes mid-watch.
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
