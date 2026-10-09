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

// The JavaScript build, then a declaration-only build of the same entries.
// Bundled declarations import each other with explicit `.js` specifiers, so
// they resolve under NodeNext. The second build is separate because the
// declaration plugin turns on source maps for every chunk it emits, and the
// JavaScript ships without them.
export const createConfigWithDeclarations = (
  overrides?: Partial<UserConfig>
) => [
  createConfig(overrides),
  createConfig({
    ...overrides,
    clean: false,
    dts: { emitDtsOnly: true, tsconfig: 'tsconfig.build.json' },
  }),
];
