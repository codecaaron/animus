# @animus-ui/next-plugin

Static CSS extraction for Next.js. Wraps `next.config` to integrate the Animus extraction pipeline via webpack.

## Install

```bash
npm install @animus-ui/next-plugin @animus-ui/system
```

## Setup

```tsx
// next.config.mjs
import { withAnimus } from '@animus-ui/next-plugin';

const nextConfig = {
  // your existing Next.js config
};

export default withAnimus({
  system: './src/ds.ts',
})(nextConfig);
```

## What It Does

- Adds a webpack loader that transforms `@animus-ui/system` builder chains into static CSS
- Emits extracted CSS as a separate asset with `@layer` ordering
- Works with both App Router and Pages Router
- Supports RSC — no runtime style injection means server components work out of the box

## License

MIT
