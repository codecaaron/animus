# @animus-ui/vite-plugin

Static CSS extraction plugin for Vite. Transforms `@animus-ui/system` builder chains into static CSS at build time — zero runtime style injection.

## Install

```bash
npm install @animus-ui/vite-plugin @animus-ui/system
```

## Setup

```tsx
// vite.config.ts
import react from '@vitejs/plugin-react';
import { animusExtract } from '@animus-ui/vite-plugin';
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
page never flashes a light frame.

Generate the artifact **in your Vite config** — it is build tooling, and nothing
under `src/` may import it:

```ts
// vite.config.ts
import { createAppearanceBootstrap } from '@animus-ui/system/bootstrap';
import { animusExtract } from '@animus-ui/vite-plugin';
import { defineConfig } from 'vite';

import { tokens } from './src/ds';

const appearanceBootstrap = createAppearanceBootstrap(tokens);

export default defineConfig({
  plugins: [animusExtract({ system: './src/ds.ts', appearanceBootstrap })],
});
```

The plugin is **delivery-only**: it injects `artifact.code` verbatim as an inline
`<script data-animus-bootstrap>` at the start of `<head>`, ahead of every
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
const csp = `script-src 'self' ${appearanceBootstrap.cspHash}`;
```

Next.js is deliberately not automatic: CSP nonces need request-time control the
bundler does not have, so the application places `artifact.code` itself (in
`_document` or the root layout, with `suppressHydrationWarning` on `<html>`) and
supplies either `cspHash` or a per-request nonce.

## Important

- Do **not** add React resolve aliases to `vite.config.ts` — they break the extraction transform pipeline
- After system config changes, restart the dev server (the subprocess runs at `buildStart`)
- Run `bun run clean:light` if styles seem stale (clears `.vite` cache)

## License

MIT
