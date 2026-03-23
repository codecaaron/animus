import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  preview: {
    allowedHosts: ['inhabited-stumpy-luanna.ngrok-free.dev'],
  },
  plugins: [
    react(),
    animusExtract({
      configPath: './src/custom-vocabulary.tsx',
    }),
  ],
});
