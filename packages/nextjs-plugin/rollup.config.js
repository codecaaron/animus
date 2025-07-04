const typescript = require('rollup-plugin-typescript2');
const babel = require('@rollup/plugin-babel');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');

const sharedConfig = {
  external: [
    /node_modules/,
    '@animus-ui/core',
    '@animus-ui/core/static',
    'fs',
    'path',
    'typescript',
    'next',
    'webpack',
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

module.exports = [
  {
    ...sharedConfig,
    input: './src/index.ts',
    output: [
      {
        file: './dist/index.js',
        format: 'cjs',
      },
      {
        file: './dist/index.mjs',
        format: 'es',
      },
    ],
  },
  {
    ...sharedConfig,
    input: './src/webpack-loader.ts',
    output: [
      {
        file: './dist/webpack-loader.js',
        format: 'cjs',
      },
    ],
  },
];
