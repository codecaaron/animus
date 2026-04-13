## Context

The JSX scan phase (Phase 5b in `project_analyzer.rs`) iterates all files and calls `scan_jsx_usage()` per file. The scanner receives `global_component_props` (binding → active system prop names), `component_usage_configs` (binding → variant/state info), and `global_custom_props` (binding → custom prop names). All three maps are keyed by the **definition binding** — the name used in the source file where the component is defined.

The `file_modules` map (built in Phase 1) contains each file's `ImportInfo` records with `local_name` (what the consumer calls it) and `imported_name` (what the source exported). This data is available but not consulted during JSX scanning.

## Goals / Non-Goals

**Goals:**
- JSX scanner resolves renamed imports so `<TestDsButton px={48}>` generates the same utility class as `<Button px={48}>`
- All three prop maps (`global_component_props`, `component_usage_configs`, `global_custom_props`) handle aliases consistently
- Zero cost for files with no renamed imports (common case)

**Non-Goals:**
- Namespace imports (`import * as DS from '...'` → `<DS.Button>`) — already handled by `member_expr_bindings`
- Dynamic imports / lazy components — out of scope, different resolution model
- Refactoring the scanner to accept import context directly — would require changing the `scan_jsx_usage` signature and all callers

## Decisions

### 1. Per-file augmented maps via Cow-clone on first alias

For each file in the scan loop, check if any imports have `local_name != imported_name` where `imported_name` is a key in any of the three maps. If no aliases found, pass the original maps unchanged (zero cost). If aliases exist, clone the map(s) and insert alias entries.

**Rationale**: Most files have zero renamed component imports. The common case pays nothing. The clone cost for files with aliases is negligible — these maps are small (typically <50 entries).

**Alternative considered**: Pre-building a global alias map across all files. Rejected because different files can alias different components to the same local name (`Button as Btn` in file A, `IconButton as Btn` in file B). Per-file augmentation is correct; global augmentation risks cross-file prop leakage.

### 2. Match by `imported_name` against map keys

The `ImportInfo.imported_name` is the exported name from the source module. For `export const Button = ...`, this matches the definition binding exactly. This covers the standard case.

For re-exports (`export { internal as Button }`), `imported_name` is `"Button"` (the public name), which is also what `comp_replacement.binding` uses — because the binding name comes from the export-facing name when resolved through the import chain.

**Rationale**: Direct string match on `imported_name` works because `global_component_props` keys ultimately derive from the same export-name resolution path.

## Risks / Trade-offs

**[Risk: Prop set union on collision]** → If file A aliases ComponentX as `Foo` and `Foo` is ALSO a definition binding for a different component, the augmented map would have the union of both prop sets. This is safe — the scanner only records usages for attrs that exist in the active set AND are present on the JSX element. Worst case: a few extra utility classes generated that are never used. Not incorrect, just slightly wasteful.

**[Risk: Cache invalidation]** → The per-file JSX usage cache stores results keyed by content hash. If a component's active props change (new group added), cached files with renamed imports won't be re-scanned. This is a pre-existing issue not introduced by this change — the cache already doesn't account for prop set changes. The geological reset (system file change) clears the cache, which is the correct recovery path.
