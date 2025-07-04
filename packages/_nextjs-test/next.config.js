const { withAnimus } = require('@animus-ui/nextjs-plugin');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@animus-ui/core'],
  eslint: {
    ignoreDuringBuilds: true,
  },
}

// Apply Animus plugin with configuration
module.exports = withAnimus({
  theme: './theme.js', // You'll need to create this
  output: 'animus.css',
  themeMode: 'hybrid',
  atomic: true,
  verbose: true,
})(nextConfig);