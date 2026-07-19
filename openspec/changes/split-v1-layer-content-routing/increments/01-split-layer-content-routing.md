# Increment 01: split V1 layer-content routing

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/css_generator.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after RepoWise risk/context evidence exposed a bounded nested
> generator in a clean Rust file with no active-change overlap.

## Context Capsule

- **Objective**: Dispatch layer kind once and move each existing traversal into
  one private emitter. Add an exact private-seam characterization first.
  Preserve callers, CSS bytes/order, runtime, V2, and dirty-tree boundaries.
- **Verified finding disposition**: the six-level nesting lead is valid.
  Structured-sheet refactoring, canonical-spec repair, iterator abstraction,
  and V1/V2 sharing are not licensed by this behavior-preserving increment.
- **Live call path**: `generate_css()` is the sole caller and invokes
  `generate_layer_content()` four times, once per `LayerKind`; rule emission
  flows through `write_rule_block()` and declaration/pseudo/responsive writers.
- **Current mapping**: component order is preserved within every layer; variant
  options follow definition order, a matching default emits a sidecar after
  options, compounds use zero-based indices, and states follow vector order.
- **Existing contracts**: direct Rust CSS tests, NAPI canary/integration CSS
  assertions, variant-sublayer and structured-sheet contracts; independent V2
  `css.rs` compatibility implementation.
- **Decisions**: D1 top-level dispatch; D2 four direct emitters; D3 exact
  characterization-first GREEN plus structural RED; D4 V1-only with V2 hash.
- **North Star**: NS1 exact bytes/order; NS2 explicit ownership; NS3 public CSS
  contracts; NS4 downstream oracles; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Read-only Git inspection is required. Do
  not write outside the declared footprint plus this packet's completion
  fields. Never edit design/tasks/journal/specs, V2, callers, manifests, public
  APIs, dependencies, or integration fixtures.

## Plan

### Task 01.1: Characterize the layer-content matrix first

- [x] Confirm the existing CSS-generator unit baseline is 28/28:

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml css_generator::tests --lib
  ```

- [x] Add test-only construction helpers only if they reduce repetition without
  hiding expected output.
- [x] Add `layer_content_preserves_kind_routing_order_and_selectors`. Use two
  components with base content, ordered variant options, two compounds, and two
  ordered states across the matrix. Make one matching default select a
  non-first option; include both an absent default and an unmatched default that
  emit no sidecar. Assert the exact output string from each of the four
  `LayerKind` calls, including inter-component order, option/default order,
  sidecar omission, and compound indices.
- [x] Run the focused test before production editing and record honest GREEN
  against the nested implementation.
- [x] Run the first three G2 assertions before production editing and record
  honest RED: four helpers/calls and a four-space top-level match do not yet
  exist. Also record that the final G2 search finds the old loop-then-match
  structure.

### Task 01.2: Split dispatch and layer emitters

- [x] Add the four private emitter functions immediately before
  `generate_layer_content()`. Move the existing layer-specific loops and
  selector construction without reordering or generalizing them.
- [x] Keep `generate_layer_content()` as the output allocator. Replace its
  component loop with one exhaustive `match kind` that calls each emitter once.
- [x] Rerun the focused characterization and full CSS-generator module.

### Task 01.3: Format, verify, and self-review

- [x] Run manifest-wide formatting read-only. If known ambient drift remains,
  verify no hunk begins in changed ranges and do not format unrelated files.
- [x] Run G1-G5. Any STOP trip halts the increment.
- [x] Run G6 in order with exact fail-loud remediation only.
- [x] Run `git diff --check`; inspect only the target diff; confirm it contains
  one exact matrix, four private emitters, and one top-level dispatch.
- [x] Update only this packet's completion fields with exact evidence, proposed
  journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public CSS generator boundary — result: verbatim zero-context
  diff/`rg` check exited 0 with empty output.
- [x] G2: four emitters/four calls/one match/no old dispatch — result: final
  checks found definition count 4, total occurrence count 8, four-space match
  count 1, and empty old-dispatch output. Before production editing, the first
  three assertions each exited 1 and the old-dispatch search exited 0 at lines
  491-492.
- [x] G3: exact layer-content matrix — result: focused test passed before and
  after production editing, 1 passed, 0 failed, 278 filtered out.
- [x] G4: V2 CSS hash — result:
  `bc426b39a9c42ac6950a67fb43ec97b052b4bc36b478334ad1e6451d129b2858`.
- [x] G5: protected dirty-diff hash — result:
  `4353bacb030163d6724ad091f33a4bc1a60a9dc9bafb02a8a71e79cf76a8dae7  -`.
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: Clippy exited 0;
  Rust units passed 279 + 8 + 348 with 1 ignored (expanded RepoWise ref
  `f1be7ed1d7aa`); canary initially failed loud on the expected stale NAPI
  binary, `vp run build:extract` exited 0, and the rerun passed 200/200;
  integration passed 157/157 across 11 files.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. Reused the root-provided 28/28 baseline evidence
  (`922cadb70451`) without rerunning or expanding it. The exact matrix was GREEN
  before production editing; the required G2 structural assertions were RED;
  after the rewrite the matrix remained GREEN and the CSS-generator module was
  GREEN at 29/29 (`df97e1c2d93c`). The target diff (`d26311398582`) contains one
  exact matrix, four private direct writers, and one top-level dispatch;
  `git diff --check` exits 0.

### Proposed journal entries

- Friction: manifest-wide `cargo fmt -- --check` still reports known ambient
  Rust drift. No read-only formatter hunk begins in the changed writer/dispatch/
  test ranges after locally aligning those ranges; unrelated files were not
  written.
- Surprise: none. The exact behavior characterization was GREEN while all
  three pre-edit structural assertions were RED as designed.

### Surfaced variables (spawn candidates)

- `ambient-rustfmt-drift`: candidate for a separately authorized cleanup
  increment; intentionally unchanged here.

## Spec authorship checklist (orchestrator)

- [x] Confirm §arch-extract-v1-layer-content-routing/Explicit V1 layer-content routing remains authored and leakage-clean
- [x] Confirm no Decision Ledger row resolves in this increment
- [x] Append accepted journal entries attributed via inc 01 subagent
- [x] Write a reorientation entry with the full three-stance pass (K=1)
- [x] Tick registry row 01 with the reorientation timestamp
