# Increment 01: flatten V1 compose shared-key extraction

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/jsx_scanner.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after RepoWise risk/context evidence exposed a bounded nested
> helper in a clean Rust file with no active-change overlap.

## Context Capsule

- **Objective**: Flatten outer property/value routing and collect inner keys
  with one ordered filter. Characterize the asymmetric matrix first. Preserve
  callers, family records, runtime, V2, and dirty-tree boundaries.
- **Verified finding disposition**: the seven-level nesting lead is valid. The
  file-wide cross-module duplication score is not sufficient evidence for
  sharing; neighboring reader, generic-policy, V2, and semantic changes are not
  licensed.
- **Live call path**: `extract_compose_family()` is the sole caller and defaults
  `None` to an empty `shared_keys` vector in `ComposeFamilyInfo`.
- **Current mapping**: outer spreads skip; outer unresolvable keys abort;
  wrong-typed `shared` continues; first valid object-valued `shared` wins; inner
  spreads/unresolvable keys skip; identifier/string/numeric keys retain order
  and values are ignored.
- **Existing contracts**: canonical compose-family extraction/slot contracts,
  direct compose Rust tests, NAPI canary/integration; independent V2
  `jsx_scan.rs` compatibility implementation.
- **Decisions**: D1 flat guards with preserved `?`; D2 ordered `filter_map`; D3
  black-box characterization-first GREEN plus structural RED; D4 V1-only with
  V2 hash.
- **North Star**: NS1 parser matrix; NS2 flat ownership; NS3 family/public
  boundaries; NS4 downstream oracles; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Read-only Git inspection is required. Do
  not write outside the declared footprint plus this packet's completion
  fields. Never edit design/tasks/journal/specs, V2, callers, manifests, public
  APIs, dependencies, or integration fixtures.

## Plan

### Task 01.1: Characterize the asymmetric shared-key matrix first

- [x] Confirm the existing JSX-scanner unit baseline is 54/54 using the root
  evidence at `repowise#d15e912ea682`; do not rerun merely to recover omitted
  output.
- [x] Add `compose_shared_keys_preserve_abort_skip_and_order` beside existing
  compose tests. Use multiple compose calls to cover an outer spread; wrong-
  typed then valid `shared`; first-valid then duplicate `shared`; inner spread
  and `[innerDynamic]` skips; identifier plus computed string/numeric literal
  key order; and `[outerDynamic]` before a valid `shared` that yields an empty
  emitted vector. Assert the exact family count and each family index's exact
  `shared_keys` vector so no call can be silently dropped or reordered.
- [x] Run the focused test before production editing and record honest GREEN
  against the nested implementation.
- [x] Run the first three G2 assertions before production editing and record
  honest RED. Also record that the final G2 search finds the old nested branch.

### Task 01.2: Flatten routing and inner collection

- [x] Replace the outer property-kind branch with `let ... else { continue }`.
  Retain `eval_property_key(&prop.key)?` exactly, continue for non-`shared`
  keys, and guard non-object `shared` values with a second `let ... else`.
- [x] Replace only the inner mutable loop with one `filter_map` over
  `shared_obj.properties`, retaining object-property filtering and exact key
  evaluation/order. Return the collected vector from the first valid object.
- [x] Rerun the focused characterization and full JSX-scanner module.

### Task 01.3: Format, verify, and self-review

- [x] Run manifest-wide formatting read-only. If known ambient drift remains,
  verify no hunk begins in changed ranges and do not format unrelated files.
- [x] Run G1-G5. Any STOP trip halts the increment.
- [x] Run G6 in order with exact fail-loud remediation only.
- [x] Run `git diff --check`; inspect only the target diff; confirm it contains
  one behavior matrix and the bounded flat helper rewrite.
- [x] Update only this packet's completion fields with exact evidence, proposed
  journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public JSX scanner boundary — result: exact diff search exited 0 with
  empty output; no public item was added, removed, or changed.
- [x] G2: two guards/one filter/no old nesting — result: before production edit,
  the three count assertions each exited 1 at 0/0/0 and the old nested branch
  search matched lines 811-813. After the edit, the assertions exited 0 at
  1/1/1 and the old nested-branch search exited 0 with empty output.
- [x] G3: asymmetric shared-key matrix — result:
  `RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml jsx_scanner::tests::compose_shared_keys_preserve_abort_skip_and_order --lib`
  exited 0 with 1 passed and 279 filtered.
- [x] G4: V2 JSX scanner hash — result:
  `0febdbe45470bfdcded6f21eeb8f9d005c0c106e77598d370127c92e9336fb1f  packages/extract/crates/extract-v2/src/jsx_scan.rs`.
- [x] G5: protected dirty-diff hash — result:
  `4f61c873c91bcad8900bcf56e21f764ccf914865f6642d3b440f9d843417d036  -`.
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: exact ordered
  commands exited 0. Clippy was clean; Rust units passed 280 + 8 + 348 = 636
  with 1 ignored (`repowise#3edda2ffb985`); the first canary failed loud because
  the NAPI binary was stale, exact remediation `repowise distill vp run build:extract`
  exited 0, and the fresh canary passed 200/200; integration passed 157/157
  across 11 files.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. Reused the 54/54 baseline at
  `repowise#d15e912ea682`; the focused characterization was GREEN before and
  after the production edit (1/1), and the full JSX-scanner module is GREEN at
  55/55 (`repowise#bfe2971eef99`). Read-only manifest formatting reported known
  ambient drift, but no formatting hunk begins in either changed range. Final
  `git diff --check` exited 0, and target-only diff inspection contains exactly
  one behavior matrix plus the bounded flat helper rewrite.

### Proposed journal entries

- Surprise: the asymmetric behavior matrix was already GREEN against the
  nested implementation; the structural RED gate isolated the intended
  behavior-preserving ownership flatten.
- Friction: manifest-wide read-only rustfmt exited 1 on ambient drift. A
  target-specific read-only check confirmed no hunk begins in changed ranges,
  so no unrelated formatting writes were made.
- Signal: the fail-loud canary prerequisite correctly detected the stale NAPI
  binary; exact packet-authorized remediation restored a 200/200 canary claim.

### Surfaced variables (spawn candidates)

- `ambient-rustfmt-drift`: a possible later cleanup increment; explicitly not
  absorbed into this bounded V1 helper change.

## Spec authorship checklist (orchestrator)

- [x] Confirm §arch-extract-v1-compose-shared-keys/Flat V1 compose shared-key extraction remains authored and leakage-clean
- [x] Confirm no Decision Ledger row resolves in this increment
- [x] Append accepted journal entries attributed via inc 01 subagent
- [x] Write a reorientation entry with the full three-stance pass (K=1)
- [x] Tick registry row 01 with the reorientation timestamp
