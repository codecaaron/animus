const path = require('path');

const withTM = require('next-transpile-modules')([
  '@animus/core',
  '@animus/theming',
  '@animus/ui',
]);

const withPlugins = require('next-compose-plugins');
const withMDX = require('@next/mdx')();

module.exports = withPlugins(
  [
    withMDX({
      pageExtensions: ['tsx', 'mdx'],
    }),
    withTM,
  ],
  {
    resolve: {
      alias: {
        '@animus/core$': path.resolve(__dirname, '../core/src'),
        '@animus/theming$': path.resolve(__dirname, '../theming/src'),
        '@animus/ui$': path.resolve(__dirname, '../ui/src'),
      },
    },
  }
);
