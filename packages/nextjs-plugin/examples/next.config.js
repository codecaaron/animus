/**
 * Example Next.js configuration with Animus static extraction
 */

const { withAnimus } = require('@animus-ui/core/static/plugins/next-js');

// Basic usage
module.exports = withAnimus({
  theme: './src/theme.ts',
  output: 'animus.css',
  themeMode: 'hybrid',
  atomic: true,
  verbose: true
})();

// With existing Next.js config
/*
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['example.com'],
  },
  experimental: {
    appDir: true,
  }
};

module.exports = withAnimus({
  theme: './src/theme.ts',
  output: 'animus.css'
})(nextConfig);
*/

// Advanced configuration
/*
module.exports = withAnimus({
  // Theme can be a path or object
  theme: {
    colors: {
      primary: '#007bff',
      secondary: '#6c757d'
    },
    space: {
      1: '0.25rem',
      2: '0.5rem',
      3: '0.75rem',
      4: '1rem'
    }
  },
  
  // CSS output configuration
  output: 'styles/animus.css',
  themeMode: 'css-variable', // Use CSS variables for all theme tokens
  atomic: true, // Generate atomic utilities
  
  // Build configuration
  cacheDir: '.next/cache/animus',
  verbose: process.env.NODE_ENV === 'development',
  
  // Runtime configuration
  shimImportPath: '@animus-ui/core/runtime',
  preserveDevExperience: true // Keep runtime in dev for hot reloading
})();
*/

// Manual configuration (for advanced use cases)
/*
const { createAnimusTransformer } = require('@animus-ui/core/static/plugins/next-js');

module.exports = {
  typescript: {
    customTransformers: {
      before: [
        createAnimusTransformer({
          rootDir: process.cwd(),
          theme: require('./src/theme'),
          verbose: true
        })
      ]
    }
  },
  
  webpack: (config, { dev, isServer }) => {
    config.module.rules.unshift({
      test: /\.(tsx?|jsx?)$/,
      exclude: /node_modules/,
      enforce: 'pre',
      use: [
        {
          loader: require.resolve('@animus-ui/core/static/plugins/next-js/webpack-loader'),
          options: {
            preserveDevExperience: dev,
            verbose: true
          }
        }
      ]
    });
    
    return config;
  }
};
*/