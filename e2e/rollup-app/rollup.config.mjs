// Named import: the host ships CJS for both conditions, so a Node-ESM default
// import would bind the exports object instead of the plugin.
import { animusRollup as animus } from '@animus-ui/unplugin/rollup';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'rollup-plugin-esbuild';

const lane = dirname(fileURLToPath(import.meta.url));

export default {
  input: resolve(lane, 'src/entry.tsx'),
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [
    // The host runs first: its transform must see raw TSX, and rollup has no
    // enforce ordering — plugin order in this array is the order.
    animus({
      root: lane,
      system: './src/ds.ts',
      strict: true,
      // Byte parity with `animus build`: mode and exclusions must match the
      // CLI step's.
      mode: 'production',
      exclude: ['fixtures/**'],
    }),
    esbuild({ jsx: 'automatic', target: 'es2022' }),
    nodeResolve({ extensions: ['.mjs', '.js', '.ts', '.tsx'] }),
    commonjs(),
  ],
  // dir output: the host emits the stylesheet asset alongside the bundle.
  output: {
    dir: resolve(lane, 'dist'),
    entryFileNames: 'bundle.mjs',
    format: 'esm',
  },
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
};
