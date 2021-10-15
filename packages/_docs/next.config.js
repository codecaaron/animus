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

module.exports = withPlugins([
  withMDX({
    pageExtensions: ['tsx', 'mdx'],
  }),
  withTM,
]);
