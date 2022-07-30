const withTM = require('next-transpile-modules')([
  '@animus-ui/core',
  '@animus-ui/theming',
  '@animus-ui/components',
]);

const withMDX = require('@next/mdx')({
  options: { providerImportSource: '@mdx-js/react' },
  extension: /\.(md|mdx)$/,
});
module.exports = withMDX({
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
});
