import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'rollup-plugin-esbuild';

export const lane = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Shared tail: the animus arm plugin goes FIRST (it must see raw TSX). */
export const sharedConfig = (animusPlugin, outFile) => ({
  input: resolve(lane, 'src/entry.tsx'),
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  plugins: [
    animusPlugin,
    replace({
      preventAssignment: true,
      values: {
        __ANIMUS_DEV__: 'false',
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    esbuild({ jsx: 'automatic', target: 'es2022' }),
    nodeResolve({ extensions: ['.mjs', '.js', '.ts', '.tsx'] }),
    commonjs(),
  ],
  output: { file: outFile, format: 'esm' },
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return;
    warn(warning);
  },
});
