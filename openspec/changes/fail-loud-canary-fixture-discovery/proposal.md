## Why

The extraction canary silently converts missing or unreadable real-document fixture paths into an empty or partial corpus, delaying the failure until unrelated component-count or snapshot assertions. Failing at discovery preserves the actual filesystem diagnostic and keeps the canary's evidence honest.

## What Changes

- Make real-document fixture discovery propagate filesystem errors.
- Add a regression proving a nonexistent configured root fails before extraction.
- Preserve the current fixture roots, ignored directories, snapshots, and production extractor.

## Capabilities

### New Capabilities

- `canary-fixture-discovery`: Defines fail-loud discovery of the checked-in real-document corpus used by the NAPI canary.

### Modified Capabilities

None.

## Impact

The implementation affects only `packages/extract/tests/canary.test.ts`; there are no public API, dependency, build-output, runtime, or deployment changes.
