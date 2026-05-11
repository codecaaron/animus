## Why

The active `bun-workspace` spec asserts that `bun install` produces a `bun.lockb` lockfile, but the pinned Bun version (`.tool-versions: bun 1.3.11`) emits `bun.lock` (text format). This is a factual erratum in the spec, not a capability change. Correcting it brings normative claims in line with observable reality before the `next` branch merges to `main`, so future readers and audits aren't misled.

## What Changes

- Replace 5 occurrences of `bun.lockb` with `bun.lock` in `openspec/specs/bun-workspace/spec.md` (the active spec)
- Replace 1 occurrence of `bun.lockb` with `bun.lock` in root `CLAUDE.md`
- No code changes, no behavior changes, no breaking changes
- Archived `openspec/changes/archive/*/` references are NOT rewritten (historical record per the legacy/openspec convention)

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bun-workspace`: Requirement assertions about the lockfile artifact name are updated to reflect actual bun output (`bun.lock` rather than `bun.lockb`). No requirements are added or removed; only the noun referring to the lockfile file is corrected.

## Impact

- Documentation/spec-only change
- Active spec: `openspec/specs/bun-workspace/spec.md`
- Root user instructions: `CLAUDE.md`
- Zero runtime, build, test, or CI effect
- Knip / vp / oxlint behavior unchanged
