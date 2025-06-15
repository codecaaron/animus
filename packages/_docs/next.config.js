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

module.exports = withMDX({
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
  transpilePackages: [
    '@syzygos/core',
    '@syzygos/theming',
    '@syzygos/components',
  ],
});
