# Increment 01: share V1 component liveness

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/reconciler.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after RepoWise risk/context evidence exposed a bounded parity
> policy seam in a clean Rust file with no active-change overlap.

## Context Capsule

- **Objective**: Make actual and prospective component elimination share one
  private rendered-or-parent predicate. Add a behavior matrix first. Preserve
  every public/report/caller/runtime boundary and every dirty increment.
- **Verified finding disposition**: the broader nested-complexity lead is real
  but too large for this increment. The duplicated liveness condition is a
  narrower valid risk because canonical `css-reconciler` requires dev/build
  agreement. Cross-engine sharing is a false-positive direction.
- **Live call path**: `project_analyzer.rs` calls `reconcile()` in production
  and `identify_prospective_eliminations()` in dev. Both currently eliminate
  only bindings absent from rendered components and provenance parents.
- **Current mapping**: unrendered/non-parent → eliminate/report; rendered →
  keep; unrendered/parent → keep. Actual details use `kind: "component"`;
  prospective details use `kind: "prospective_component"`.
- **Existing contracts**: canonical `css-reconciler`, `usage-ledger`, and
  `project-analyzer`; fourteen local reconciler units; canary and integration.
- **Decisions**: D1 one private predicate; D2 characterization-first GREEN; D3
  public/report boundaries unchanged; D4 V1-only with V2 hash protection.
- **North Star**: NS1 path agreement; NS2 one private policy; NS3 report/order
  compatibility; NS4 runtime boundaries stable; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Read-only Git inspection is required. Do
  not write outside the declared footprint plus this packet's completion
  fields. Never edit design/tasks/journal/specs, V2, Cargo manifests, callers,
  public signatures, report types, dependencies, or integration fixtures.

## Plan

### Task 01.1: Characterize actual/prospective parity first

- [x] Run the existing reconciler unit baseline:

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml reconciler::tests --lib
  ```

- [x] Add `actual_and_prospective_component_liveness_match` after
  `prospective_elimination_kind_distinguishes_from_actual`. Build three
  components in input order: `Ghost`, `Rendered`, and `Parent`; mark only
  `Rendered` as rendered and only `Parent` as a provenance parent. Compare the
  binding list selected by prospective details with actual component details,
  assert both are exactly `["Ghost"]`, and assert actual reconciliation retains
  `Rendered` then `Parent`.
- [x] Run the focused test before production editing and record the honest
  pure-refactor baseline: GREEN against the duplicated conditions.

### Task 01.2: Share the private predicate

- [x] Add this helper beside `extract_binding()`:

  ```rust
  fn should_eliminate_component(
      binding: &str,
      ledger: &UsageLedger,
      parent_components: &FxHashSet<String>,
  ) -> bool {
      !ledger.rendered_components.contains(binding)
          && !parent_components.contains(binding)
  }
  ```

- [x] Replace only the two raw liveness conditions with calls to the helper.
  Do not change loops, reason strings, detail construction, counts, ordering,
  public signatures, or callers.
- [x] Rerun the focused characterization and the full reconciler unit module.

### Task 01.3: Format, verify, and self-review

- [x] Run manifest-wide formatting read-only. If it reports the known ambient
  drift, verify no formatter hunk begins in the changed helper/test ranges and
  do not format unrelated files.
- [x] Run G1-G5. Any STOP trip halts the increment.
- [x] Run G6 in order, applying only exact printed prerequisites.
- [x] Run `git diff --check`; inspect only the target diff; confirm it contains
  the behavior matrix, one private predicate, and two call replacements.
- [x] Update only this packet's completion fields with exact evidence, proposed
  journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public reconciler/caller boundary — result: verbatim diff/`rg` check
  exited 0 with empty output.
- [x] G2: one private predicate/two calls/no raw duplicate — result: verbatim
  checks found definition count 1, total occurrence count 3, and no raw
  multiline condition.
- [x] G3: cross-path liveness characterization — result: focused test passed,
  1 passed, 0 failed, 274 filtered out.
- [x] G4: V2 usage-facts hash — result:
  `40e83a51d20934e23dd76c964a0f7c6240ab27e0bfec77051ba675d852a95503`.
- [x] G5: protected dirty-diff hash — result:
  `790381181ccb772cf595c0fb3914de5fa0e79036a6563b534f834495f5294d46  -`.
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: Clippy exited 0;
  Rust units passed 275 + 8 + 348 with 1 ignored; canary initially failed loud
  on the expected stale NAPI binary, `vp run build:extract` exited 0, and the
  rerun passed 200/200; integration passed 157/157 across 11 files.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. Baseline reconciler module was GREEN at 14/14.
  The named characterization was GREEN before production editing and after the
  rewrite; the final reconciler module was GREEN at 15/15. The target diff is
  limited to the behavior matrix, one private helper, and two call replacements;
  `git diff --check` exits 0.

### Proposed journal entries

- Friction: manifest-wide `cargo fmt -- --check` still reports known ambient
  Rust drift. No read-only formatter hunk begins in the changed helper/test
  ranges after locally aligning those ranges; unrelated files were not written.
- Surprise: none. The cross-path characterization stayed GREEN before and after
  centralizing the existing predicate.

### Surfaced variables (spawn candidates)

- `ambient-rustfmt-drift`: candidate for a separately authorized cleanup
  increment; intentionally unchanged here.

## Spec authorship checklist (orchestrator)

- [x] Confirmed §arch-extract-v1-reconciler-liveness/Shared private component-liveness policy remains authored and leakage-clean
- [x] Confirmed no Decision Ledger row resolves in this increment
- [x] Appended accepted journal entries attributed via inc 01 subagent
- [x] Reorientation entry written with the full three-stance pass (K=1)
- [x] Ticked registry row 01 with the reorientation timestamp
