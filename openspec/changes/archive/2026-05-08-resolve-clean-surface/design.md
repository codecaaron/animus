## Context

This is the cleaning-surface slice of the vp-arc decomposition (per `orchestration-architecture/spec.md` Requirement "Follow-On Policy Decomposition", line 156: "A change rebinding (or explicitly preserving shell) the cleaning surface"). Five slices have shipped before this proposal; with this slice closed, only the bundler slice (`migrate-build-to-vp-pack`) remains.

Current state at proposal time:

- Root `package.json` `scripts` contains 3 cleaning entries — all dispatch `rm -rf` commands:
  - `clean: rm -rf packages/*/dist packages/extract/target`
  - `clean:light: rm -rf node_modules/.vite packages/*/dist`
  - `clean:full: rm -rf node_modules/.vite packages/*/dist packages/extract/target packages/extract/*.node`
- Root `package.json` `rebuild` script chains: `bun run clean:full && vp run build:all`.
- No per-package `clean` scripts exist; cleaning is a root-level concern.
- vp does NOT provide a built-in `clean` command (verified via `bunx vp clean` → `Command 'clean' not found`).
- `build-orchestration/spec.md` Requirement "Clean command" mandates the script live in root `package.json` — needs MODIFIED to reflect new invocation surface.

Constraints (from `orchestration-architecture/spec.md` and `build-orchestration/spec.md`):

- Cleaning behavior SHALL be preserved exactly (same `rm -rf` paths).
- Loud-fail invariants do NOT apply (clean tiers are not verification atomic tiers; preconditions don't fire).
- `.tool-versions` bun pin SHALL be preserved.
- The CLAUDE.md dispatch convention ("`bun run <migrated-name>` returns 'script not found' by design — there is no transparent alias") SHALL be honored.

Stakeholders: codecaaron (sole repository maintainer; Risk Acceptance signed via session-explicit directive on this proposal).

## Goals / Non-Goals

**Goals:**

- Move the 3 clean-related dispatch entries from root `package.json` `scripts` to `vite.config.ts` `run.tasks`, completing the convergence on vp run as the canonical orchestrator surface.
- Preserve cleaning behavior byte-for-byte (same `rm -rf` paths).
- Update the `rebuild` chained script to keep working post-migration (`vp run clean:full && vp run build:all`).
- Update `build-orchestration/spec.md` Requirement "Clean command" to reflect the new invocation surface.
- Update `CLAUDE.md` dispatch-convention line to remove `clean*` from the "unmigrated scripts" list.

**Non-Goals:**

- Introducing a vp-native cleaning capability (vp does not provide one; this proposal is a dispatch rebind, not a tool replacement).
- Changing what gets cleaned — preserved exactly.
- Adding per-package `clean` scripts (they don't exist; introducing them would expand scope).
- Migrating other unmigrated scripts (`compile`, `verify:compile:tsc-fallback`, `dev:showcase`, `release`) — each is its own follow-on slice.
- Renaming the `clean` / `clean:light` / `clean:full` task identities.

## Decisions

### Decision 1: `rm -rf` is preserved as the cleaning mechanism

**Rationale**: vp does NOT provide a built-in `clean` command. The arc's job is dispatch-rebinding, not cleaning-mechanism redesign. Wrapping the existing `rm -rf` commands in vp run tasks preserves behavior exactly while completing the orchestrator-surface convergence.

**Alternatives considered**:

- Add a vp-native cleaning helper: rejected (out of scope; the upstream tool doesn't ship one).
- Use a Node-level cleaning library (e.g., `rimraf`): rejected (introduces a runtime dependency for a 3-line shell op; misaligned with bun-native repo philosophy).
- Rely on per-package clean scripts via `bun run --filter`: rejected (root cleaning targets are repo-level, not package-level; would expand scope to add scripts to ~10 packages).

### Decision 2: Per-package `clean` scripts are NOT introduced

**Rationale**: The current convention is root-only cleaning (no per-package `clean` scripts exist). Introducing per-package scripts would expand the migration surface, shift the cleaning-surface ownership model, and require new orchestration-architecture invariants. This proposal preserves the existing root-only model.

### Decision 3: `package.json` clean scripts are DELETED (not preserved as forwarding wrappers)

**Rationale**: Per the CLAUDE.md dispatch convention: "Dispatch: vp run X is the canonical and only invocation path for every migrated tier ... bun run <migrated-name> returns 'script not found' by design — there is no transparent alias." Preserving the `package.json` entries as forwarding wrappers would violate the convention.

### Decision 4: The `rebuild` script is UPDATED (not deleted)

**Rationale**: `rebuild` is a developer-convenience composite (`clean:full && build:all`) that doesn't have a vp run equivalent. Keeping it in `package.json` preserves the convenience while updating its internals to use vp run for both halves of the chain.

### Decision 5: `build-orchestration/spec.md` Requirement "Clean command" is MODIFIED, not REMOVED

**Rationale**: The cleaning capability still exists; only its invocation surface changes. MODIFIED preserves the requirement's history while updating its body and scenario to reflect the new invocation.

## Risks / Trade-offs

**Risk 1**: Developers' muscle memory `bun run clean` returns "script not found" post-migration; could surprise.

- **Mitigation**: This IS the documented dispatch convention from CLAUDE.md (already established by prior slices for `verify:*` tasks). Surprise is one-time and self-documenting.

**Risk 2**: A future change adding per-package `clean` scripts could conflict with the root-level migration.

- **Mitigation**: This proposal does NOT introduce per-package clean; if a future change wants to, it MUST address the integration with root-level clean explicitly.

**Risk 3**: vp run dispatch overhead may make `clean` slightly slower than direct `rm -rf`.

- **Mitigation**: `rm -rf` runtime is dominated by filesystem I/O, not process startup; the dispatch overhead is negligible vs typical clean times. Smoke-tested in tasks.md §6.

## Migration Plan

The migration is reversible per the proposal's Risk Acceptance section. Order of operations within the change application:

1. **Pre-flight grounding** (§1 of tasks.md): capture baseline.
2. **vite.config.ts run.tasks additions** (§2): add 3 entries with byte-identical commands.
3. **Root package.json edits** (§3): delete 3 clean scripts; update `rebuild`.
4. **Spec MODIFIED apply** (§4): authored in this change's `specs/build-orchestration/spec.md` delta.
5. **CLAUDE.md edits** (§5): remove `clean*` from the dispatch-convention parenthetical.
6. **Verification gate** (§6): run change-type-map verify-set + smoke test.
7. **Spec validation** (§7): `openspec validate resolve-clean-surface --strict`.
8. **Final state-sync** (§8): tick all tasks; status-confirm; archive.
9. **Post-archive verification** (§9): canonical strict-valid; archive dir exists.

**Rollback strategy**: a single `git revert <merge-commit>` restores the 3 `package.json` clean scripts, removes the 3 vite.config.ts run.tasks entries, restores the `rebuild` script, and reverts the spec MODIFIED block.

## Open Questions

None.
