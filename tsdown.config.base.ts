import { defineConfig, type UserConfig } from 'tsdown';

// Sourcemaps stay opt-in: published artifacts ship without them, and only
// the e2e coverage lane needs dist/-to-src/ remapping.
export const createConfig = (overrides?: Partial<UserConfig>) =>
  defineConfig({
    entry: ['./src/index.ts'],
    format: ['esm'],
    dts: false,
    clean: true,
    outDir: 'dist',
    target: 'es2022',
    platform: 'neutral',
    sourcemap: process.env.ANIMUS_BUILD_SOURCEMAP === '1',
    ...overrides,
  });
