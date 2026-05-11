## Why

`compose()` uses React context for shared variant propagation — `createContext`, `Provider` wrapping on Root, `useContext` on every child, `__variantKeys` filtering. This adds two React tree nodes per family, runtime overhead on every child render, and breaks clean interop with headless primitive libraries (Ark, Radix) that already manage their own internal context. The CSS @layer cascade provides a zero-runtime alternative: two deterministic CSS rules per shared variant per child, using source order within a layer for override semantics.

## What Changes

- **Replace React context propagation with CSS-only two-rule model**: For each shared variant option on each child slot, emit two CSS rules at equal specificity (0,3,0) within `@layer variants`:
  - Rule 1 (inheritance): `.Root.Root--variant-option .Child { ...declarations... }` — emitted first
  - Rule 2 (override): `.Root .Child.Child--variant-option { ...declarations... }` — emitted second, wins via source order when child has a direct prop
- **Remove createContext/useContext/Provider from compose() runtime**: Root just renders with its variant classes (already happens). Children render unmodified — no wrapper logic needed for shared variants.
- **Extract compose family structure in the Rust pipeline**: `scan_compose_calls` extended to capture slot names, shared keys, and root identity (not just binding names for reconciler marking). New `ComposeFamilyInfo` struct threads into css_generator.
- **Extend reconciler for compose-family awareness**: Variant options used via composition (not direct JSX props) must not be pruned. Family info feeds reconciler to understand "this child's size variants are used because it's composed with a Root that receives size."
- **Enable Ark/Radix interop**: `.asComponent(ArkPrimitive)` composed families work without injecting context into the third-party tree. Root wrapper applies variant classes; CSS descendant selectors reach through Ark's internal structure.
- **Props passed to composed children resolve predictably**: Two-rule model gives deterministic class resolution — inheritance first, direct override second, no ambiguity.

## Capabilities

### New Capabilities
- `compose-css-propagation`: Requirements for the CSS-only two-rule shared variant propagation model — rule structure, specificity contract, source ordering, override semantics, layer placement.

### Modified Capabilities
- `compose-slot-composition`: Shared variant propagation changes from React context to CSS cascade. Root convention, SharedConfig types, sealing, and displayName are unchanged. The `__variantKeys` filtering requirement is removed (no props to filter — CSS handles it). The "direct prop overrides context" scenario becomes "direct prop overrides inherited CSS via source order."

## Impact

- **`packages/system/src/compose.ts`**: Remove `createContext`, `useContext`, `Provider` wrapping, `__variantKeys` filtering. Root wrapper simplified to class application. Child wrappers may reduce to identity passthrough or be removed entirely.
- **`packages/extract/src/jsx_scanner.rs`**: `scan_compose_calls` / `extract_compose_bindings` extended to return `ComposeFamilyInfo` (slot map, shared keys, root binding).
- **`packages/extract/src/css_generator.rs`**: New composed variant emission — two rules per shared variant option per child, using existing resolved declarations.
- **`packages/extract/src/project_analyzer.rs`**: Thread family info through Phase 5 (reconciler) and Phase 6 (generation).
- **`packages/system/src/types/component.ts`**: `ComposedFamily` type may simplify (no context-related generics). `SharedConfig` constraint unchanged.
- **`packages/extract/src/reconciler.rs`** (or reconciliation logic in project_analyzer): Extended to preserve variant options used via composition.
- **Portal-mounted slots fall back to minimal context**: Portaled content (Radix Dialog, Tooltip, etc.) renders outside the Root DOM subtree — CSS descendant selectors don't reach. These slots use a lightweight context fallback (className string only). Non-portal slots are fully CSS-only. Portals are client-only, so no RSC concern.
- **No breaking API changes**: `compose()` call signature, slot naming convention, SharedConfig types, and sealing behavior are all unchanged. The change is internal — context → CSS.
- **Depends on Rust intelligibility pass**: The extraction pipeline threading (ComposeFamilyInfo through Phase 5→6) is cleaner with a ResolveContext/PipelineState refactor. That work should precede this.
