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
  plugins: [
    react(),
    animusExtract({ system: './src/ds.ts' }),
  ],
});
```

The `system` option points to the file that exports your built system instance. The plugin loads this file in a subprocess to serialize the prop config and theme data for the Rust extraction pipeline.

## What It Does

1. **Build time**: Analyzes all files importing from `@animus-ui/system`, extracts static styles into CSS with `@layer` ordering
2. **Dev server**: Runs extraction on startup, holds results in memory, serves CSS via virtual module
3. **Transforms**: Resolves `__TRANSFORM__` placeholders using your system's named transform functions
4. **Global styles**: Emits global styles (reset, base) from your exported `createGlobalStyles()` configuration

## Important

- Do **not** add React resolve aliases to `vite.config.ts` — they break the extraction transform pipeline
- After system config changes, restart the dev server (the subprocess runs at `buildStart`)
- Run `bun run clean:light` if styles seem stale (clears `.vite` cache)

## License

MIT
