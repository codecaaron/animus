import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Built on its own: the app's main build excludes this directory.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  plugins: [
    react(),
    animusExtract({
      system: './ds.ts',
      prefix: 'acme',
      prefixContextualVars: true,
      strict: true,
    }),
  ],
});
