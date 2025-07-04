# @animus-ui/nextjs-plugin

Next.js plugin for Animus static CSS extraction using a two-phase architecture that generates optimized CSS at build time while preserving the full Animus runtime API during development.

## Installation

```bash
npm install @animus-ui/nextjs-plugin
```

## Usage

```js
// next.config.js
const { withAnimus } = require('@animus-ui/nextjs-plugin');

module.exports = withAnimus({
  theme: './src/theme.ts',
  output: 'animus.css',
  themeMode: 'hybrid',
  atomic: true
})();
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `theme` | `string \| object` | - | Path to theme file or theme object |
| `output` | `string` | `'animus.css'` | Output CSS filename |
| `themeMode` | `'inline' \| 'css-variable' \| 'hybrid'` | `'hybrid'` | Theme token resolution mode |
| `atomic` | `boolean` | `true` | Enable atomic CSS generation |
| `cacheDir` | `string` | `.next/cache` | Cache directory path |
| `verbose` | `boolean` | `false` | Enable verbose logging |
| `shimImportPath` | `string` | `'@animus-ui/core/runtime'` | Runtime shim import path |
| `preserveDevExperience` | `boolean` | `true` | Keep runtime behavior in development |

## How It Works

The plugin uses a two-phase architecture:

### Phase 1: TypeScript Transformer
- Runs during Next.js TypeScript compilation
- Analyzes entire codebase to build component registry
- Tracks component relationships and inheritance
- Generates cascade ordering via topological sort
- Caches metadata for Phase 2

### Phase 2: Webpack Loader
- Transforms individual modules during bundling
- Consumes cached metadata from Phase 1
- Injects runtime shims with stable identifiers
- Preserves source maps and type information

### CSS Generation
- Webpack plugin emits optimized CSS
- Preserves cascade ordering across code splits
- Generates component metadata JSON
- Supports both App Router and Pages Router

## Import the Generated CSS

### App Router

```tsx
// app/layout.tsx
import './animus.css';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### Pages Router

```tsx
// pages/_app.tsx
import '../styles/animus.css';
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
```

## Advanced Usage

### With Existing Config

```js
const { withAnimus } = require('@animus-ui/nextjs-plugin');

const nextConfig = {
  reactStrictMode: true,
  // your other config...
};

module.exports = withAnimus({
  theme: './src/theme.ts'
})(nextConfig);
```

### Manual Configuration

For advanced use cases, you can configure the transformer and loader separately:

```js
const { createAnimusTransformer } = require('@animus-ui/nextjs-plugin');

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
          loader: require.resolve('@animus-ui/nextjs-plugin/dist/webpack-loader'),
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
```

## Troubleshooting

### Cache Issues

If you encounter stale styles, clear the cache:

```js
const { clearAnimusCache } = require('@animus-ui/nextjs-plugin');
clearAnimusCache();
```

### TypeScript Errors

Ensure your `tsconfig.json` includes the Animus types:

```json
{
  "compilerOptions": {
    "types": ["@animus-ui/core"]
  }
}
```

## Performance

- **Build Time**: First build analyzes entire codebase, subsequent builds use incremental compilation
- **Runtime**: Zero runtime overhead in production with static CSS
- **Bundle Size**: Removes Animus runtime code through tree-shaking
- **CSS Size**: Atomic CSS generation eliminates duplicate styles

## Compatibility

- Next.js 13+ (App Router and Pages Router)
- TypeScript 4.5+
- React 18+
- Node.js 16+