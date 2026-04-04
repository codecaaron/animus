# Next.js & Remix

## Next.js

Use `@animus-ui/next-plugin` instead of the Vite plugin:

```bash
bun add @animus-ui/system @animus-ui/next-plugin
```

Because extraction produces a static CSS file (no runtime CSS-in-JS), this works with React Server Components and any deployment target without additional configuration.

## Remix

Remix uses Vite -- the same `@animus-ui/vite-plugin` works directly:

```bash
bun add @animus-ui/system @animus-ui/vite-plugin
```

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import { vitePlugin as remix } from '@remix-run/dev';
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [
    animusExtract({ system: './app/ds.ts' }),
    remix(),
  ],
});
```

## Going further

- [Vite Plugin](/docs/compiler/vite-plugin) -- full plugin configuration including layer customization and HMR
- [Getting Started](/docs/start) -- first component tutorial
