## 1. Pre-flight grounding

- [x] 1.1 Confirm canonical `openspec/specs/rolldown-build/spec.md` contains the 3 requirements being modified. Run: `grep -F "### Requirement:" openspec/specs/rolldown-build/spec.md`. DONE when output includes "Rolldown as library bundler", "Shared Rolldown base config", and "Binding to orchestration-architecture".
- [x] 1.2 Confirm `vite.config.ts run.tasks` already contains `build:ts` task per `migrate-orchestrator-to-vp-run` closure. Run: `grep -F "'build:ts':" vite.config.ts`. DONE when the entry exists.
- [x] 1.3 Confirm root `package.json scripts` does NOT contain a `build:ts` script (already migrated). Run: `grep -F '"build:ts":' package.json`. DONE when no match.
- [x] 1.4 Confirm `tsdown.config.base.ts` is the current shared base. Run: `test -f tsdown.config.base.ts && echo OK`. DONE when output is `OK`.
- [x] 1.5 Confirm legacy package paths (`packages/core`, `packages/theming`, `packages/ui`) are absent from active tree. Run: `test -d packages/core || echo absent; test -d packages/theming || echo absent; test -d packages/ui || echo absent`. DONE when all three report `absent`.
- [x] 1.6 Confirm vp 0.1.20 is the installed version (pre-GA). Run: `grep -F '"vite-plus": "0.1.20"' package.json`. DONE when match found.

## 2. Spec MODIFIED delta verification

The 3 MODIFIED requirement blocks in `specs/rolldown-build/spec.md` were authored by the propose phase. This section verifies header exact-match with canonical so `openspec archive` will apply cleanly.

- [x] 2.1 Confirm MODIFIED block 1 header matches canonical exactly. Run: `grep -F "### Requirement: Rolldown as library bundler" openspec/specs/rolldown-build/spec.md openspec/changes/rebind-build-dispatch-via-vp-run/specs/rolldown-build/spec.md`. DONE when the header appears in BOTH files.
- [x] 2.2 Confirm MODIFIED block 2 header matches canonical exactly. Run: `grep -F "### Requirement: Shared Rolldown base config" openspec/specs/rolldown-build/spec.md openspec/changes/rebind-build-dispatch-via-vp-run/specs/rolldown-build/spec.md`. DONE when the header appears in BOTH files.
- [x] 2.3 Confirm MODIFIED block 3 header matches canonical exactly. Run: `grep -F "### Requirement: Binding to orchestration-architecture" openspec/specs/rolldown-build/spec.md openspec/changes/rebind-build-dispatch-via-vp-run/specs/rolldown-build/spec.md`. DONE when the header appears in BOTH files.
- [x] 2.4 Confirm 2 unchanged requirements are NOT in the delta (would corrupt MODIFIED semantics). Run: `grep -F "### Requirement: No Babel in build pipeline" openspec/changes/rebind-build-dispatch-via-vp-run/specs/rolldown-build/spec.md && echo LEAK || echo CLEAN`. DONE when output is `CLEAN`. Repeat for "Build output equivalence". DONE when both report `CLEAN`.
- [x] 2.5 Confirm delta file uses the canonical `## MODIFIED Requirements` header (not `## ADDED Requirements` or other). Run: `grep -E "^## (MODIFIED|ADDED|REMOVED|RENAMED) Requirements" openspec/changes/rebind-build-dispatch-via-vp-run/specs/rolldown-build/spec.md`. DONE when output is exactly `## MODIFIED Requirements` (single match).

## 3. Validation gate

- [x] 3.1 Run `openspec validate rebind-build-dispatch-via-vp-run --strict`. DONE when output reports `Change 'rebind-build-dispatch-via-vp-run' is valid`.
- [x] 3.2 Run `openspec status --change rebind-build-dispatch-via-vp-run --json | jq '.applyRequires'`. DONE when output is `["tasks"]` (single dependency).
- [x] 3.3 Run `openspec status --change rebind-build-dispatch-via-vp-run --json | jq '.artifacts | map(select(.status != "done")) | length'`. DONE when output is `0` post-tick (all artifacts done).

## 4. Final state-sync

- [x] 4.1 Tick all completed tasks in this file using `- [x]`. DONE when no `- [ ]` checkboxes remain in this file.
- [x] 4.2 Run `openspec status --change rebind-build-dispatch-via-vp-run`. DONE when output shows all artifacts done and `applyRequires` satisfied.
- [x] 4.3 Hand off for archive: `openspec archive rebind-build-dispatch-via-vp-run --yes`. DONE when archive applies the 3 MODIFIED blocks to canonical `rolldown-build/spec.md` (`Totals: + 0, ~ 3, - 0, → 0`) AND the change directory moves to `openspec/changes/archive/YYYY-MM-DD-rebind-build-dispatch-via-vp-run/`.

## 5. Post-archive verification

- [x] 5.1 Run `openspec list --json` and confirm `rebind-build-dispatch-via-vp-run` is no longer active. DONE when not present in active list.
- [x] 5.2 Run `openspec validate rolldown-build --strict`. DONE when output reports `Specification 'rolldown-build' is valid`.
- [x] 5.3 Confirm canonical spec contains the refreshed package list. Run: `grep -F "packages/system" openspec/specs/rolldown-build/spec.md`. DONE when match found.
- [x] 5.4 Confirm canonical spec NO LONGER contains stale legacy package references. Run: `grep -E "packages/(core|theming|ui)" openspec/specs/rolldown-build/spec.md && echo STALE || echo CLEAN`. DONE when output is `CLEAN`.
- [x] 5.5 Confirm `archive/YYYY-MM-DD-rebind-build-dispatch-via-vp-run/` directory exists. Run: `ls openspec/changes/archive/ | grep rebind-build-dispatch-via-vp-run`. DONE when match found.
- [x] 5.6 Sanity check: run `vp run verify` (fast gate) to confirm baseline holds. DONE when composite passes (lint + compile + types + unit:ts + unit:rust + canary).
