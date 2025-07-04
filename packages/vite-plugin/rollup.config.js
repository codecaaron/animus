const typescript = require('rollup-plugin-typescript2');
const babel = require('@rollup/plugin-babel');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');

module.exports = {
  input: './src/index.ts',
  output: [
    {
      file: './dist/index.js',
      format: 'es',
    },
  ],
  external: [
    /node_modules/,
    '@animus-ui/core',
    '@animus-ui/core/static',
    'fs',
    'fs/promises',
    'path',
    'esbuild',
    'vite',
  ],
  plugins: [
    typescript({
      typescript: require('typescript'),
    }),
    babel({
      extensions: ['tsx', 'ts'],
      exclude: './node_modules/**',
      babelHelpers: 'bundled',
    }),
    nodeResolve(),
    commonjs(),
  ],
};
