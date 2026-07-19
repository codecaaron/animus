## Why

V1's central `resolve_value` method combines four compatibility-sensitive
stages and carries CCN 30 with six levels of nesting. A behavior-preserving
extraction of its scale-lookup stage makes ownership legible and lowers change
risk while retaining every current scale, transform, and fallback outcome.

## What Changes

- Add an exact pre/post scale-outcome matrix in the V1 resolver tests.
- Extract V1 scale lookup into one private helper.
- Preserve all public, transform, negative-value, alias, global, keyframe, V2,
  and downstream behavior.

## Capabilities

### New Capabilities

- `arch-v1-scale-resolution-boundary`: Executable structural and behavioral
  constraints for the private V1 scale-lookup stage.

### Modified Capabilities

None.

## Impact

- Affected code: `packages/extract/src/theme_resolver.rs` only.
- Public APIs, dependencies, manifests, NAPI shapes, V2 source, and deployment:
  unchanged.
