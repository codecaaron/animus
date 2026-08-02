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

## Appearance bootstrap (no-FOUC color mode)

Optional. Restores a persisted color mode before first paint with zero runtime
— a generated, dependency-free inline snippet whose CSP hash is computed at
build time from the exact bytes generated.

The plugin deliberately injects nothing: CSP nonces need request-time control
the bundler does not have, so the **application** places the artifact. Generate
it in a server-only module and inline it as the first child of `<head>`.

**App Router:**

```tsx
// appearance-bootstrap.ts — server-only; never import from a client component
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';

import { tokens } from './src/ds';

export const appearanceBootstrap = createAppearanceBootstrap(tokens);
```

```tsx
// app/layout.tsx
import { appearanceBootstrap } from '../appearance-bootstrap';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          data-animus-bootstrap=""
          dangerouslySetInnerHTML={{ __html: appearanceBootstrap.code }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

**Pages Router:** same artifact, placed as the first child of `<Head>` in
`pages/_document.tsx`, with `suppressHydrationWarning` on `<Html>`.

Two rules either way:

- `suppressHydrationWarning` on the root element is required, not cosmetic —
  the snippet legitimately mutates `data-color-mode` between SSR and hydration.
- Serve a CSP that authorizes the script from the artifact itself: either
  `script-src '<artifact.cspHash>'` (single-quoted, derived at build time —
  never hand-copied; a renamed mode changes the hash) or a per-request nonce
  you add to the script tag. The full CSP footguns are documented in the
  [`@animus-ui/vite-plugin` README](https://github.com/codecaaron/animus/tree/main/packages/vite-plugin#content-security-policy).

## What It Does

- Transforms `@animus-ui/system` builder chains into static CSS (webpack loader or Turbopack loader rule)
- Emits extracted CSS as a separate asset with `@layer` ordering
- Post-processes the emitted sheet with Lightning CSS — autoprefixed for your `targets` (browserslist query; defaults to the project config), minified in production (`minify` overrides)
- Works with both App Router and Pages Router
- Supports RSC — no runtime style injection means server components work out of the box

## License

MIT
