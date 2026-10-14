# @animus-ui/vite-plugin

Static CSS extraction plugin for Vite. Transforms `@animus-ui/system` builder chains into static CSS at build time — zero runtime style injection.

## Install

```bash
npm install @animus-ui/vite-plugin @animus-ui/system
```

## Setup

```tsx
// vite.config.ts
import { animusExtract } from '@animus-ui/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), animusExtract({ system: './src/ds.ts' })],
});
```

The `system` option points to the file that exports your built system instance. The plugin loads this file in a subprocess to serialize the prop config and theme data for the Rust extraction pipeline.

## What It Does

1. **Build time**: Analyzes all files importing from `@animus-ui/system`, extracts static styles into CSS with `@layer` ordering
2. **Dev server**: Runs extraction on startup, holds results in memory, serves CSS via virtual module
3. **Transforms**: Resolves `__TRANSFORM__` placeholders using your system's named transform functions
4. **Global styles**: Emits global styles (reset, base) from your exported `createGlobalStyles()` configuration

## Appearance bootstrap

Optional. Restores a persisted color mode before first paint, so a dark-persisted
page never flashes a light frame — with **zero runtime and a real CSP story**.
The restoration is a generated, dependency-free inline snippet (not a component,
not a listener), and its `script-src` hash is computed at build time from the
exact bytes generated. Runtime theme switchers have to choose between
`unsafe-inline` and a hand-maintained hash that goes stale; here the artifact IS
the hash source, so a theme edit can never strand a stale hash without also
changing the code it authorizes.

Generate the artifact **in your Vite config** — it is build tooling, and nothing
under `src/` may import it:

```ts
// vite.config.ts
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';
import { animusExtract } from '@animus-ui/vite-plugin';
import { defineConfig } from 'vite';

import { theme } from './src/ds';

const appearanceBootstrap = createAppearanceBootstrap(theme);

export default defineConfig({
  plugins: [animusExtract({ system: './src/ds.ts', appearanceBootstrap })],
});
```

The plugin is **delivery-only**: it injects `artifact.code` verbatim as an inline
`<script data-animus-bootstrap>` in `<head>`, after the charset and viewport
metas (so the charset stays within the first 1024 bytes) and ahead of every
stylesheet reference, and interprets no appearance semantics. Omit the option and
the built HTML is byte-for-byte what it was before.

### Content-Security-Policy

The artifact's second field, `cspHash`, authorizes that inline script. Two rules:

- **Derive it from the artifact at build time.** `createAppearanceBootstrap`
  returns the hash of the exact bytes it just generated. Renaming a color mode or
  changing `storageKey` changes those bytes and therefore the hash — a
  hand-copied literal in a config file silently becomes stale, and a stale hash
  means a blocked script and a flash of the wrong mode.
- **Single-quote it in `script-src`.** The value is returned ready to use:

  ```
  Content-Security-Policy: script-src 'sha256-…'
  ```

  Unquoted, `sha256-…` parses as a _host_ source, matches nothing, and silently
  fails to authorize the script.

Never fall back to `unsafe-inline`, and never use a build-time constant nonce.

```ts
// Build the header from the artifact — never from a copied string.
// The hash is single-quoted in the source list, per the rule above.
const csp = `script-src 'self' '${appearanceBootstrap.cspHash}'`;
```

Next.js is deliberately not automatic: CSP nonces need request-time control the
bundler does not have, so the application places `artifact.code` itself and
supplies either `cspHash` or a per-request nonce. Worked App Router and Pages
Router examples live in the
[`@animus-ui/next-plugin` README](https://github.com/codecaaron/animus/tree/main/packages/next-plugin#appearance-bootstrap-no-fouc-color-mode).

## Font preloads

A font face declared with `preload: true` gets a
`<link rel="preload" as="font" crossorigin data-animus-preload>` in `<head>`,
after the charset and viewport metas and ahead of every stylesheet link. Its
href is the URL the stylesheet's `url()` loads: the hashed asset in a build,
the dev server's URL in development. A root-relative or absolute URL that
`index.html` already preloads gets no second preload. A build warns, naming
the HTML page, when the finished page preloads the same file through another
tag: one written in the page for an `asset()` file, or one a plugin adds from
an `index.html` hook that runs after Animus's.

`fontPreloads` selects the faces that preload in place of their `preload`
flags, for an app that renders only some of a system's faces. A family name
selects every face of the family; `{ family, weight?, style? }` selects the
faces whose declared weight contains `weight` (a variable face's range
`'100 900'` contains 600) and whose style is `style` (`'normal'` when
omitted):

```ts
animusExtract({
  system: './src/ds.ts',
  fontPreloads: [
    { family: 'Apercu', weight: 400 },
    { family: 'Apercu', weight: 'bold' },
    { family: 'Suisse', weight: 700 },
  ],
});
```

`[]` preloads none. An entry no face matches reports
`animus.style.font-preload-unmatched`; a malformed one, such as a weight
range, reports `animus.style.font-preload-invalid`.

A preload competes with the critical CSS and JavaScript for first paint, so
preload WOFF2 and only the faces the first screen needs: a large TrueType
file can delay first paint by seconds on a slow link. A preloaded file that
is not WOFF2 or WOFF, or an `asset()` file over 150 KB, reports
`animus.style.font-face-preload-costly`.

## Third-party stylesheets

A library's plain CSS outside any `@layer` beats every Animus layer. With
`quarantine`, [`@animus-ui/layergate`](../layergate/README.md) loads it into
`anm-vendor`, a layer below all of Animus's, so Animus's styles win and the
library's still apply where Animus sets nothing:

```sh
bun add -D @animus-ui/layergate
```

```ts
animusExtract({
  system: './src/ds.ts',
  quarantine: {
    sheets: ['react-grid-layout/css/styles.css'], // delivered ahead of Animus's own CSS
    dependencies: ['react-datepicker'], // CSS these packages' modules import
    optOut: [], // exact files whose own rules stay unlayered
  },
});
```

`sheets` arrive at the head of Animus's own stylesheet, wherever it is
imported, so no extra import is needed. Their fonts and images keep
resolving, files outside the project root included.
`!important` declarations and animations still win, and are reported. App
CSS keeps its own rules unlayered; where it imports a vendor file, that file
is layered. CSS Modules are left alone.

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

## Important

- Do **not** add React resolve aliases to `vite.config.ts` — they break the extraction transform pipeline
- After system config changes, restart the dev server (the subprocess runs at `buildStart`)
- Run `bun run clean:light` if styles seem stale (clears `.vite` cache)
- The virtual module ids are published contract, and Vite gives the first `resolveId`/`load` answer for an id to the whole config, so two plugin instances in one Vite config share one bridge and one stylesheet — the second instance's modules resolve to the first's. The per-instance key only separates independently built bundles that share a document.

## License

MIT
