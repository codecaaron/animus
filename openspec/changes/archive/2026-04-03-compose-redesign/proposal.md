## Why

`compose()` has four structural issues that compound into fragility and unnecessary React tree depth:

1. **Extra React element in tree**: Root wraps with `createElement(Provider, {value}, createElement(Source, props))` — every composed family has an invisible extra component in the tree. Root should provide context without an additional wrapper layer.
2. **Case-insensitive Root detection**: Runtime uses `name.toLowerCase() === 'root'`, types use `Lowercase<K> extends 'root'`. Any casing of "root" matches. This is fragile — `ROOT`, `rOOt` all silently become the provider. Convention should be explicit: the key must be literally `"Root"`.
3. **displayName derivation is fragile**: `rootSlot.displayName.replace(/[-_].*$/, '')` strips after the first dash/underscore. With extraction class names like `animus-Card-abc123`, this produces `animus` as the family name. Family name should derive from slot keys, not parsed displayNames.
4. **Key preservation through wrappers**: `forwardRef` wrappers need to correctly propagate React keys for list rendering scenarios.

These are all in ~100 lines of `compose.ts` + supporting types in `component.ts`. Small scope, high-impact DX improvement.

## What Changes

- Replace Provider-wrapping Root pattern with Fragment-based context injection (Root renders as itself, not wrapped in Provider)
- Enforce `"Root"` as the exact slot key convention (remove `toLowerCase()` matching, update `RootSlot` type to use literal `'Root'` key lookup)
- Derive family name from the composed family's slot structure, not from displayName parsing
- Ensure React key propagation through forwardRef wrapper layer
- **BREAKING**: Slot key `"root"` (lowercase) no longer detected as Root — must be `"Root"`

## Capabilities

### New Capabilities

- `compose-slot-composition`: Covers compose() API, Root convention, context propagation, sealing behavior, family naming

### Modified Capabilities

- `pipeline-integration-testing`: Composition tests need updating for new Root convention and wrapper structure

## Impact

- `packages/system/src/compose.ts` — rewrite (~100 lines)
- `packages/system/src/types/component.ts` — update `RootSlot`, `ComposedFamily`, remove deprecated `SharedVariantKeys`
- `packages/_integration/__tests__/composition.test.ts` — update test expectations
- `packages/_integration/fixtures/components/composition.tsx` — update fixture if Root key convention changes
- Rust extractor: verify compose detection in `chain_walker.rs` / `project_analyzer.rs` still works with new wrapper structure (extraction reads AST, not runtime)
