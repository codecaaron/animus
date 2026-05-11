## Why

The smoke test at `packages/smoke-test/` proved the extraction pipeline works, but it hides real integration complexity behind an inline Vite plugin, static JSON theme, and minimal components. A real application using Animus would import `@animus-ui/vite-plugin` as a package, use `ThemeBuilder` from `@animus-ui/theming` for color modes, compose components at depth, and exercise the full vocabulary of the builder chain API.

Building a proper showcase app serves three purposes: (1) end-to-end validation that the entire extraction pipeline works as a consumer would actually use it, (2) a reference implementation demonstrating how to set up and use Animus with extraction, and (3) a design quality proof that the Animus API is expressive enough to build distinctive, polished interfaces — not just render colored boxes.

## What Changes

- **New package `packages/showcase/`**: A Vite + React application that uses Animus packages as workspace dependencies — no inline plugins, no source aliases, no shortcuts.
- **Real theme via ThemeBuilder**: Uses `@animus-ui/theming`'s `createTheme().addColors().addColorModes().build()` with `evaluateTheme` to produce CSS variable definitions. Light and dark modes.
- **Component vocabulary exercise**: Components demonstrating `.styles()`, `.variant()`, `.states()`, `.groups()`, `.extend()`, `.asComponent()`, responsive values, pseudo-selectors, and composition depth (components inside components).
- **Polished frontend design**: Uses the `frontend-design` skill for visual quality — this should look like a real product, not a test fixture.
- **`vite.config.ts` as reference**: Shows the minimal, correct setup for a consumer: import plugin, evaluate theme, configure, done.

## Capabilities

### New Capabilities

_None — this is a consumer of existing capabilities, not a new pipeline feature._

### Modified Capabilities

_None — existing specs are unchanged. Gaps discovered during implementation will be tracked as new proposals._

## Impact

- **New package**: `packages/showcase/` — Vite + React app
- **Dependencies**: `@animus-ui/core`, `@animus-ui/theming`, `@animus-ui/vite-plugin`, `@animus-ui/runtime`
- **No changes to existing packages** — this is a pure consumer. Any integration issues discovered are filed as separate proposals, not fixed inline.
- **Build verification**: `bun run build` in the showcase must succeed with extraction, color modes, and zero Emotion runtime.
