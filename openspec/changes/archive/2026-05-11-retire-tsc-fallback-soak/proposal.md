## Why

The `adopt-typescript-7-tsgo` migration shipped a soak-window fallback (`verify:compile:tsc-fallback` + per-package `compile:tsc-fallback` + `typescript@6.0.3` devDep) to enable ad-hoc parity checks while `tsgo` baked. Tsgo has been stable for the full soak window and the implementation cleanup landed in commit 6c7475b ("Down") on branch `next`: the 8 per-package fallback scripts, the root verify orchestrator, the redundant root `compile` workspace-filter alias, and the `typescript@6.0.3` devDep are all removed. This change reconciles `bun-workspace/spec.md` to reflect the post-cleanup state of root `package.json` scripts.

## What Changes

**Spec amendments** (no code changes — code shipped in 6c7475b):

- `bun-workspace` — MODIFIED on Requirement "Simplified root scripts" — remove three now-defunct scripts from the unmigrated-tasks paragraph and the "Root script inventory" scenario: `compile` (workspace-filter ad-hoc alias), `compile:tsc-fallback`, and `verify:compile:tsc-fallback` (soak-window fallback set).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bun-workspace`: tightens Requirement "Simplified root scripts" to drop references to three retired scripts; preserves the migrated/unmigrated split invariant and all other unmigrated-task references unchanged.

## Impact

**Affected code**: none — this change is post-fact spec reconciliation against work already shipped in commit 6c7475b.

**Affected dependencies**: none — `typescript@6.0.3` removal landed in the prior commit.

**Affected systems**:

- `bun-workspace/spec.md` Requirement "Simplified root scripts" — paragraph and one scenario tightened.
- No other specs touched. See `design.md` § "Specs assessed but not amended" for justification on `typescript-toolchain/spec.md` non-amendment.

**Verification tier set per Change-Type Map**: this touches only `openspec/specs/**`. Per `CLAUDE.md` Change-Type Map: "openspec/** — use `openspec validate <change>` instead". No `vp run verify` tier required.

**Reversibility**: trivial via spec re-edit (single MODIFIED block).
