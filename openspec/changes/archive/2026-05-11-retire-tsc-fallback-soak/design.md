## Context

This change closes the lifecycle of the `adopt-typescript-7-tsgo` soak-window fallback. The implementation cleanup shipped in commit 6c7475b ("Down") on branch `next`:

- 8 per-package `compile:tsc-fallback` scripts removed
- Root `verify:compile:tsc-fallback` script removed
- Root `compile` script removed (redundant with `vp run verify:compile`)
- `typescript@6.0.3` devDep removed
- CLAUDE.md prose tightened (TypeScript Implementations table area + dispatch convention line)
- `scripts/verify/dts-parity.sh` retained as re-runnable methodology encoder

`openspec/specs/bun-workspace/spec.md` Requirement "Simplified root scripts" still lists those scripts as live unmigrated entries — drift introduced by the prior commit, now closed by this change.

Stakeholders: codecaaron (sole maintainer; already committed the implementation work; explicitly directed "propose as a change and close it out").

## Goals / Non-Goals

**Goals:**

- Reconcile `bun-workspace/spec.md` Requirement "Simplified root scripts" to the post-commit state of root `package.json` `scripts` with respect to the three scripts retired by 6c7475b (`compile`, `compile:tsc-fallback`, `verify:compile:tsc-fallback`).
- Preserve every other invariant in the requirement (migrated/unmigrated split, the inventory scenario shape, the bun-native operations rule, the no-yarn/npx/nx/lerna/jest rule).

**Non-Goals:**

- Reconciling other unrelated drift in the same requirement. The unmigrated-tasks paragraph still lists `clean*` as unmigrated (migrated by `resolve-clean-surface`) and `lint`/`format`/`check`/`check:fix` as biome wrappers (migrated to oxlint by `migrate-hygiene-cascade-to-oxlint`). These are pre-existing drift not introduced by 6c7475b; reconciling them belongs in a separate follow-on change so each historical migration owns its own spec-sync.
- Amending `typescript-toolchain/spec.md`. See § Decisions below for the rationale.
- Touching code, CLAUDE.md, or other docs — those edits shipped in 6c7475b.

## Decisions

### Decision 1: Only the tsc-fallback-introduced drift is fixed in this change

**Rationale**: The proposal frames this as "post-soak spec amendment closing out the tsc-fallback lifecycle." Narrowing the MODIFIED block to ONLY the tsc-fallback references keeps the change's identity tight and matches commit 6c7475b's authored scope. Each unrelated drift item came from a different shipped change and should be reconciled in its own follow-on for traceability.

**Alternatives considered**:
- Wide scope (reconcile all unmigrated-list drift in one MODIFIED block): rejected. The change's identity becomes "audit and reconcile multiple migrations' spec-sync oversights" which is a different change. Would need a different name and richer proposal framing.
- Defer entirely (don't ship retire-tsc-fallback-soak; bundle into a future audit change): rejected. The user explicitly asked to close out this work; deferring contradicts the user's directive.

### Decision 2: `typescript-toolchain/spec.md` is NOT amended

**Rationale**: Two requirements in that spec touch the soak conceptually, but neither is wrong post-cleanup:

- **Requirement "Soak Path for Type-Check Implementation Swaps"** (lines 103-130 of `typescript-toolchain/spec.md`) is GENERIC future-migration policy. The phrase "e.g., `verify:compile:tsc-fallback`" is an illustrative example, not a claim of current state. The policy still applies to any future canonical type-check swap.
- **Requirement "Version Pinning Policy"** (lines 61-80) is bifurcated: the generic policy ("canonical TypeScript implementations SHALL be exact-pinned") still applies to `@typescript/native-preview`. The typescript-specific bullet ("`typescript`: the JavaScript reference compiler used for declaration emit") is dormant — typescript is not currently installed — but the conditional rule fires if typescript is reinstalled. The scenario "TypeScript version is exact-pinned" is vacuously satisfied (no typescript = no version to validate). Leaving the conditional policy in place preserves the constraint that if/when typescript returns to devDeps, it must be exact-pinned.

### Decision 3: `dts-parity.sh` is preserved (not edited, not deleted)

**Rationale**: Per the prior commit, `scripts/verify/dts-parity.sh` is retained as re-runnable scaffolding. The `typescript-toolchain/spec.md` Scenario "dts-parity.sh is reusable" still describes the script's behavior accurately. No spec change needed.

## Risks / Trade-offs

**Risk 1**: The narrow scope leaves known drift in place (`clean*`, biome wrappers, `rebuild` placement). A reader of the spec post-archive may assume the entire unmigrated list is accurate.

- **Mitigation**: This design.md documents the known drift explicitly. A follow-on change can address the remaining drift; archiving this change does not regress accuracy on any axis — it strictly improves the spec by removing 3 stale references.

**Risk 2**: A future migration could touch this requirement again before the follow-on drift-fix ships, requiring careful MODIFIED merging.

- **Mitigation**: openspec MODIFIED semantics replace full content; sibling order matters. Future migrations editing this requirement will see the post-retire-tsc-fallback-soak state as canonical and apply their delta from there.

## Migration Plan

This change is spec-amendment-only. No code, no config, no dependency changes. Order of operations within the change application:

1. **Pre-flight grounding** (§1 of tasks.md): verify commit 6c7475b is in HEAD history, root pkg.json contains no `compile`/`compile:tsc-fallback`/`verify:compile:tsc-fallback`, per-package files contain no `compile:tsc-fallback`, current bun-workspace/spec.md still contains the stale references.
2. **Spec MODIFIED authoring** is already done in this change's `specs/bun-workspace/spec.md` delta.
3. **Validation gate** (§2 of tasks.md): `openspec validate retire-tsc-fallback-soak --strict` must pass.
4. **Final state-sync + archive** (§3): tick all tasks; archive via openspec-archive-change skill; fall back to `--skip-specs` + manual Edit if archive aborts on MODIFIED per the known `feedback_openspec_archive_modified_workaround` memory.
5. **Post-archive verification** (§4): confirm canonical `bun-workspace/spec.md` no longer contains the 3 retired script names; archive directory exists at `openspec/changes/archive/YYYY-MM-DD-retire-tsc-fallback-soak/`.

**Rollback strategy**: `git revert <merge-commit>` restores the MODIFIED state to the canonical `bun-workspace/spec.md`. Trivial.

## Open Questions

None.
