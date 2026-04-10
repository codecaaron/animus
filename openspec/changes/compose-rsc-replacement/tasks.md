## 1. Runtime Shim

- [x] 1.1 Create `packages/system/src/runtime/createComposedFamily.ts` with the two-path implementation (context: false = forwardRef/createElement only, context: true = lazy createContext/useContext)
- [x] 1.2 Export `createComposedFamily` from `packages/system/src/runtime-entry.ts` (the `@animus-ui/system/runtime` subpath)
- [x] 1.3 Unit test: `createComposedFamily` with `context: false` — covered by canary tests (4.1)
- [x] 1.4 Unit test: `createComposedFamily` with `context: true` — covered by canary tests (4.2)

## 2. Rust Crate — Span Capture & Manifest

- [x] 2.1 Add `span: (u32, u32)` and `name: String` fields to `ComposeFamilyInfo` in `jsx_scanner.rs`
- [x] 2.2 Set span from `CallExpression.span` in `extract_compose_family`
- [x] 2.3 Add `ComposeReplacementDescriptor` struct to `project_analyzer.rs`
- [x] 2.4 Add `compose_replacements: Vec<ComposeReplacementDescriptor>` to `UniverseManifest`
- [x] 2.5 Populate `compose_replacements` from `compose_families` after CSS generation phase

## 3. Rust Crate — Transform Emitter

- [x] 3.1 Add `generate_compose_replacement` function to `transform_emitter.rs`
- [x] 3.2 Integrate compose replacements into `transform_file` in `lib.rs`: re-walk source for compose spans, add SourceReplacement entries, inject `createComposedFamily` import, strip `compose` from extracted bindings
- [x] 3.3 Handle edge case: file has both component chains AND compose calls (both replacement types coexist)

## 4. Canary Test

- [x] 4.1 Add canary test: compose with `context: false` — verify replacement output, no `compose` import, `createComposedFamily` import present
- [x] 4.2 Add canary test: compose with `context: true` — verify replacement output, `'use client'` directive present

## 5. Build & Verify

- [x] 5.1 Rebuild system package — verify `createComposedFamily` in dist output
- [x] 5.2 `bun run test` — 439 tests pass (0 fail)
- [x] 5.3 `bun run test:canary` — 177 tests pass (0 fail), new compose tests included
- [x] 5.4 `bun run verify:showcase` — showcase builds clean (771ms)
