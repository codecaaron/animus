import typescript from 'rollup-plugin-typescript2';
import { terser } from 'rollup-plugin-terser';
import babel from '@rollup/plugin-babel';

const config = () => {
  const {
    module: mod,
    main,
    dependencies,
  } = require(`${__dirname}/package.json`);
  return {
    input: `${__dirname}/src/index.ts`,
    output: [
      {
        file: mod,
        format: 'es',
      },
      {
        file: main,
        format: 'cjs',
      },
    ],
    external: [...Object.keys(dependencies || {})],
    plugins: [
      typescript({
        typescript: require('typescript'),
      }),
      terser(), // minifies generated bundles,
      babel({
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: './node_modules/**',
      }),
    ],
  };
};
export default config;
