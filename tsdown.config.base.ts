import { defineConfig, type UserConfig } from 'tsdown';

// ANIMUS_BUILD_SOURCEMAP=1 is set only by scripts/verify/coverage-e2e.sh so
// V8 coverage collected from consumer builds can remap dist/ back to src/;
// published artifacts are always built without it.
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
