## Context

The runtime package (`packages/runtime/src/index.ts`) is a single file containing `createComponent` — a lightweight React wrapper that applies extracted CSS class names via variant, state, and system prop resolution. System already depends on runtime: both `Animus.ts` and `AnimusExtended.ts` import `createComponent` from `@animus-ui/runtime`. This mirrors the prior `absorb-theming-into-system` change which moved theming's source into system.

Current import sites for `@animus-ui/runtime`:
- `packages/system/src/Animus.ts` (line 1)
- `packages/system/src/AnimusExtended.ts` (line 1)
- `packages/system/package.json` (dependency)
- `packages/showcase/package.json` (dependency — though showcase doesn't import it directly)
- `packages/extract/src/transform_emitter.rs` (line 147 — hardcoded import in emitted JS)
- `packages/extract/src/transform_emitter.rs` (lines 328, 455 — test assertions)
- `packages/extract/tests/canary.test.ts` (lines 165, 1125, 1145 — test assertions)

## Goals / Non-Goals

**Goals:**
- Move `createComponent` into system as `src/runtime/index.ts`
- Export `createComponent` from system's public API
- Update Rust emitter to import from `@animus-ui/system`
- Update all test assertions to match new import path
- Remove runtime from active workspace build order and publish list
- Consumer installs 2 packages: `@animus-ui/system` + `@animus-ui/vite-plugin`

**Non-Goals:**
- Changing `createComponent`'s signature or behavior (that's `shared-system-prop-map`)
- Touching core or theming packages (legacy Emotion runtime — stays as-is)
- Moving transforms out of core into system (vite-plugin's core dep stays)
- Removing the runtime package directory (can stay as empty/deprecated)

## Decisions

### 1. Runtime source moves to `system/src/runtime/index.ts`

Same pattern as theming absorption: dedicated subdirectory within system. The file moves wholesale — no refactoring, no splitting. System's `src/index.ts` gains `export { createComponent } from './runtime'`.

**Why subdirectory over flat file:** Maintains the same organization pattern as `system/src/theme/`. If runtime gains additional exports later (e.g., shared system prop map integration), the directory is ready.

### 2. Animus.ts and AnimusExtended.ts update to local import

```typescript
// Before
import { createComponent } from '@animus-ui/runtime';
// After
import { createComponent } from './runtime';
```

Internal imports use relative paths, not package self-references.

### 3. Rust import path is a single-line string change

`transform_emitter.rs:147`:
```rust
// Before
"import {{ createComponent }} from '@animus-ui/runtime';\nimport '{}';\n"
// After
"import {{ createComponent }} from '@animus-ui/system';\nimport '{}';\n"
```

Two test assertions in the same file (lines 328, 455) and three in `canary.test.ts` (lines 165, 1125, 1145) update to match.

### 4. Runtime package removed from workspace array and build order

`package.json` root workspace array: remove `packages/runtime`. `build:ts` script: remove runtime from the build chain. The `packages/runtime/` directory can remain on disk (git history) but is no longer built or published.

### 5. System's React peer dep version range

System already has `"react": "^18.0.0 || ^19.0.0"` as a peer dep. Runtime had `"react": ">=17.0.0"`. After absorption, use system's existing range — it's more specific and matches what we actually test against.

## Risks / Trade-offs

**[Runtime package disappears from npm]** → No external consumers exist (zero downloads). The published `@animus-ui/runtime@0.1.0-next.1` becomes an orphan. No migration needed.

**[Showcase package.json still lists runtime dep]** → Remove it. Showcase imports system, which now contains createComponent.

**[CI release job publishes runtime]** → Remove from the publish list in the workflow file.
