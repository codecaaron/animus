import { animusExtract } from '@animus-ui/vite-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

const isSsr = process.env.ANIMUS_SSR === 'true';

export default defineConfig({
  plugins: [
    svelte(),
    animusExtract({
      system: './src/ds.ts',
      runtimeImport: '@animus-ui/system/class-resolver',
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mdx', '.svelte'],
      strict: true,
      verify: true,
    }),
  ],
  build: isSsr
    ? {
        ssr: './src/ssr.ts',
        outDir: './dist/server',
        rollupOptions: {
          output: {
            entryFileNames: 'ssr.js',
          },
        },
      }
    : {
        outDir: './dist/client',
      },
});
