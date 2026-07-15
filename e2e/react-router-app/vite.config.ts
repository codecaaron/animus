import { animusExtract } from '@animus-ui/vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    animusExtract({
      system: './src/ds.ts',
      verify: true,
      strict: true,
      engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
    }),
    reactRouter(),
  ],
});
