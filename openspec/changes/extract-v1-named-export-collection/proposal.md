## Why

V1 `parse_module_info` mixes statement dispatch with a nested named-export
collection policy. A behavior-preserving private extraction makes that phase
boundary legible and reduces a verified complexity lead without changing the
module-resolution contract.

## What Changes

- Add an exact pre/post named-export outcome matrix.
- Extract named-export collection into one private V1 helper.
- Keep the OODA change open as the V1 module-analysis epic; promote later
  verified seams into separate increment packets only when their signals land.
- Preserve imports, default exports, declaration rules, re-export traversal,
  path resolution, static resolution, public types, V2, and downstream output.

## Capabilities

### New Capabilities

- `arch-v1-module-info-parsing-boundary`: executable structural and behavioral
  constraints for private V1 named-export collection.

### Modified Capabilities

None.

## Impact

- Affected code: `packages/extract/src/import_resolver.rs` only.
- Epic lifecycle: multiple sequential, independently revertible increments;
  row 01 owns only the named-export source footprint.
- Public APIs, dependencies, manifests, NAPI shapes, V2 source, and deployment:
  unchanged.
