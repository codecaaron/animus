const typescript = require('rollup-plugin-typescript2');
const babel = require('@rollup/plugin-babel');

module.exports = () => ({
  input: `./src/index.ts`,
  output: [
    {
      file: './dist/index.js',
      format: 'es',
    },
  ],
  external: [/node_modules/],
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
});
