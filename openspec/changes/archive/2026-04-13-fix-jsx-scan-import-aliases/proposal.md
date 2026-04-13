## Why

The JSX scanner matches elements to extracted components by **binding name only** — `self.component_props.get(tag)` does a direct string lookup. When a consumer renames an import (`import { Button as TestDsButton }`), the JSX tag `TestDsButton` doesn't match the definition binding `Button` in `global_component_props`. System prop usages on renamed components are silently missed — no utility classes generated, no runtime resolution.

This primarily surfaces with external DS packages where consumers commonly rename to avoid collision with local components of the same name, but it affects any renamed import across both Vite and Next.js.

## What Changes

- Before the JSX scan loop in `project_analyzer.rs`, build a per-file **import alias map** using the already-available `file_modules` data (`ImportInfo.local_name` → `ImportInfo.imported_name`)
- For each file being scanned, augment `global_component_props`, `component_usage_configs`, and `global_custom_props` with alias entries so the scanner resolves `TestDsButton` → `Button`'s active props
- Same treatment for `member_expr_bindings` if compose family slots are re-exported under aliases

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `jsx-system-prop-scanner`: Add requirement that the scanner resolves import aliases before matching JSX element tags to component bindings

## Impact

- **Code**: `packages/extract/src/project_analyzer.rs` — JSX scan loop (Phase 5b, ~10-15 lines added before the scan call)
- **Runtime**: External DS components with renamed imports will have system prop usages detected → utility classes generated → runtime resolution works
- **Performance**: Per-file map augmentation is O(imports × component_props) per file — negligible given typical import counts
- **Scope**: Rust crate only. No plugin changes. Affects both Vite and Next.js pipelines since both use the same `analyzeProject()` NAPI function
