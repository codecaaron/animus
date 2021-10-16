const path = require('path');

const withTM = require('next-transpile-modules')([
  '@animus/core',
  '@animus/theme',
  '@animus/theming',
  '@animus/ui',
  '@animus/provider',
  '@animus/elements',
  '@animus/props',
  '@animus/transforms',
]); // As per comment.
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
        '@animus/theme$': path.resolve(__dirname, '../theme/src'),
        '@animus/theming$': path.resolve(__dirname, '../theming/src'),
        '@animus/ui$': path.resolve(__dirname, '../ui/src'),
        '@animus/provider$': path.resolve(__dirname, '../provider/src'),
        '@animus/elements$': path.resolve(__dirname, '../elements/src'),
        '@animus/props$': path.resolve(__dirname, '../props/src'),
        '@animus/transforms$': path.resolve(__dirname, '../transforms/src'),
      },
    },
  }
);
