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
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: './node_modules/**',
      }),
    ],
  };
};
export default config;
