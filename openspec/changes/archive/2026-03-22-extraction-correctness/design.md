## Context

The extraction pipeline (Arcs 1-5) successfully replaces Emotion's `styled()` with static CSS + a lightweight `createComponent()` runtime shim. However, correctness verification is incomplete:

- The smoke test has no TypeScript checking — Vite uses esbuild which strips types without validation. Source-level type errors (the builder chain's type-state machine) are never verified.
- The Rust chain walker silently skips unknown builder methods (`chain_walker.rs:242`). A chain like `animus.styles({}).garbage({}).asElement('div')` extracts only `.styles()` and silently ignores `.garbage()`.
- The transform prepends `import { createComponent } from '@animus-ui/runtime'` but leaves the original `import { animus } from '@animus-ui/core'` intact — dead code that causes Emotion to load.
- The `.asComponent()` HOC path (wrapping a React component instead of an HTML tag) works in the runtime but has zero smoke test coverage.

A previous proposal (`typescript-type-preservation`) suggested making `createComponent` generic with type assertions in the transform output. **This is unnecessary.** The transform output is an ephemeral artifact consumed by esbuild/browser — it's never type-checked. Type safety lives at the source level, enforced by the builder chain's type-state machine before extraction transforms the code.

## Goals / Non-Goals

**Goals:**
- Verify source-level type correctness via `tsc --noEmit` in the smoke test
- Bail on unknown chain methods in the Rust walker (defense-in-depth)
- Strip dead `@animus-ui/core` imports from transformed output
- Exercise the `.asComponent()` path in the smoke test

**Non-Goals:**
- Generic `createComponent<Props>` signature — unnecessary, transform output is never type-checked
- Full Emotion import tree removal (transitive deps) — dead code elimination handles this at bundle time
- New runtime capabilities — the shim is functionally complete for current scope

## Decisions

### 1. Unknown method → bail, not skip

**Decision:** When `chain_walker.rs` encounters a method not in `CHAIN_METHODS` and not in `BAIL_METHODS`, it sets `extractable = false` with bail reason `"unknown chain method: {name}"`.

**Rationale:** The TypeScript type-state machine prevents invalid methods at compile time. The Rust bail is defense-in-depth — if source somehow contains an invalid method (code generation, macro, skipped tsc), extraction should fail loudly rather than produce CSS with missing styles. The alternative (silently skip) was the current behavior and caused the Priority 1 item.

### 2. Import stripping via byte-range removal in apply_replacements

**Decision:** `apply_replacements` receives the set of import sources that are "consumed" by extraction (currently just `@animus-ui/core`). Any `import` statement whose source matches a consumed import AND whose bindings are all replaced gets removed from the output.

**Rationale:** The transform already manipulates the source as a string with byte-range replacements. Adding import removal to the same pass is natural. The alternative (Vite plugin post-processing) adds complexity in a different layer. We only strip imports when ALL bindings from that import have been replaced — partial imports (e.g., `import { animus, someHelper }` where only `animus` chains are extracted) keep the import.

**Constraint:** The Rust side only knows about builder chain bindings. It cannot determine if other named imports from the same source are used elsewhere. The safe approach: only strip imports where EVERY named binding from that import is a known extracted component binding.

### 3. Smoke test tsconfig extends root with jsx: react-jsx

**Decision:** `packages/smoke-test/tsconfig.json` extends the root `tsconfig.json`, overrides `jsx` to `"react-jsx"` (modern transform), sets `noEmit: true`, and includes `src/**/*.tsx`.

**Rationale:** The root tsconfig uses `"jsx": "react"` (classic transform). The smoke test uses React 18 with the modern JSX transform (no `import React`). The `noEmit` flag is set because Vite handles actual compilation — tsc is only for type verification.

### 4. Supersede typescript-type-preservation proposal

**Decision:** The `typescript-type-preservation` change at `openspec/changes/typescript-type-preservation/` should be archived after this change lands. Its core premise (generic `createComponent`) is unnecessary.

**Rationale:** Transform output is never type-checked. Type safety is a source-level concern, not a transform-output concern. The Vite pipeline: source → tsc verifies types → Vite transform replaces chains → esbuild strips types → browser gets plain JS. The replacement happens AFTER type checking.

## Risks / Trade-offs

- **[Import stripping heuristic may be too conservative]** → If a file imports `{ animus, createParser }` from core and only `animus` chains are extracted, the import stays. This means `createParser` (and transitively Emotion) still loads. Mitigation: this is the safe default. A future change can implement smarter dead-import analysis.
- **[Unknown method bail may break edge cases]** → If someone chains a method we haven't considered (e.g., a future builder API addition), extraction bails. Mitigation: the `CHAIN_METHODS` list is explicit and versioned with the crate. Adding a new method is a one-line change.
- **[tsc may find existing type errors in smoke test]** → The smoke test source may have latent type issues that were invisible without tsc. Mitigation: fix them — that's the point.
