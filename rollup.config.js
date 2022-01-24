import typescript from 'rollup-plugin-typescript2';
import babel from '@rollup/plugin-babel';

const config = () => {
  const { main, dependencies } = require(`${__dirname}/package.json`);
  return {
    input: `${__dirname}/src/index.ts`,
    output: [
      {
        file: main,
        format: 'es',
      },
    ],
    external: [...Object.keys(dependencies || {})],
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
};
export default config;
