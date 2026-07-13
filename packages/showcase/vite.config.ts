import { animusExtract } from '@animus-ui/vite-plugin';
import mdx from '@mdx-js/rollup';
import react from '@vitejs/plugin-react';
import remarkGfm from 'remark-gfm';
import { defineConfig } from 'vite';

export default defineConfig({
  preview: {
    allowedHosts: ['inhabited-stumpy-luanna.ngrok-free.dev'],
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames(info) {
          if (
            info.names?.[0]?.endsWith('.css') ||
            info.name?.endsWith('.css')
          ) {
            return 'assets/styles-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    {
      enforce: 'pre',
      ...mdx({
        remarkPlugins: [remarkGfm],
        providerImportSource: '@mdx-js/react',
      }),
    },
    react({ include: /\.(mdx|js|jsx|ts|tsx)$/ }),
    animusExtract({
      system: './src/ds.ts',
      // Engine selectable per-build (extract-v2-spine row 13):
      //   ANIMUS_ENGINE=v2 vp run verify:showcase
      engine: process.env.ANIMUS_ENGINE === 'v2' ? 'v2' : 'v1',
      layers: [
        'reset',
        'anm-global',
        'anm-base',
        'anm-variants',
        'anm-compounds',
        'anm-states',
        'anm-system',
        'anm-custom',
        'overrides',
      ],
    }),
  ],
});
