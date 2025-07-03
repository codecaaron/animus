import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { animusNext } from '../core/src/static/plugins/vite-next';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    animusNext({
      theme: './src/theme.ts',
      output: 'animus.css',
      atomic: true,
      useTypeScriptExtractor: true,
    }),
  ],
});
