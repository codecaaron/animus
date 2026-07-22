# @animus-ui/next-plugin

Static CSS extraction for Next.js (15 and 16). Wraps `next.config` to integrate the Animus extraction pipeline — webpack and Turbopack.

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

## Turbopack

Turbopack support activates automatically whenever the process runs under
Turbopack (`next dev --turbopack`, or Next 16 where Turbopack is the
default) — no config change needed. Extraction runs while `next.config`
resolves, a watcher re-analyzes on source changes in dev, and per-file
transforms run in a stateless loader fed by generated `.animus/` artifacts.
tsconfig `paths` aliases are honored.

Control it explicitly with the `turbopack` option:

```tsx
export default withAnimus({
  system: './src/ds.ts',
  turbopack: { mode: 'auto' }, // 'auto' (default) | 'on' | 'off'
})(nextConfig);
```

Under webpack (`next dev` / `next build` on 15, or `--webpack` on 16) the
plugin behaves exactly as before.

## What It Does

- Transforms `@animus-ui/system` builder chains into static CSS (webpack loader or Turbopack loader rule)
- Emits extracted CSS as a separate asset with `@layer` ordering
- Post-processes the emitted sheet with Lightning CSS — autoprefixed for your `targets` (browserslist query; defaults to the project config), minified in production (`minify` overrides)
- Works with both App Router and Pages Router
- Supports RSC — no runtime style injection means server components work out of the box

## License

MIT
