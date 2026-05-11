## Why

The animus monorepo's vp-arc decomposition (per `orchestration-architecture/spec.md` lines 150-156) names five cutover slices. Four shipped before this proposal: `migrate-lint-to-vp-check`, `migrate-orchestrator-to-vp-run`, `migrate-hygiene-cascade-to-oxlint`, `finalize-biome-to-oxlint-residue`, and `migrate-test-to-vp-test`. This proposal closes the **cleaning surface** slice — the line in the spec reading "A change rebinding (or explicitly preserving shell) the cleaning surface."

The slice is the lowest-risk in the arc: it just dispatches `rm -rf` commands. Behavior is preserved exactly; only the invocation surface changes from `bun run clean*` to `bunx vp run clean*`, completing the convergence on the single-orchestrator-surface invariant. After this slice ships, only the library bundler slice (`migrate-build-to-vp-pack`) remains, which has architectural depth deferred to a focused follow-on session.

## What Changes

**Cleaning surface rebind** (preserves all cleaning behavior):

- ADD 3 entries to `vite.config.ts` `run.tasks`: `clean`, `clean:light`, `clean:full` — each with the existing `rm -rf` command verbatim.
- DELETE 3 corresponding entries from root `package.json` `scripts`. Per the CLAUDE.md dispatch convention, `bun run <migrated-name>` returns "script not found" by design — explicit failure, not silent breakage.
- UPDATE root `package.json` `rebuild` script: `bun run clean:full && vp run build:all` → `vp run clean:full && vp run build:all` (the chained `bun run clean:full` won't work post-deletion).
- Update `CLAUDE.md` dispatch-convention line to remove `clean*` from the "unmigrated scripts" list.

**Spec updates**:

- `build-orchestration` — MODIFIED on Requirement "Clean command" (invocation surface: `bun run clean` → `bunx vp run clean`; behavior preserved).
- `orchestration-architecture` — NO MODIFY (the rebind succeeds under preservation invariants without spec-text change).

No breaking changes to what gets cleaned. No new vp-native cleaning capability introduced — vp does NOT provide a built-in `clean`; this slice WRAPS the existing `rm -rf` invocations under the orchestrator's task graph.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-orchestration`: rebind cleaning-surface invocation from root `package.json` `clean*` scripts to `vite.config.ts` `run.tasks` clean tasks; preserve cleaning targets and behavior; update Requirement "Clean command" scenarios to reference `bunx vp run clean` invocation.

## Impact

**Affected code**:

- `vite.config.ts` (3 new run.tasks entries)
- Root `package.json` (3 script deletions + 1 script update)
- `build-orchestration/spec.md` (1 MODIFIED requirement)
- `CLAUDE.md` (dispatch-convention line update)

**Affected dependencies**: None.

**Affected systems**:

- Local cleaning invocation: `bun run clean` / `bun run clean:light` / `bun run clean:full` → `bunx vp run clean` / `bunx vp run clean:light` / `bunx vp run clean:full`.
- CI: no changes (CI does not invoke clean tiers).
- The chained `rebuild` script is updated in-place to keep working post-migration.

**Verification tier set per Change-Type Map**: this touches `vite.config.ts` run.tasks + a spec + CLAUDE.md. Recommended set: `verify:lint && verify:compile && verify` plus an explicit smoke test (`bunx vp run clean:light` removes dist, rebuild restores).

## Risk Acceptance

This proposal is gated by `orchestration-architecture/spec.md` Requirement "Migration Trigger Criteria" Scenario "Pre-GA cutover requires risk-acceptance" because vite-plus 0.1.20 has not reached GA per the VoidZero release channel.

**Specific alpha-status exposure for this cutover slice**:

- This is the LOWEST-risk slice in the arc — it dispatches `rm -rf` commands unchanged through the vp orchestrator.
- The only failure mode introduced by the rebind is `bun run clean*` returning "script not found" — an explicit failure mode, not silent breakage.
- vp run task dispatch is already proven by four prior shipped slices (`migrate-lint-to-vp-check`, `migrate-orchestrator-to-vp-run`, `migrate-hygiene-cascade-to-oxlint`, `migrate-test-to-vp-test`) — the dispatch surface itself is not the new variable here.

**Mitigations**:

1. **Behavioral identity**: `rm -rf` commands are byte-identical between the old `package.json` scripts and the new `vite.config.ts run.tasks` entries; what gets cleaned is preserved exactly.
2. **Reversibility**: localized edits to `vite.config.ts` + root `package.json` + one spec + one doc line; revertable via a single revert-commit.
3. **Smoke test**: §6 of tasks.md gates archive on `bunx vp run clean:light` + rebuild round-trip, empirically validating the dispatch surface works.
4. **Explicit failure on muscle memory**: developers running `bun run clean` post-migration get `script not found` (CLAUDE.md dispatch convention) — no silent skip, no partial cleaning, no degraded state.

**Maintainer sign-off**: codecaaron (repository maintainer) authorized this slice via session-explicit directive ("clean service is probably the RM ... I would like to to get all of the the RMR like anything that we're doing standard and and wonky in our package.json like I that should be clean at the like at the baseline"), accepting alpha-status risk as a known-and-acceptable tradeoff given the slice's minimal exposure.

This signed risk acceptance satisfies pre-GA Criterion B per `orchestration-architecture/spec.md` Requirement "Migration Trigger Criteria".
