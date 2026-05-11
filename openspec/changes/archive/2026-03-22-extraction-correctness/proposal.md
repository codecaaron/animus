## Why

The extraction pipeline replaces Emotion's `styled()` with `createComponent()` at build time, but three correctness gaps remain: (1) the smoke test has no `tsconfig.json` or `tsc --noEmit` step, so type safety of the source code is never verified, (2) the Rust chain walker silently skips unknown builder methods instead of bailing, and (3) the transform prepends runtime imports but leaves the original `@animus-ui/core` (and transitively Emotion) imports as dead code. Additionally, the `.asComponent()` HOC path — which forwards `className` to wrapped components — has zero test coverage in the smoke test.

Type safety lives at the SOURCE level (pre-extraction), not the transform output. The builder chain's type-state machine prevents invalid method sequences at compile time. The Rust pipeline should enforce the same boundary at build time. The transform output is an ephemeral artifact consumed by the browser — it doesn't need TypeScript types, but it shouldn't drag in dead Emotion imports.

## What Changes

- **Smoke test TypeScript verification**: Add `tsconfig.json` extending root config and a `typecheck` script (`tsc --noEmit`) to `packages/smoke-test/`. This makes source-level type errors visible.
- **Unknown chain method bail**: In `chain_walker.rs`, methods not in `CHAIN_METHODS` or `BAIL_METHODS` set `extractable = false` with a clear bail reason. Currently these are silently skipped, producing CSS with missing styles.
- **Dead import stripping in transform**: `transform_emitter.rs`'s `apply_replacements` removes the original `import { animus } from '@animus-ui/core'` line when all builder chain bindings in a file have been replaced. Prevents Emotion from loading in the transformed output.
- **`.asComponent()` smoke test coverage**: Add a component using `.asComponent()` to the smoke test, exercising the HOC className forwarding path through both extraction and rendering.

## Capabilities

### New Capabilities

_None — this change tightens existing capabilities rather than introducing new ones._

### Modified Capabilities

- `rust-extraction-pipeline`: Chain walker must bail on unknown methods (defense-in-depth matching the type-state machine's compile-time enforcement).
- `extraction-runtime-shim`: No functional changes, but dead import stripping in transform output affects the emitted code shape.
- `vite-extraction-plugin`: No functional changes, but smoke test infrastructure validates the full pipeline including type checking.

## Impact

- **`packages/extract/src/chain_walker.rs`**: Unknown method → bail with reason
- **`packages/extract/src/transform_emitter.rs`**: Strip original `@animus-ui/core` import from transformed files
- **`packages/smoke-test/tsconfig.json`**: New file — extends root tsconfig
- **`packages/smoke-test/package.json`**: Add `typecheck` script
- **`packages/smoke-test/src/components.tsx`**: Add `.asComponent()` example
- **`packages/smoke-test/src/App.tsx`**: Use the new component
- **`packages/extract/tests/canary.test.ts`**: Tests for unknown method bail + dead import stripping
- **Supersedes**: The `typescript-type-preservation` proposal (generic `createComponent<Props>`) — that problem doesn't exist because transform output is never type-checked
