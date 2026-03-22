## Why

Five arcs of the Finite Style Machine are implemented: 146 Rust unit tests, 74 integration tests, 5 concentric snapshots. But every test calls Rust NAPI functions directly — no test has ever run the pipeline through a real Vite build. We have never:

1. Run `vite build` with the extraction plugin enabled
2. Produced a bundled app where components render with extracted CSS class names
3. Verified that the runtime shim (`createComponent`) works in a browser context
4. Seen the extracted CSS actually style rendered elements

This is the gap between "the pipeline works" and "the pipeline produces a working app." A minimal Vite + React app that defines animus components, uses them with system props/variants/states, builds with extraction, and renders correctly in a browser closes this gap.

## What Changes

- **New package `packages/smoke-test/`**: A minimal Vite + React app with its own animus components (no dependency on the doc site or UI package)
- **Inline extraction plugin**: A simplified version of the Vite plugin that loads the NAPI addon directly, avoiding workspace package resolution issues. Uses pre-serialized config from the test fixture source of truth.
- **Components exercising all extraction features**: styles, variants (with defaults), states, groups (system props), responsive values, pseudo-selectors
- **Build verification**: `vite build` produces `dist/` with HTML + JS + CSS where the CSS contains extracted @layer rules and the JS uses `createComponent` from the runtime shim

## Capabilities

### New Capabilities
- `smoke-test-app`: A buildable Vite + React application that validates the full extraction pipeline end-to-end: source analysis → CSS generation → source transformation → runtime class application → browser rendering.

### Modified Capabilities
None — this is a new self-contained package that consumes existing packages without modifying them.

## Impact

- **`packages/smoke-test/`**: New package (not published, private)
- **No changes to existing packages**: core, extract, runtime, vite-plugin are consumed as-is
- **Validates**: Vite plugin integration, NAPI addon loading, runtime shim in browser context, CSS @layer rendering

## Known Integration Challenges

1. **Vite config TypeScript**: Vite processes its config through Node's ESM loader, which can't handle TypeScript generics in `require()`'d modules. The serialized config must be loaded via Bun subprocess or pre-generated JSON.
2. **Workspace package resolution**: `@animus-ui/*` packages aren't published — they're workspace packages. The Vite config uses `resolve.alias` to point imports at source directories.
3. **NAPI addon path**: The `@animus-ui/extract` native addon must be loadable from the smoke test directory. Relative path to `../extract/index.js` works in the monorepo.
4. **Runtime shim bundling**: The transformed source imports from `@animus-ui/runtime`. Vite must resolve this to the runtime package's source via alias.
