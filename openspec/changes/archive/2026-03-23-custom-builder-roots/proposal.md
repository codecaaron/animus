## Why

The chain walker hardcodes `"animus"` as the only valid root identifier for primary builder chains (`chain_walker.rs:161`). Custom builder instances created via `createAnimus().addGroup(...).build()` and bound to any other name (e.g., `custom`, `ds`, `ui`) are silently ignored by extraction — no bail, no warning, just invisible.

This breaks the "design your own language" story. `createAnimus()` is a first-class API for defining custom prop vocabularies, but the extraction pipeline can't see them.

The fix: the chain PATTERN (recognized methods + terminal) is sufficient to identify a builder chain. The root identifier name is irrelevant. Any chain that walks backwards from `.asElement()` through recognized chain methods to ANY identifier is a valid primary chain.

## What Changes

- **Remove `"animus"` name check in chain walker**: Accept any root identifier as a valid primary chain root when the chain contains recognized chain methods and a valid terminal.
- **Distinguish primary vs extension by method pattern, not root name**: A chain with `.extend()` is an extension chain (existing behavior). A chain WITHOUT `.extend()` is a primary chain (currently requires root == `"animus"`, changed to accept any root).
- **Showcase validation**: The custom vocabulary components in the showcase should extract to static CSS after this change.

## Capabilities

### New Capabilities
_None — this enables existing extraction for a pattern the runtime already supports._

### Modified Capabilities
- `rust-extraction-pipeline`: Chain walker accepts any root identifier for primary chains, not just `"animus"`.

## Impact

- **`packages/extract/src/chain_walker.rs`**: Remove `"animus"` root name check (~5 lines)
- **`packages/extract/tests/canary.test.ts`**: Add test for custom-root chain extraction
- **`packages/showcase/`**: Custom vocabulary components extract to static CSS, eliminating Emotion runtime fallback
