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
  experimental: {
    fontLoaders: [
      { loader: 'next/font/google', options: { subsets: ['latin'] } },
    ],
  },
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'md', 'mdx'],
  transpilePackages: [
    '@animus-ui/core',
    '@animus-ui/theming',
    '@animus-ui/components',
  ],
});
