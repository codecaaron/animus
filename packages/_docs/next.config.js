const withTM = require('next-transpile-modules')([
  '@animus-ui/core',
  '@animus-ui/theming',
  '@animus-ui/components',
]);

const withPlugins = require('next-compose-plugins');
const withMDX = require('@next/mdx')({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
  options: {
    providerImportSource: '@mdx-js/react',
  },
});

module.exports = withPlugins(
  [
    withMDX({
      pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
    }),
    withTM,
  ],
  {}
);
