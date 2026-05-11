## Tasks

### 1. Runtime — `createClassResolver`
- [x] 1.1 Factor className resolution logic out of `createComponent` into shared `resolveClasses.ts`
- [x] 1.2 Create `createClassResolver` in `packages/system/src/runtime/createClassResolver.ts`
- [x] 1.3 Wire `createClassResolver` — base class, variant class lookup, state toggle, compound matching
- [x] 1.4 System prop resolution via shared system prop map (same as createComponent)
- [x] 1.5 Export `createClassResolver` from system package barrel

### 2. Type System — `.asClass()` terminal
- [x] 2.1-2.6 Add `.asClass()` to `AnimusWithAll` + `AnimusExtendedWithAll` (inherits to all chain positions)
- [ ] 2.7 Return type: typed `AnimusClassResolver` with inferred props (deferred — TSC stack overflow, using `Record<string, unknown>` for now)
- [x] 2.8 Runtime implementation of `.asClass()` on builder — calls `createClassResolver`

### 3. Extraction — Rust crate
- [x] 3.1 Recognize `.asClass()` as terminal in `chain_walker.rs`
- [x] 3.2 Add `AsClass` variant to terminal enum (alongside `AsElement`, `AsComponent`)
- [x] 3.3 CSS generation unchanged — same pipeline as `.asElement()` chains
- [x] 3.4 Transform emission in `transform_emitter.rs` — emit `createClassResolver()` call
- [x] 3.5 Import injection: conditional `createComponent` / `createClassResolver` based on usage
- [x] 3.6 Class naming: same as components (position-hash dev, content-hash prod)
- [x] 3.7 Reconciler: `.asClass()` chains marked always-rendered (no JSX to detect)

### 4. Type Tests
- [ ] 4.1-4.6 Deferred — requires typed return (task 2.7)

### 5. Unit Tests
- [x] 5.1 `createClassResolver` — base class only, returns base on empty call
- [x] 5.2 `createClassResolver` — variant prop selects correct class
- [x] 5.3 `createClassResolver` — state boolean toggles state class
- [x] 5.4 `createClassResolver` — compound condition matching (single + array)
- [x] 5.5 `createClassResolver` — system prop lookup from shared map
- [x] 5.6 `createClassResolver` — default variants applied when prop omitted

### 6. Canary Tests
- [x] 6.1 Static `.asClass()` chain extracts — CSS in `@layer base`, transform emits `createClassResolver`
- [x] 6.2 Dynamic `.asClass()` chain extracts — variant CSS in `@layer variants`
- [x] 6.3 Mixed file: `.asElement()` and `.asClass()` chains coexist — correct imports for each
- [ ] 6.4 `.asClass()` with extension — deferred

### 7. Verification
- [x] 7.1 246 tests passing (system + unit + canary)
- [x] 7.2 130 canary tests passing
- [x] 7.3 Rust compiles clean, biome clean, system typecheck clean
