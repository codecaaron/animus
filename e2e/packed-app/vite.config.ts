import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    animusExtract({
      system: './src/ds.ts',
      verify: true,
      strict: true,
      // No `engine` key: the packed consumer exercises the shipped default.
    }),
  ],
});
