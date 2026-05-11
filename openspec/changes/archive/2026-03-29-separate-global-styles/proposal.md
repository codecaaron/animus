## Why

`withGlobalStyles()` on the `SystemBuilder` chain conflates two distinct concerns: defining the component API vocabulary (props, groups, scales, transforms) and emitting document-level CSS (resets, body defaults, scrollbar styles, keyframes). These serve different audiences — the component author vs. the browser — and have different lifecycles. Separating them clarifies what `createSystem` is responsible for and enables composable global style blocks rather than the current prescriptive `{ reset, global }` split.

## What Changes

- **BREAKING**: Remove `.withGlobalStyles()` from the `SystemBuilder` chain
- **BREAKING**: `createSystem().build()` returns `{ system, createGlobalStyles }` instead of a bare `SystemInstance`
- Introduce `createGlobalStyles` as a sibling factory produced by the same build — shares the token vocabulary but is a separate concern
- Global style blocks are composable: consumers call `createGlobalStyles()` as many times as needed, organizing resets, theming, and keyframes however they want
- Remove the `GlobalStylesConfig` type and its `{ reset?, global? }` structure — global styles are just selector-to-style maps
- Update `SerializedConfig` to receive global styles through a separate channel rather than the system instance
- Update the Vite plugin to discover global style exports alongside the system export

## Capabilities

### New Capabilities
- `global-styles-factory`: Factory function returned from system build that produces composable global style blocks independent of the system builder chain

### Modified Capabilities
<!-- No existing specs to modify -->

## Impact

- `packages/system/src/SystemBuilder.ts` — Remove `withGlobalStyles`, `GlobalStylesConfig`, change `.build()` return type
- `packages/system/src/index.ts` — Update exports
- `packages/vite-plugin/src/index.ts` — Update global styles discovery (currently reads from `serialize().globalStyles`)
- `packages/vite-plugin/src/resolve-global-styles.mjs` — May need updated evaluation path
- `packages/extract/src/css_generator.rs` — `@layer global` emission may need to accept styles from a different source
- `packages/showcase/src/ds.ts` — Consumer migration: destructure build result, move global styles to `createGlobalStyles()` calls
- All consumer code that imports `ds` directly will need to adjust to destructured import
