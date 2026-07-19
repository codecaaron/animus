## Why

`project_analyzer.rs` is the repository's highest-risk health outlier, but its
V1 oracle behavior is extensively governed and cannot tolerate a speculative
rewrite. Phase 2 static-value enrichment is a cohesive, specified block still
embedded inside the 1,198-line `analyze()` method; extracting that one private
phase creates a testable ownership seam while preserving every runtime and ABI
contract.

## What Changes

- Give V1 Phase 2 static-value enrichment one private in-file helper.
- Add a direct Rust contract for local, imported, aliased, and keyframe-bound static values.
- Preserve the existing Phase 2 timing envelope and all black-box extraction behavior.

## Capabilities

### New Capabilities

- `arch-extract-v1-phase-seams`: Executable architectural constraints for extracting cohesive V1 analyzer phases without changing the engine boundary.

### Modified Capabilities

None; existing semantic-const and keyframe behavior is preserved rather than changed.

## Impact

- Affected code: `packages/extract/src/project_analyzer.rs` only.
- Affected tests: Rust unit coverage in the same module plus existing NAPI/integration oracles.
- Public APIs, manifests, dependencies, V2, and shared-loader code: unchanged.
