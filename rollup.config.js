import typescript from 'rollup-plugin-typescript2';
import { terser } from 'rollup-plugin-terser';

const config = () => {
  const { module, main, dependencies } = require(`${__dirname}/package.json`);
  return {
    input: `${__dirname}/src/index.ts`,
    output: [
      {
        file: main,
        format: 'cjs',
      },
      {
        file: module,
        format: 'es',
      },
    ],
    external: [...Object.keys(dependencies || {})],
    plugins: [
      typescript({
        typescript: require('typescript'),
      }),
      terser(), // minifies generated bundles
    ],
  };
};
export default config;
