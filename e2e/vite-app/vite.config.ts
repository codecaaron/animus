import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    react(),
    animusExtract({
      system: './src/ds.ts',
      verify: true,
      // Engine selectable per-build so the v2 flip-precondition proof
      // (extract-v2-spine row 13) runs against this fixture unchanged:
      //   ANIMUS_ENGINE=v2 vp run verify:vite
      engine: process.env.ANIMUS_ENGINE === 'v2' ? 'v2' : 'v1',
    }),
  ],
});
