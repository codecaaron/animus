# Vite Integration Patterns & Consumer Surface Audit

## Problem

Animus extraction works in the showcase (controlled environment) but real-world Vite apps like blockworks os-admin exercise a much broader integration surface. Several patterns need investigation to determine whether they work, are fragile, or are silently broken.

This is a research/audit proposal — no single bug, but a set of integration concerns surfaced by examining a production consumer.

## Integration Patterns to Investigate

### 1. Tailwind + PostCSS Layer Collision

Blockworks has PostCSS with `tailwindcss` plugin AND custom layers: `['anm-global', 'reset', 'base', 'tokens', 'recipes', 'anm-base', ...]`.

Tailwind's `@tailwind base` directive emits into `@layer base`. If the consumer's custom `base` layer is the SAME `@layer base`, Tailwind's reset CSS and the consumer's component CSS share a layer — this may be intentional or accidental.

**Research:** How does Tailwind's `@layer base/components/utilities` interact with consumer-defined layers of the same name? Is collision avoidable? Should we warn?

### 2. Plugin Ordering Effects

Blockworks runs `reactRouter()` before `animusExtract()`. React Router's Vite plugin modifies the build pipeline (adds routing conventions, SSR stubs, code splitting boundaries).

**Research:** Does plugin ordering affect virtual module resolution, CSS import processing, or transform hook execution? Should we document recommended ordering or enforce it?

### 3. CSS-in-JS Coexistence Model

Blockworks uses Chakra UI v3 + Emotion alongside Animus extraction. Emotion produces unlayered runtime CSS. Animus produces layered static CSS. Currently they coexist because unlayered CSS wins in the cascade.

**Research:** Are there edge cases where Emotion and Animus target the same element with conflicting styles? What happens when a Chakra component is wrapped in an Animus `.extend()` chain? Document the coexistence model explicitly.

### 4. optimizeDeps / Pre-bundling Interaction

Blockworks includes `@animus-ui/system` in `optimizeDeps.include`. Vite pre-bundles this for dev server speed. But the extraction plugin also reads the system file via NAPI `loadSystemModule()`.

**Research:** Does pre-bundling affect the system file's availability or content? Is there a race condition between pre-bundling and `buildStart`? Should `@animus-ui/system` be in `optimizeDeps.exclude` instead?

### 5. CSS Modules Coexistence

Projects may use CSS Modules (`.module.css`) alongside Animus extraction. CSS Modules produce scoped class names and may use `@layer` internally.

**Research:** Do CSS Modules interact with Animus's `@layer` structure? Does Vite's CSS Module processing affect the virtual stylesheet?

### 6. Vite Library Mode

Building a component library (`build.lib`) rather than an application. The output is a package consumed by other apps.

**Research:** Does extraction work in library mode? How should the CSS be delivered — bundled in the package, or as a separate artifact? Does `virtual:animus/styles.css` resolve correctly in library builds?

### 7. SSR Handling

Blockworks has `ssr: false` but configures `ssr.noExternal`. If SSR were enabled, the virtual module needs server-side handling.

**Research:** What happens with `virtual:animus/styles.css` during SSR? Does the `load` hook return CSS for both client and server environments? Should the plugin detect SSR and handle differently?

### 8. Monorepo Workspace Component Packages

Blockworks imports from `@blockworks/ui-kit` (workspace package). Currently, external DS packages are discovered via system file imports (`extractSystemFilePackages`).

**Research:** If `@blockworks/ui-kit` contains Animus components that are NOT imported by the system file, are they discovered? Should there be explicit config for component package directories?

### 9. build.cssMinify: false Pattern

Blockworks disables Vite's CSS minification. This may be because our Lightning CSS processing already handles it, or because of conflicts.

**Research:** Is this necessary? Is it documented? What happens if both our postProcessCss AND Vite's minification run?

## Grounding Data

### Blockworks os-admin Configuration

```typescript
// vite.config.ts (relevant sections)
animusExtract({
  system: './src/ds.ts',
  layers: ['anm-global', 'reset', 'base', 'tokens', 'recipes', 
           'anm-base', 'anm-variants', 'anm-compounds', 'anm-states', 
           'anm-system', 'anm-custom'],
})

// Dependencies
@animus-ui/system: 0.1.0-next.49
@animus-ui/vite-plugin: 0.1.0-next.49
@chakra-ui/react: 3.34.0
@emotion/react: 11.14.0
tailwindcss: 3.4.17 (dev)
vite: 7.3.1
react-router: 7.13.1

// CSS entry: entry.client.tsx
import 'virtual:animus/styles.css';

// Path aliases
@admin/* → ./src/*
@route/* → ./.react-router/types/src/pages/*
```

### Showcase Configuration (controlled baseline)

```typescript
animusExtract({
  system: './src/ds.ts',
  layers: ['reset', 'anm-global', 'anm-base', ..., 'anm-custom', 'overrides'],
})
// No Tailwind, no Emotion, no path aliases, no external packages
```

## Key Files

- `packages/vite-plugin/src/index.ts` — plugin lifecycle, virtual module handling
- `packages/extract/pipeline/assemble-stylesheet.ts` — stylesheet assembly
- `~/workspace/blockworks-frontend/apps/os-admin/vite.config.ts` — production consumer config
- `~/workspace/blockworks-frontend/apps/os-admin/src/ds.ts` — production system file
- `~/workspace/blockworks-frontend/apps/os-admin/src/entry.client.tsx` — CSS import entry
