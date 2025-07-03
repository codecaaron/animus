/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@animus-ui/core'],
  eslint: {
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig
