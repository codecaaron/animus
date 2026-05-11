import { defineConfig, type UserConfig } from 'tsdown';

export const createConfig = (overrides?: Partial<UserConfig>) =>
  defineConfig({
    entry: ['./src/index.ts'],
    format: ['esm'],
    dts: false,
    clean: true,
    outDir: 'dist',
    target: 'es2022',
    platform: 'neutral',
    ...overrides,
  });
