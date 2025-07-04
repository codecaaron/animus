const typescript = require('rollup-plugin-typescript2');
const babel = require('@rollup/plugin-babel');
const json = require('@rollup/plugin-json');
const { nodeResolve } = require('@rollup/plugin-node-resolve');
const commonjs = require('@rollup/plugin-commonjs');

const sharedPlugins = [
  typescript({
    typescript: require('typescript'),
  }),
  babel({
    extensions: ['tsx', 'ts'],
    exclude: './node_modules/**',
    babelHelpers: 'bundled',
  }),
  json(),
];

// Main library build
const libConfig = {
  input: './src/index.ts',
  output: [
    {
      file: './dist/index.js',
      format: 'es',
    },
  ],
  external: [/node_modules/],
  plugins: sharedPlugins,
};

// Static extraction module build
const staticConfig = {
  input: './src/static/index.ts',
  output: [
    {
      file: './dist/static/index.js',
      format: 'es',
    },
  ],
  external: [
    // External all dependencies
    /node_modules/,
    'fs',
    'path',
    'child_process',
    'util',
    'os',
    'crypto',
    'stream',
    'events',
    'typescript',
    '@babel/core',
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    'vite',
  ],
  plugins: sharedPlugins,
};

// CLI build - needs different handling
const cliConfig = {
  input: './src/static/cli/index.ts',
  output: [
    {
      file: './dist/static/cli/index.js',
      format: 'cjs',
      banner: '#!/usr/bin/env node',
    },
  ],
  external: [
    // Only external the peer dependencies and Node built-ins
    /node_modules/,
    'fs',
    'path',
    'child_process',
    'util',
    'os',
    'crypto',
    'stream',
    'events',
    'typescript',
    '@babel/core',
    '@babel/parser',
    '@babel/traverse',
    '@babel/types',
    'lodash',
    '@emotion/react',
    '@emotion/styled',
    '@emotion/is-prop-valid',
  ],
  plugins: [
    nodeResolve({
      preferBuiltins: true,
    }),
    commonjs({
      transformMixedEsModules: true,
    }),
    ...sharedPlugins,
  ],
};


// Runtime-only build for transformed components
const runtimeConfig = {
  input: './src/static/runtime-only.ts',
  output: [
    {
      file: './dist/runtime.js',
      format: 'es',
    },
  ],
  external: [
    // Only external React and emotion dependencies
    /node_modules/,
    'react',
    '@emotion/is-prop-valid',
  ],
  plugins: sharedPlugins,
};

module.exports = [libConfig, staticConfig, cliConfig, runtimeConfig];
