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
default) — no config change needed. `withAnimus(...)(nextConfig)` then
returns a config function: Next calls it with its phase, and extraction runs
before it resolves. Only `next dev` analyzes in development mode and starts
a watcher that re-analyzes on source changes; `next build` prunes. Per-file
transforms run in a stateless loader fed by generated `.animus/` artifacts.
tsconfig `paths` aliases are honored.

Apply config wrappers that expect an object, such as `withMDX`, to
`nextConfig` before passing it to `withAnimus`:
`withAnimus(options)(withMDX(nextConfig))`. Applied outside, a wrapper that
copies the config into a new object keeps its own keys and drops Animus's.

If your config is a function of its own, pass Next's phase through:

```tsx
export default (phase: string) =>
  withAnimus({ system: './src/ds.ts', phase })(nextConfig);
```

The result can also be awaited, as in
`{ ...(await withAnimus(options)(nextConfig)) }`. Without a phase it then
reads `NODE_ENV=development` as `next dev` and anything else as a build. A
`next.config.ts` that assigns `module.exports = withAnimus(...)(...)` is
awaited the same way when Next compiles it, so write `export default`, or
pass the phase from a config function.

Because `next.config` resolves only after that first extraction, a source the
parser cannot finish at startup rejects the config before any watcher exists:
fix the syntax error and start Next again. Once the watcher runs, a later
syntax error keeps the last published artifacts and holds further edits until
the file parses, then publishes them together.

Control it explicitly with the `turbopack` option:

```tsx
export default withAnimus({
  system: './src/ds.ts',
  turbopack: { mode: 'auto' }, // 'auto' (default) | 'on' | 'off'
})(nextConfig);
```

Under webpack (`next dev` / `next build` on 15, or `--webpack` on 16) the
plugin behaves exactly as before.

## Third-party stylesheets

A library's plain CSS outside any `@layer` beats every Animus layer. With
`quarantine`, [`@animus-ui/layergate`](../layergate/README.md) loads it into
`anm-vendor`, a layer below all of Animus's, so Animus's styles win and the
library's still apply where Animus sets nothing:

```bash
npm install -D @animus-ui/layergate
```

```tsx
export default withAnimus({
  system: './src/ds.ts',
  quarantine: {
    sheets: ['react-grid-layout/css/styles.css'], // delivered ahead of Animus's own CSS
    dependencies: ['react-datepicker'], // CSS these packages' modules import
    optOut: [], // exact files whose own rules stay unlayered
  },
})(nextConfig);
```

It needs webpack: `next dev` and `next build` on Next 15, `--webpack` on
Next 16. Turbopack runs no loader on the stylesheets a stylesheet imports,
so with `quarantine` set any Turbopack run fails config loading, whatever
the `turbopack` option says. Next marks a Turbopack run by setting
`TURBOPACK`, so Animus refuses whenever that variable is set, even empty.
The converse: a `TURBOPACK` inherited from the environment also refuses a
webpack build of Next 15, loudly, so clear stale values in CI.

Vendor stylesheets layergate finishes are not kept in webpack's persistent
cache, so a warm rebuild finishes them again: about 118 ms per 200 vendor
sheets in a synthetic measurement.

`sheets` arrive at the head of Animus's own stylesheet, on every page.
`!important` declarations and animations still win, and are reported. App
CSS keeps its own rules unlayered; where it imports a vendor file, that file
is layered. CSS Modules are left alone. A remote `@import` in a vendor
stylesheet is an error: vendor the sheet locally, or opt the file out if
unlayered is acceptable.

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

import { theme } from './src/ds';

export const appearanceBootstrap = createAppearanceBootstrap(theme);
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

## Font preloads

A font face declared with `preload: true` can start loading before the
stylesheet's `@font-face` applies. The plugin injects nothing into the
document, so render the component that delivers it. It renders nothing when
no face preloads.

`fontPreloads` in `withAnimus`'s options selects the faces that preload in
place of their `preload` flags, for an app that renders only some of a
system's faces: a family name selects every face of the family, and
`{ family, weight?, style? }` the faces whose declared weight contains
`weight` and whose style is `style` (`'normal'` when omitted). An entry's
`fetchpriority` (`'high'`, `'low'` or `'auto'`) reaches the preloads of the
faces it selects. `[]` preloads none. An entry no face matches reports `animus.style.font-preload-unmatched`;
a malformed one, such as a weight range, `animus.style.font-preload-invalid`.

**App Router:** render `AnimusFontPreloads` in the root layout. React hoists
each preload into `<head>` ahead of the stylesheets, and dedupes it by href,
against `next/font` too.

```tsx
// app/layout.tsx
import { AnimusFontPreloads } from '@animus-ui/next-plugin/font-preloads';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AnimusFontPreloads />
        {children}
      </body>
    </html>
  );
}
```

**Pages Router:** render `AnimusFontPreloadLinks` inside `<Head>` in
`pages/_document.tsx`. It renders plain `<link>` tags, which any React
version renders.

Each preload names the URL the stylesheet's `url()` loads (the hashed
`/_next/static/media/…` file, under webpack and Turbopack, in build and in
development), so the browser fetches the file once. `withAnimus` adds this
package to `transpilePackages`, so Next bundles the component and resolves
the module it reads. Nothing detects a layout that never renders the
component: the faces then load when the stylesheet applies, as without
`preload`.

A preload competes with the critical CSS and JavaScript for first paint, so
preload WOFF2 and only the faces the first screen needs: a large TrueType
file can delay first paint by seconds on a slow link. A preloaded file that
is not WOFF2 or WOFF, or an `asset()` file over 150 KB, reports
`animus.style.font-face-preload-costly`.

## MDX

Animus reads each `.mdx` file as the JSX it renders: its imports, exports,
tags, props and `{expressions}`. It needs no MDX compiler. A component a tag
names, or one your provider maps markdown to (`# x` → your heading), counts
as rendered. Markdown and code examples render nothing.

MDX renders components; it declares no styles. Animus reports any reference
to its builder in an `.mdx` file as `SOURCE_MDX_STYLE_DECLARATION`, and a
strict build fails on it. That covers any import from `@animus-ui/system`,
and any member named like a builder method (`styles`, `variant`,
`compound`, `states`, `system`, `props`, `extend`, `asElement`,
`asComponent`, `asClass`), read, called or destructured. So `{Box.styles}`
is reported too. Declare components in `.ts` or `.tsx` files and import them.

## What It Does

- Transforms `@animus-ui/system` builder chains into static CSS (webpack loader or Turbopack loader rule)
- Emits extracted CSS as a separate asset with `@layer` ordering
- Post-processes the emitted sheet with Lightning CSS — autoprefixed for your `targets` (browserslist query; defaults to the project config), minified in production (`minify` overrides). Targets without `:dir()` lower it to `:lang()`, which an element that sets only `dir` does not match; the build warns, and `keepDirSelector: true` keeps it as written, adding `dir-selector` to `experimental.lightningCssFeatures.exclude` so Next's own Lightning CSS pass keeps it too
- Works with both App Router and Pages Router
- Supports RSC — no runtime style injection means server components work out of the box

## License

MIT
