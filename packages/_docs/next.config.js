const path = require('path');

const withTM = require('next-transpile-modules')([
  '@animus-ui/core',
  '@animus-ui/theming',
  '@animus-ui/components',
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
        '@animus-ui/core$': path.resolve(__dirname, '../core/src'),
        '@animus-ui/theming$': path.resolve(__dirname, '../theming/src'),
        '@animus-ui/components$': path.resolve(__dirname, '../ui/src'),
      },
    },
  }
);
