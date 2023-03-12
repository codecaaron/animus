const typescript = require('rollup-plugin-typescript2');
const babel = require('@rollup/plugin-babel');

module.exports = {
  input: `./src/index.ts`,
  output: [
    {
      file: './dist/index.mjs',
      format: 'es',
    },
    {
      file: './dist/index.js',
      format: 'cjs',
    },
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
  ],
};
