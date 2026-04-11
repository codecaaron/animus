## Why

Every `@animus-ui/system` entry point — barrel, runtime, compose — transitively imports `createContext` and `useContext` from React at module scope. React Server Components treat module-level hook/context imports as client-only signals. This means **no Animus component can render in an RSC** without a `'use client'` boundary, even components that never use context. The `context: boolean` config flag on `compose()` cannot enforce an RSC boundary because RSC analysis is static (module-level imports), not runtime (code path analysis).

Additionally, the Rust extraction pipeline has a use-after-drain bug: `per_file_compose` is emptied by the cache storage loop before `compose_replacements` is built, so `compose_replacements` is always empty in production manifests. Compose calls are never replaced.

## What Changes

- **Split `compose()` into two functions at the module boundary**: `compose()` (RSC-safe, CSS-only propagation) and `composeWithContext()` (explicit `'use client'` module, React context propagation). The function you call determines the RSC boundary — no config flag needed.
- **Strip `createContext`/`useContext` from `compose.ts` and `runtime/createComposedFamily.ts`**: These modules become RSC-safe. Only `forwardRef` and `createElement` remain.
- **New module `composeWithContext.ts`** with `'use client'` directive: exports both the authoring function (`composeWithContext`) and the extraction runtime shim (`createComposedFamilyWithContext`).
- **New subpath export `@animus-ui/system/compose-with-context`**: Explicit opt-in to client-only composition. The barrel and runtime entry stay RSC-safe.
- **Fix use-after-drain bug in `project_analyzer.rs`**: Move `compose_replacements` build before the cache storage loop that drains `per_file_compose`.
- **Update Rust scanner to detect both `compose` and `composeWithContext` call sites**: `composeWithContext` forces `context: true` at scan time.
- **Update transform emitter**: `compose()` → `createComposedFamily` (from runtime, RSC-safe). `composeWithContext()` → `createComposedFamilyWithContext` (from compose-with-context subpath, + `'use client'` injection).
- **BREAKING**: The `context` option on `compose()` is removed. Consumers using `compose({...}, { context: true })` must switch to `composeWithContext()`.

## Capabilities

### New Capabilities
- `compose-rsc-module-safety`: RSC-safe module boundary enforcement for compose — covers the module split, subpath exports, scanner detection, emitter routing, and the drain bug fix.

### Modified Capabilities
- `compose-slot-composition`: The `context` option is removed from `compose()`. `composeWithContext` becomes the explicit context path. Shared config and CSS cascade behavior unchanged.
- `extraction-emitter-config`: Emitter derives `compose_context_import` path from `runtime_import` for `createComposedFamilyWithContext` injection.

## Impact

- **`@animus-ui/system`**: `compose.ts` loses `'use client'` + context code. New `composeWithContext.ts` file. `runtime/createComposedFamily.ts` stripped of context code. New subpath in `package.json`. New tsdown entry point.
- **`@animus-ui/extract`**: `project_analyzer.rs` (drain fix + compose_replacements ordering), `jsx_scanner.rs` (detect `composeWithContext`), `transform_emitter.rs` (dual function names + compose-context import line), `lib.rs` (consumed_sources for both import paths).
- **`@animus-ui/vite-plugin`** and **`@animus-ui/next-plugin`**: May need `compose_context_import` in emitter config (derivable from `runtime_import`, so optional).
- **Tests**: `compose.test.tsx` context tests migrate to `composeWithContext`. Canary tests updated.
- **Consumers**: Anyone using `compose({...}, { context: true })` must change to `composeWithContext()`. CSS-only `compose()` calls are unchanged.
