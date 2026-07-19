## Why

The selector integration matrix is already governed and passing, so RepoWise's decisionless-hotspot lead is false. However, stale comments still label fixed regressions as broken, and the v1 unresolved-alias test does not prove the compatibility behavior it describes. Tightening those oracles will make the test surface truthful without changing either extraction engine.

## What Changes

- Replace stale current-bug language with historical regression context while preserving active acceptance coverage.
- Explicitly assert v1's raw unresolved-alias passthrough and distinguish v2's intentional drop-and-warn behavior.
- Clarify the governing selector fixture-matrix requirement's broken-to-fixed lifecycle.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `pipeline-integration-testing`: Clarify lifecycle and engine-local oracle requirements for selector regression fixtures.

## Impact

The change affects one integration test, selector fixture comments, the existing pipeline-integration-testing requirement, and OODA planning evidence. It changes no public API, production extractor code, dependency, build artifact, or deployment surface.
