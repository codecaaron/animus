## 1. Rust: Shared Map Artifact

- [ ] 1.1 Add `system_prop_map` field to `AnalysisResult` in `lib.rs` — aggregate all `(propName, valueKey, className)` tuples from the per-component system_props into a single `HashMap<String, HashMap<String, String>>` and serialize to JSON
- [ ] 1.2 Remove `system_props` from `ComponentReplacement` struct — keep only `system_prop_names` (the string array of which props the component accepts)
- [ ] 1.3 Update `transform_emitter.rs` — stop emitting `systemProps` in per-component config, emit only `systemPropNames` in the config object
- [ ] 1.4 Update `transform_emitter.rs` — add `systemPropMap` as 4th argument to `createComponent()` calls for components that have system props
- [ ] 1.5 Update `transform_emitter.rs` — emit `import { systemPropMap } from 'virtual:animus/system-props'` once per file when any component in that file has system props

## 2. Runtime: Shared Map Resolution

- [ ] 2.1 Update `createComponent` signature in `packages/runtime/src/index.ts` — add optional 4th parameter `systemPropMap?: Record<string, Record<string, string>>`
- [ ] 2.2 Update system prop resolution loop — read from `systemPropMap` parameter instead of `config.systemProps`
- [ ] 2.3 Remove `systemProps` from `ComponentConfig` type — keep `systemPropNames`
- [ ] 2.4 Verify prop filtering still uses `config.systemPropNames` for DOM prop exclusion

## 3. Vite Plugin: Virtual Module

- [ ] 3.1 Add `resolveId` handling for `virtual:animus/system-props` — resolve to `\0virtual:animus/system-props`
- [ ] 3.2 Add `load` handling — return `export const systemPropMap = ${systemPropMapJson};` from cached extraction result
- [ ] 3.3 Store `system_prop_map` from extraction result alongside existing `css` cache in plugin state
- [ ] 3.4 Add HMR invalidation — after re-extraction, diff new `system_prop_map` against cached version, invalidate the virtual module in `server.moduleGraph` if changed

## 4. Verification

- [ ] 4.1 Run `bun run test:canary` — Rust canary tests pass with new artifact shape
- [ ] 4.2 Run `bun run verify` — TS builds, tests, and type checks pass
- [ ] 4.3 Run `bun run verify:showcase` — showcase builds with shared map, styles render correctly
- [ ] 4.4 Manual dev server check — edit a system prop value in showcase, confirm HMR updates without full page reload and without component file re-transforms
