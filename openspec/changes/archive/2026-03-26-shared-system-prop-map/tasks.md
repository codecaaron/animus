## 1. Rust: Shared Map Artifact

- [x] 1.1 Add `system_prop_map` field to `UniverseManifest` in `project_analyzer.rs` — aggregate utility_output.class_map (group props only). Custom props excluded.
- [x] 1.2 Remove `system_props` from `ComponentReplacement` and `ComponentDescriptor` structs — keep only `system_prop_names`
- [x] 1.3 Update `transform_emitter.rs` — stop emitting `systemProps` in per-component config, emit only `systemPropNames` in the config object
- [x] 1.4 Update `transform_emitter.rs` — add `systemPropMap` as 4th argument to `createComponent()` calls for components that have system props
- [x] 1.5 Update `transform_emitter.rs` — emit `import { systemPropMap } from 'virtual:animus/system-props'` once per file when any component in that file has system props
- [x] 1.6 Update Rust tests in `transform_emitter.rs` — assertions for new createComponent signature and systemPropMap import/absence

## 2. Runtime: Shared Map Resolution

- [x] 2.1 Update `createComponent` signature in `packages/system/src/runtime/index.ts` — add optional 4th parameter `systemPropMap?: SystemPropMap`
- [x] 2.2 Update system prop resolution loop — read from `systemPropMap` parameter instead of `config.systemProps`
- [x] 2.3 Remove `systemProps` from `ComponentConfig` type — keep `systemPropNames`
- [x] 2.4 Verify prop filtering still uses `config.systemPropNames` for DOM prop exclusion

## 3. Vite Plugin: Virtual Module

- [x] 3.1 Add `resolveId` handling for `virtual:animus/system-props` — resolve to `\0virtual:animus/system-props`
- [x] 3.2 Add `load` handling — return `export const systemPropMap = ${systemPropMapJson};` from cached extraction result
- [x] 3.3 Store `system_prop_map` from extraction result alongside existing css cache in plugin state
- [x] 3.4 Add HMR invalidation — invalidate virtual module in both geological reset and regular HMR paths

## 4. Canary Tests

- [x] 4.1 Update canary test assertions for new manifest shape — verify `system_prop_map` field present with group prop entries
- [x] 4.2 Update canary test assertions for transformed output — verify `systemPropMap` import and 4th argument, no `systemProps` in config

## 5. Verification

- [x] 5.1 Run `bun run build:extract` — Rust compiles clean (0 warnings)
- [x] 5.2 Run `bun run test:canary` — 108/108 pass
- [x] 5.3 Run `bun run verify` — TS builds pass
- [x] 5.4 Run `bun run verify:showcase` — showcase builds (277KB JS, down from 294KB — 17KB saved from deduplication)
