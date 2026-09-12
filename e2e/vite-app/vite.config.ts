import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';
import { animusExtract } from '@animus-ui/vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { theme } from './src/ds';

// Config-time only: nothing under `src/` may import
// `@animus-ui/system/bootstrap` — its snippet must not reach a client bundle.
const appearanceBootstrap = createAppearanceBootstrap(theme);

export default defineConfig({
  plugins: [
    react(),
    animusExtract({
      system: './src/ds.ts',
      appearanceBootstrap,
      verify: true,
      strict: true,
    }),
    cloudflare(),
  ],
});
