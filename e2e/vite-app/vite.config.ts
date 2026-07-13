import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    animusExtract({
      system: './src/ds.ts',
      verify: true,
      // Escape hatch (extract-v2-default-flip): ANIMUS_ENGINE=v1 vp run verify:vite
      engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
    }),
  ],
});
