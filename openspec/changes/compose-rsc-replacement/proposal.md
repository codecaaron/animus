## Why

`compose()` imports `createContext` and `useContext` from React unconditionally. These are RSC-banned APIs. Because `@animus-ui/system`'s barrel re-exports `compose`, the entire package is poisoned — importing even `createTheme` in a Next.js Server Component triggers `UnhandledSchemeError` or RSC boundary violations.

This breaks the extraction promise. The CSS-first compose model (selector-based shared variant propagation via descendant selectors) was designed to avoid React context. But the runtime artifact still ships `createContext` even when `context: false` — which is the default and overwhelmingly common case.

The transform emitter already replaces individual builder chains (`ds.styles()...asElement()`) with `createComponent()` calls. `compose()` calls should get the same treatment: the extraction pipeline should replace them with a thin, RSC-safe runtime artifact when `context: false`, and inject `'use client'` only when `context: true` (already tracked via `use_client_files`).

## What Changes

- The Rust extraction pipeline replaces `compose()` call expressions with `createComposedFamily()` calls
- `context: false` (default): replacement uses only `forwardRef` + `createElement` — fully RSC-safe
- `context: true`: replacement uses `createContext` + `useContext` + `forwardRef` + `createElement`, and the file receives `'use client'` directive (existing `use_client_files` mechanism)
- New runtime shim `createComposedFamily` in `@animus-ui/system/runtime` with two code paths
- The source `compose()` import from `@animus-ui/system` is stripped from transformed output (same pattern as `animus` builder import stripping)

## Capabilities

### New Capabilities
- `compose-replacement`: Transform emitter generates `createComposedFamily()` replacement for `compose()` calls, splitting context/no-context paths for RSC safety

### Modified Capabilities
- `project_analyzer.rs`: Records compose call spans alongside existing `ComposeFamilyInfo` for replacement
- `transform_emitter.rs`: New replacement generator for compose expressions
- `jsx_scanner.rs`: Captures compose call span (byte range) in `ComposeFamilyInfo`

## Impact

- **Next.js App Router**: `@animus-ui/system` becomes importable in Server Components (for `createTheme`, `createSystem`, types) without RSC boundary violations
- **Bundle size**: `context: false` families shed `createContext`/`useContext` from their chunk entirely
- **No API change**: `compose()` call sites remain identical — the replacement is transparent
- **Existing behavior preserved**: `context: true` families still work, with `'use client'` injected automatically
