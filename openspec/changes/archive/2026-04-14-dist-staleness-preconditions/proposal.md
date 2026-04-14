## Why

The `verification-tier-policy` capability shipped atomic tiers with fail-loud preconditions, but the precondition contract only enforces staleness for the NAPI binary — every other consumer-facing package `dist/` is checked for **existence** only, not **freshness**. This produces misleading green/red signals whenever a consumer tier (e.g., `verify:build:next`) runs against a stale downstream dist. Directly observed during the apply of `verification-tier-policy`: `verify:build:next` reported green against stale `packages/system/dist/`, then reversed to a type error after explicit rebuild. Generalizing the stale-mtime pattern closes the hole.

## What Changes

- **MODIFIED** Requirement "Atomic Tier Isolation" (in `verification-tier-policy` spec): extend the precondition-accuracy rules so that any tier consuming a downstream package `dist/` SHALL check that dist's freshness against its owning package's `src/**`. Specifically:
  - `verify:integration` preconditions add: fresh `packages/extract/dist/index.mjs` (mtime vs `packages/extract/src/**`) and fresh `packages/system/dist/` (mtime vs `packages/system/src/**`).
  - `verify:build:next` preconditions add: fresh `packages/extract/dist/`, fresh `packages/system/dist/`, fresh `packages/next-plugin/dist/` (each vs its own `src/**`).
  - `verify:build:showcase` preconditions add: fresh `packages/extract/dist/`, fresh `packages/system/dist/`, fresh `packages/vite-plugin/dist/`, fresh `packages/properties/dist/` (each vs its own `src/**`).
- **MODIFIED** Requirement "Shell-Based Fail-Loud Preconditions" (in `verification-tier-policy` spec): require that any dist-staleness check use the same `ls` + `find -newer` pattern as the NAPI binary check (existence AND mtime-comparison against src).
- **ADDED** Requirement "Shared Precondition Helper Library" (in `verification-tier-policy` spec): introduce `scripts/verify/_preconditions.sh` as the single authoritative implementation of all preconditions. Helper exports composable shell functions: `require_bun_install`, `require_fresh_napi`, `require_fresh_package_dist <pkg>`, `require_dir <path> <fix_command>`. Every atomic tier script sources this helper and calls the appropriate functions. Existing inline NAPI mtime logic in 4 scripts moves into the helper.
- **Breaking**: none for consumers; tier fail-loud messages may change wording as they flow through the shared helper. Same shape: `ERROR: X missing/stale. Run: Y`.

## Capabilities

### New Capabilities
<!-- None. This is an amendment to an existing capability. -->

### Modified Capabilities
- `verification-tier-policy`: extends the precondition contract to cover consumer-facing package dists beyond NAPI; adds a shared helper library Requirement as the implementation surface.

## Impact

- **`scripts/verify/_preconditions.sh` (new)**: single file exporting the four helper functions. Sourced by every atomic tier script.
- **`scripts/verify/*.sh` (modified, 11 files)**: each script sources `_preconditions.sh` and replaces inline precondition logic with helper calls. `verify:build:next`, `verify:build:showcase`, and `verify:integration` gain additional `require_fresh_package_dist` calls per the dependency lists above.
- **`openspec/specs/verification-tier-policy/spec.md` (modified)**: two MODIFIED Requirements + one ADDED Requirement per the change's `specs/verification-tier-policy/spec.md` delta.
- **`tasks.md` §11.11** (in the originating `verification-tier-policy` change): this proposal delivers the follow-up captured there; §11.11 can be closed after this merges.
- **No user-facing or published package changes.** Internal tooling only. Affects inner-loop dev + CI run reliability; does NOT affect any consumer of published `@animus-ui/*` packages.
- **Prerequisite**: `verification-tier-policy` must be merged + archived before this proposal's MODIFIED sections can validate against `openspec/specs/verification-tier-policy/spec.md`. Expected sequencing: `verification-tier-policy` merges (CI in flight at time of proposal) → this change validates → implementation → merge → then `legacy-package-archival` and `e2e-workspace-topology` land in their pre-planned order.
