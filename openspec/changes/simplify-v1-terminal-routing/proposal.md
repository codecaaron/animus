## Why

V1 terminal argument routing is a small but high-churn knowledge seam. Its
nested match includes an impossible `unreachable!()` arm and obscures the
distinct `.asElement()`, `.asComponent()`, and `.asClass()` contracts. A flat
exhaustive match plus one characterization matrix removes that ambiguity
without changing extraction behavior or coupling V1 to V2.

## What Changes

- Characterize all three valid V1 terminal tag shapes in one Rust unit test.
- Rewrite `extract_terminal_arg()` as one exhaustive flat match.
- Preserve callers, fallbacks, descriptors, bail policy, V2, and every runtime
  output.

## Capabilities

### New Capabilities

- `arch-extract-v1-terminal-routing`: executable architectural constraints for
  keeping V1 terminal routing exhaustive, private, and engine-local.

### Modified Capabilities

None; existing builder-chain and extraction behavior is preserved.

## Impact

- Affected code and tests: `packages/extract/src/chain_walker.rs` only.
- Public API, NAPI, manifests, dependencies, V2, and shared-loader: unchanged.
