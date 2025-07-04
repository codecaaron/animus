# Next.js Plugin for Animus Static Extraction

A two-phase static extraction plugin for Next.js that generates optimized CSS at build time while preserving the full Animus runtime API during development.

## Installation

```bash
npm install @animus-ui/core
```

## Usage

### Basic Setup

```js
// next.config.js
const { withAnimus } = require('@animus-ui/core/static/plugins/next-js');

module.exports = withAnimus({
  theme: './src/theme.ts',
  output: 'animus.css',
  themeMode: 'hybrid',
  atomic: true
})();
```

### With Existing Config

```js
// next.config.js
const { withAnimus } = require('@animus-ui/core/static/plugins/next-js');

const nextConfig = {
  reactStrictMode: true,
  // your other config...
};

module.exports = withAnimus({
  theme: './src/theme.ts'
})(nextConfig);
```

### Advanced Configuration

```js
// next.config.js
const { withAnimus } = require('@animus-ui/core/static/plugins/next-js');

module.exports = withAnimus({
  // Theme configuration
  theme: './src/theme.ts', // or pass theme object directly
  
  // Output file name (relative to .next/static/css/)
  output: 'animus.css',
  
  // Theme resolution mode
  themeMode: 'hybrid', // 'inline' | 'css-variable' | 'hybrid'
  
  // Enable atomic CSS generation
  atomic: true,
  
  // Custom cache directory
  cacheDir: '.next/cache/animus',
  
  // Enable verbose logging
  verbose: true,
  
  // Custom runtime shim import path
  shimImportPath: '@animus-ui/core/runtime',
  
  // Preserve dev experience (keeps runtime in development)
  preserveDevExperience: true
})();
```

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

## TypeScript Support

The plugin is written in TypeScript and provides full type definitions:

```ts
import type { AnimusNextPluginOptions } from '@animus-ui/core/static/plugins/next-js';

const animusConfig: AnimusNextPluginOptions = {
  theme: './src/theme.ts',
  themeMode: 'hybrid',
  atomic: true
};
```

## Troubleshooting

### Cache Issues

If you encounter stale styles, clear the cache:

```js
const { clearAnimusCache } = require('@animus-ui/core/static/plugins/next-js');
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

### Development Mode

The plugin preserves full runtime behavior in development by default. To test production optimizations in development:

```js
module.exports = withAnimus({
  preserveDevExperience: false
})();
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

## Future Enhancements

- Turbopack support (when stable)
- CSS modules integration
- Critical CSS extraction
- Build-time variant optimization