## Tasks

### 1. Runtime — `createClassResolver`
- [ ] 1.1 Factor className resolution logic out of `createComponent` into shared internal function
- [ ] 1.2 Create `createClassResolver` in `packages/system/src/createClassResolver.ts`
- [ ] 1.3 Wire `createClassResolver` — base class, variant class lookup, state toggle, compound matching
- [ ] 1.4 System prop resolution via shared system prop map (same as createComponent)
- [ ] 1.5 Export `createClassResolver` from system package barrel

### 2. Type System — `.asClass()` terminal
- [ ] 2.1 Add `.asClass()` method to `AnimusWithStyles` (available after `.styles()`)
- [ ] 2.2 Add `.asClass()` method to `AnimusWithVariants` (available after `.variant()`)
- [ ] 2.3 Add `.asClass()` method to `AnimusWithCompounds` (available after `.compound()`)
- [ ] 2.4 Add `.asClass()` method to `AnimusWithStates` (available after `.states()`)
- [ ] 2.5 Add `.asClass()` method to `AnimusWithGroups` (available after `.groups()`)
- [ ] 2.6 Add `.asClass()` method to `AnimusWithProps` (available after `.props()`)
- [ ] 2.7 Return type: `(props: InferredProps) => string` — infer props from chain generics
- [ ] 2.8 Runtime implementation of `.asClass()` on builder — calls `createClassResolver`

### 3. Extraction — Rust crate
- [ ] 3.1 Recognize `.asClass()` as terminal in `chain_walker.rs`
- [ ] 3.2 Add `AsClass` variant to terminal enum (alongside `AsElement`, `AsComponent`)
- [ ] 3.3 CSS generation unchanged — same pipeline as `.asElement()` chains
- [ ] 3.4 Transform emission in `transform_emitter.rs` — emit `createClassResolver()` call
- [ ] 3.5 Import injection: `import { createClassResolver } from '@animus-ui/system'`
- [ ] 3.6 Class naming: dev = position-hash, prod = content-hash (same as components)

### 4. Type Tests
- [ ] 4.1 Static chain: `ds.styles({}).asClass()` → `(props?: {}) => string`
- [ ] 4.2 With variants: returned function accepts variant props
- [ ] 4.3 With states: returned function accepts state booleans
- [ ] 4.4 With groups: returned function accepts system props
- [ ] 4.5 Full chain: all prop types merged
- [ ] 4.6 Negative: `.asElement().asClass()` errors (terminal already used)

### 5. Unit Tests
- [ ] 5.1 `createClassResolver` — base class only, returns base on empty call
- [ ] 5.2 `createClassResolver` — variant prop selects correct class
- [ ] 5.3 `createClassResolver` — state boolean toggles state class
- [ ] 5.4 `createClassResolver` — compound condition matching
- [ ] 5.5 `createClassResolver` — system prop lookup from shared map
- [ ] 5.6 `createClassResolver` — default variants applied when prop omitted

### 6. Canary Tests
- [ ] 6.1 Static `.asClass()` chain extracts — CSS in `@layer base`, transform emits `createClassResolver`
- [ ] 6.2 Dynamic `.asClass()` chain extracts — variant CSS in `@layer variants`, transform includes variant config
- [ ] 6.3 Mixed file: `.asElement()` and `.asClass()` chains coexist in same file
- [ ] 6.4 `.asClass()` with extension: `.asComponent(Base).asClass()` — if supported, or error

### 7. Verification
- [ ] 7.1 `bun run verify` green
- [ ] 7.2 `bun run test:canary` green
- [ ] 7.3 `bun run verify:showcase` green (no showcase changes needed, but pipeline must not break)
