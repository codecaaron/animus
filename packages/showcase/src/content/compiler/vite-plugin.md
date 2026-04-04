# Vite Plugin

> Prerequisites: React 18+, Vite 5+. `bun` recommended as your package manager.

## Install

```bash
bun add @animus-ui/system @animus-ui/vite-plugin
```

## Configure Vite

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { animusExtract } from '@animus-ui/vite-plugin';

export default defineConfig({
  plugins: [
    animusExtract({ system: './src/ds.ts' }),
    react(),
  ],
});
```

The Animus plugin must come before the React plugin so it can process styled components before JSX compilation. Because extraction produces a static CSS file (no runtime CSS-in-JS), this works with SSR, React Server Components, and any deployment target without additional configuration.

## Cascade layer customization

The Vite plugin accepts a `layers` option to interleave your own CSS layers with the Animus layers:

```typescript
// vite.config.ts
animusExtract({
  system: './src/ds.ts',
  layers: ['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides'],
})
```

The 7 Animus layers (`global`, `base`, `variants`, `compounds`, `states`, `system`, `custom`) must appear in their required order, but you can add your own layers before, after, or between them. This lets you integrate with third-party CSS that uses `@layer`, or establish a dedicated override layer for consumer code.

## HMR behavior

Both the Vite plugin and dev server support hot module replacement. When you edit a component file:

1. The plugin content-hashes the file and skips re-analysis if nothing changed
2. Changed files trigger incremental re-analysis and CSS regeneration
3. The CSS virtual module is invalidated alongside the changed JS module

Changes to your system file (`ds.ts`) trigger a **geological reset** -- the plugin reloads the entire system via subprocess, clears the extraction cache, and regenerates all CSS. This is automatic but takes longer than a normal HMR update.

## Going further

- [Getting Started](/docs/start) -- first component tutorial
- [System Setup](/docs/architecture/system-setup) -- the `ds.ts` file explained line by line
