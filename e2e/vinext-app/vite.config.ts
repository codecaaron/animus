import { animusExtract } from '@animus-ui/vite-plugin';
import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    vinext(),
    animusExtract({
      system: './src/ds.ts',
      verify: true,
      strict: true,
      engine: process.env.ANIMUS_ENGINE === 'v1' ? 'v1' : 'v2',
    }),
    cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    }),
  ],
});
