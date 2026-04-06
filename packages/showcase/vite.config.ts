import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  preview: {
    allowedHosts: ['inhabited-stumpy-luanna.ngrok-free.dev'],
  },
  build: {
    rollupOptions: {
      output: {
        assetFileNames(info) {
          if (info.names?.[0]?.endsWith('.css') || info.name?.endsWith('.css')) {
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
    react(),
    animusExtract({
      system: './src/ds.ts',
    }),
  ],
});
