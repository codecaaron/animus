## 1. Rust: Fix drain bug

- [x] 1.1 Move `compose_replacements` build block (lines 1463-1479) in `project_analyzer.rs` to before the cache storage loop (before line 1400)

## 2. Rust: Scanner + emitter updates

- [x] 2.1 Update `jsx_scanner.rs` `extract_compose_family()` to match both `"compose"` and `"composeWithContext"` as callee names — force `context: true` when callee is `composeWithContext`
- [x] 2.2 Update `transform_emitter.rs` `generate_compose_replacement()` to emit `createComposedFamilyWithContext()` when `desc.context` is true
- [x] 2.3 Update `transform_emitter.rs` `apply_replacements()` to detect `createComposedFamilyWithContext(` in replacements and emit a separate import line from the derived compose-context module path
- [x] 2.4 Add `derive_compose_context_import()` helper to `transform_emitter.rs` — derives `@scope/pkg/compose-with-context` from `runtime_import`

## 3. Rust: lib.rs transform_file updates

- [x] 3.1 Split `has_compose_replacements` into `has_compose_replacements` (context:false) and `has_compose_context_replacements` (context:true)
- [x] 3.2 Add `composeWithContext` to `bindings_to_strip` and `@animus-ui/system/compose-with-context` to `consumed_sources` when context:true compose replacements exist
- [x] 3.3 Ensure `needs_use_client` is set for files with context:true compose replacements

## 4. TypeScript: Module restructure

- [x] 4.1 Strip `createContext`/`useContext` from `compose.ts`, remove `'use client'` directive, remove `context` option from function signature and implementation
- [x] 4.2 Strip `createContext`/`useContext` from `runtime/createComposedFamily.ts`, remove `createComposedFamilyWithContext` function, simplify config to `{ name: string }`
- [x] 4.3 Create `composeWithContext.ts` with `'use client'` — exports `composeWithContext()` (authoring API) and `createComposedFamilyWithContext()` (extraction runtime shim)
- [x] 4.4 Update `index.ts` barrel: keep compose + createComposedFamily exports (now RSC-safe), do NOT add composeWithContext
- [x] 4.5 Update `runtime-entry.ts`: keep createComposedFamily (now RSC-safe), do NOT add createComposedFamilyWithContext
- [x] 4.6 Add `./compose-with-context` subpath to `package.json` exports
- [x] 4.7 Add `composeWithContext.ts` as tsdown entry point in `tsdown.config.ts`
- [x] 4.8 Update `types/component.ts` — no changes needed (context was never in the type definitions)

## 5. Tests

- [x] 5.1 Update `compose.test.tsx` — remove `context: true` tests from `compose()`, add equivalent tests using `composeWithContext()`
- [x] 5.2 Update canary tests — verify compose replacement emits `createComposedFamily`, add test for `composeWithContext` replacement emitting `createComposedFamilyWithContext`
- [x] 5.3 Add scanner test for `composeWithContext` callee detection

## 6. Build + verify

- [x] 6.1 Rebuild extract crate: `bun run build:extract`
- [x] 6.2 Rebuild system package: `bun run --filter './packages/system' build`
- [x] 6.3 Verify RSC safety: inspect `dist/index.js`, `dist/runtime-entry.js`, `dist/compose.js` — none should contain `createContext` or `useContext`
- [x] 6.4 Verify client boundary: inspect `dist/composeWithContext.js` — must start with `"use client"` and contain `createContext`/`useContext`
- [x] 6.5 Run `bun run test:canary` — all tests pass (179/179)
- [x] 6.6 Run `bun run verify` — builds + compiles + tests + rust + types all pass (biome formatting issues on pre-existing files from prior sessions)
- [x] 6.7 Update `packages/next-test-app/src/components/Family.tsx` — import compose from barrel (RSC-safe), removed compose subpath import
