# Increment 01: flatten V1 variant argument routing

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/style_evaluator.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after RepoWise risk/context evidence exposed a bounded nested
> parser in a clean Rust file with no active-change overlap.

## Context Capsule

- **Objective**: Move variant-option collection into one private helper and
  route top-level config through one typed match. Add a direct compatibility
  matrix first. Preserve evaluator, caller, diagnostics, runtime, V2, and
  dirty-tree boundaries.
- **Verified finding disposition**: the seven-level nesting lead is valid.
  Neighboring evaluator refactors, static variant identifiers, states sharing,
  and V1/V2 sharing are not licensed by this behavior-preserving increment.
- **Live call path**: `parse_variant_from_source()` is the sole V1 caller of
  `parse_variant_arg()`; that function calls key and style evaluators and feeds
  chain processing.
- **Current mapping**: string prop/default fields replace defaults; object base
  evaluates once; object variants accumulate ordered option values and skips in
  encounter order; later duplicate options override without moving their key;
  spreads, unknown keys, and wrong-typed known fields are ignored at config-
  routing layers, while spreads inside base/option style objects bail.
- **Existing contracts**: canonical static-evaluation/per-property-bail specs;
  V1 canary/integration; independent V2 `eval.rs` compatibility port.
- **Decisions**: D1 typed tuple match; D2 one mutating option collector; D3
  characterization-first GREEN; D4 V1-only with V2 hash protection.
- **North Star**: NS1 result/skip order; NS2 flat ownership; NS3 error/ignore
  semantics; NS4 public/runtime boundaries; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Read-only Git inspection is required. Do
  not write outside the declared footprint plus this packet's completion
  fields. Never edit design/tasks/journal/specs, V2, callers, manifests, public
  APIs, dependencies, or integration fixtures.

## Plan

### Task 01.1: Characterize the variant compatibility matrix first

- [x] Confirm the existing style-evaluator unit baseline is 38/38:

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml style_evaluator::tests --lib
  ```

- [x] Add test-only `parse_variant_config()` near the existing parse helpers.
  It SHALL parse one object expression and return the direct
  `parse_variant_arg()` result so both success and error paths can be asserted.
- [x] Add `variant_arg_preserves_config_and_skip_order`. Use a config that
  covers explicit prop/default, object base with one skipped property, an
  ignored outer config spread, an ignored variants-container spread, a wrong-
  typed known field, two `variants` fields, an option with one skipped
  property, and a later duplicate option override. Assert exact config fields,
  the ordered option-key vector across both fields, the overridden value, and
  skip keys in encounter order.
- [x] Add `variant_arg_preserves_structural_bails` with independent base-style
  and option-style spread inputs. Assert both return structural errors, keeping
  these style-object spreads distinct from the ignored config-container spreads
  in the success matrix.
- [x] Run both focused tests before production editing and record honest GREEN
  against the nested implementation.

### Task 01.2: Flatten routing and extract option collection

- [x] Add private `collect_variant_options(obj, variants, all_skips)` immediately
  before `parse_variant_arg()`. Guard non-properties with `let ... else`, then
  preserve exact key evaluation, style evaluation, skip extension, and map
  insertion order.
- [x] In `parse_variant_arg()`, replace only the outer `if let` and branch-local
  type checks with a non-property `let ... else` guard and one
  `match (key.as_str(), &p.value)`. Delegate only the object-valued `variants`
  arm to the new helper. Preserve defaults, object evaluation, wildcard
  fallthrough, result construction, signature, caller, and V2.
- [x] Rerun the focused characterization and full style-evaluator module.

### Task 01.3: Format, verify, and self-review

- [x] Run manifest-wide formatting read-only. If known ambient drift remains,
  verify no hunk begins in changed ranges and do not format unrelated files.
- [x] Run G1-G5. Any STOP trip halts the increment.
- [x] Run G6 in order with exact fail-loud remediation only.
- [x] Run `git diff --check`; inspect only the target diff; confirm it contains
  the direct matrix, one private helper, and one typed call-site routing match.
- [x] Update only this packet's completion fields with exact evidence, proposed
  journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public evaluator/caller boundary — result: verbatim diff/`rg` check
  exited 0 with empty output.
- [x] G2: one collector/one call/one typed match/no old nesting — result:
  verbatim checks found definition count 1, total occurrence count 2, typed
  match count 1, and no old nested variants branch.
- [x] G3: direct compatibility and structural-bail matrix — result: both
  focused tests passed, 2 passed, 0 failed, 276 filtered out.
- [x] G4: V2 evaluator hash — result:
  `6ebaae6dfd240a0fd2e160024228dd76196bb7e00d8b6435a7bd0750023f4b97`.
- [x] G5: protected dirty-diff hash — result:
  `276312e597aa3be55c0edf7be881feff3780f4ab18f1b1a3bacea67bd68a2132  -`.
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: Clippy exited 0;
  Rust units passed 278 + 8 + 348 with 1 ignored; canary initially failed loud
  on the expected stale NAPI binary, `vp run build:extract` exited 0, and the
  rerun passed 200/200; integration passed 157/157 across 11 files.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. Baseline style-evaluator module was GREEN at
  38/38. Both named characterizations were GREEN before production editing and
  after the rewrite; the final module was GREEN at 40/40. The target diff is
  limited to the direct matrix, one private mutating collector, and one typed
  routing match; `git diff --check` exits 0.

### Proposed journal entries

- Friction: manifest-wide `cargo fmt -- --check` still reports known ambient
  Rust drift. No read-only formatter hunk begins in the changed helper/parser/
  test ranges after locally aligning those ranges; unrelated files were not
  written. The referenced `packages/extract/AGENTS.md` is absent, so the
  authoritative root contributor instructions governed this increment.
- Surprise: none. The compatibility and structural-bail matrix stayed GREEN
  before and after flattening the routing.

### Surfaced variables (spawn candidates)

- `ambient-rustfmt-drift`: candidate for a separately authorized cleanup
  increment; intentionally unchanged here.
- `extract-package-guidance-path`: reconcile references to the absent
  `packages/extract/AGENTS.md` with the root contributor interface.

## Spec authorship checklist (orchestrator)

- [x] Confirmed §arch-extract-v1-variant-argument-routing/Flat V1 variant argument routing remains authored and leakage-clean
- [x] Confirmed no Decision Ledger row resolves in this increment
- [x] Appended accepted journal entries attributed via inc 01 subagent
- [x] Reorientation entry written with the full three-stance pass (K=1)
- [x] Ticked registry row 01 with the reorientation timestamp
