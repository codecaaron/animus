## Why

V1 `parse_module_info` mixes statement dispatch with a nested named-export
collection policy. A behavior-preserving private extraction makes that phase
boundary legible and reduces a verified complexity lead without changing the
module-resolution contract.

## What Changes

- Add an exact pre/post named-export outcome matrix.
- Extract named-export collection into one private V1 helper.
- Stabilize the downstream V1 project-analysis coordinator with one typed
  internal input, explicit parse/cache, extension-provenance, ordering, usage,
  chain-evaluation/inheritance, cache-aware JSX scanning, dynamic/custom
  utility construction, runtime-metadata, reconciliation, and replacement/CSS
  output phase owners, plus explicit manifest-data and cache-persistence owners,
  import/static-resolution, diagnostic, and reverse-provenance owners, one
  component-scan map pass, and one cache-result insertion.
- Add an evaluator-backed V1 theme-value matrix and isolate negative lookup
  normalization from transform eligibility/fallback without changing output.
- Keep the OODA change open as the V1 module-analysis epic; promote later
  verified seams into separate increment packets only when their signals land.
- Preserve module metadata, path/static resolution, NAPI and manifest shapes,
  cache semantics, V2, and downstream output.

## Capabilities

### New Capabilities

- `arch-v1-module-info-parsing-boundary`: executable structural and behavioral
  constraints for private V1 named-export collection.
- `arch-v1-theme-value-resolution-boundary`: executable evaluator, scale,
  fallback, and negative-value constraints for V1 theme resolution.

### Modified Capabilities

None.

## Impact

- Affected code: `packages/extract/src/import_resolver.rs`,
  `packages/extract/src/project_analyzer.rs`, and the single internal call in
  `packages/extract/src/lib.rs`, plus `packages/extract/src/theme_resolver.rs`.
- Epic lifecycle: multiple sequential, independently revertible increments;
  row 01 owns only the named-export source footprint.
- Public APIs, dependencies, manifests, NAPI shapes, V2 source, and deployment:
  unchanged.
