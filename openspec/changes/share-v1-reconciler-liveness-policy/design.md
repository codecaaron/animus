## Context

`reconcile()` removes component CSS in production. In dev mode,
`identify_prospective_eliminations()` reports what production would remove
without mutating the component list. Both functions independently spell the
same rule: eliminate only when the binding is absent from both
`rendered_components` and the provenance-parent set.

The duplicated condition is correct today, so this is not a bug fix. It is a
parity hardening refactor in a high-risk, single-owner file. The canonical
`css-reconciler` contract makes dev/build agreement the governing behavior.

## Goals / Non-Goals

**Goals:**

- Give actual and prospective elimination one private liveness policy.
- Characterize all three liveness cases through both public paths.
- Preserve every report, ordering, fallback, caller, and engine boundary.
- Record why this intentionally stays V1-local.

**Non-Goals:**

- Split the rest of `reconcile()` into phase helpers.
- Change variant/state pruning, dynamic/default usage expansion, or counts.
- Introduce a public predicate or new module.
- Edit V2 or share code across engines.

## Decisions

### D1: Centralize only component liveness

- **Choice**: add private `should_eliminate_component(binding, ledger,
  parent_components)` and call it from both actual and prospective paths.
- **Rationale**: this is the exact duplicated policy that the canonical parity
  contract requires to stay aligned.
- **Alternatives considered**: a full reconciliation phase split increases the
  review surface; retaining two conditions leaves drift possible.

### D2: Characterize parity before production editing

- **Choice**: add `actual_and_prospective_component_liveness_match` first and
  run it against the duplicated implementation. It compares unrendered,
  rendered, and parent components across both paths.
- **Rationale**: the honest test-first signal for a pure refactor is GREEN
  characterization, not an invented failing assertion.
- **Alternatives considered**: direct predicate tests couple to the helper;
  existing single-case tests do not express the complete cross-path matrix.

### D3: Preserve public and report boundaries

- **Choice**: change only the duplicated condition expressions and add the
  private helper/test. Preserve public signatures, reason strings, detail
  kinds/order, counts, component order, and callers.
- **Rationale**: those outputs feed manifest diagnostics and are outside this
  maintainability increment.
- **Alternatives considered**: a typed detail-kind enum or report redesign is a
  separate API/serialization decision.

### D4: Keep V1 and V2 independent

- **Choice**: edit only V1 `reconciler.rs`; protect V2 `usage_facts.rs` by hash.
- **Rationale**: V1 is the compatibility oracle, not a shared-code target, and
  no cross-engine co-change requirement exists.
- **Alternatives considered**: shared reconciliation utilities would couple
  distinct engine phase boundaries.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Actual and prospective component elimination select identical
  bindings for identical inputs.
- **NS2**: One private V1 predicate owns the rendered-or-parent decision.
- **NS3**: Report kinds, reasons, ordering, counts, and retained component order
  remain byte-compatible.
- **NS4**: Usage-ledger, caller, manifest, NAPI, canary, and integration
  boundaries remain stable.
- **NS5**: V2 remains independent — provisional — revisit on
  `repowise:v2-reconciler-liveness-plan`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Split the remaining reconciliation phases into helpers | deferred | external:reconciler-phase-plan | repowise:reconciler-phase-plan | 3 reorientations \| 2026-08-19 |
| DEF-2 | Apply a parallel source refactor to V2 | deferred | external:v2-reconciler-liveness-plan | repowise:v2-reconciler-liveness-plan | 3 reorientations \| 2026-08-19 |
| DEF-3 | Replace detail-kind strings with a typed enum | deferred | external:reconciliation-report-api | external:reconciliation-report-api | 3 reorientations \| 2026-08-19 |
| DEF-4 | Move the predicate into a shared module | deferred | external:second-v1-liveness-consumer | external:second-v1-liveness-consumer | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public reconciler type/function signature or caller boundary | footprint:packages/extract/src/reconciler.rs | STOP | active (inc 01 final: empty) |
| G2 | Exactly one private predicate SHALL drive exactly two production call sites, with no duplicated raw liveness condition | footprint:packages/extract/src/reconciler.rs | STOP | active (inc 01 final: definition 1; occurrences 3; raw condition empty) |
| G3 | Actual/prospective liveness parity SHALL remain characterized for unrendered, rendered, and parent inputs | footprint:packages/extract/src/reconciler.rs | STOP | active (inc 01 final: focused 1/1) |
| G4 | The V2 usage-facts implementation SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/usage_facts.rs | STOP | active (inc 01 final: `40e83a51d20934e23dd76c964a0f7c6240ab27e0bfec77051ba675d852a95503`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `790381181ccb772cf595c0fb3914de5fa0e79036a6563b534f834495f5294d46  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust units 275 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff -- packages/extract/src/reconciler.rs | rg '^[+][^+].*(pub type VariantConfigMap|pub struct UsageLedger|pub fn build_ledger|pub struct ReconciliationReport|pub struct EliminatedDetail|pub fn reconcile|pub fn identify_prospective_eliminations)|^[-][^-].*(pub type VariantConfigMap|pub struct UsageLedger|pub fn build_ledger|pub struct ReconciliationReport|pub struct EliminatedDetail|pub fn reconcile|pub fn identify_prospective_eliminations)' || true
```

**G2** — expected: counts 1 and 3, then empty output

```bash
test "$(rg -c '^fn should_eliminate_component\(' packages/extract/src/reconciler.rs)" = 1
test "$(rg -c 'should_eliminate_component\(' packages/extract/src/reconciler.rs)" = 3
rg -n -U 'if !ledger\.rendered_components\.contains\(binding\)\n\s*&& !parent_components\.contains\(binding\)' packages/extract/src/reconciler.rs || true
```

**G3** — expected: focused characterization passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml reconciler::tests::actual_and_prospective_component_liveness_match --lib
```

**G4** — expected:
`40e83a51d20934e23dd76c964a0f7c6240ab27e0bfec77051ba675d852a95503  packages/extract/crates/extract-v2/src/usage_facts.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/usage_facts.rs
```

**G5** — expected:
`790381181ccb772cf595c0fb3914de5fa0e79036a6563b534f834495f5294d46  -`

```bash
git diff -- . ':(exclude)packages/extract/src/reconciler.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] The shared predicate reverses the existing boolean -> Mitigation: use
  the exact existing expression and compare both public paths before/after.
- [Risk] Detail or component ordering changes -> Mitigation: change only the
  condition and assert the cross-path selected binding list.
- [Risk] A helper invites cross-engine sharing -> Mitigation: keep it private,
  in-file, and protect V2 by hash.
- [Trade-off] Larger nested methods remain -> accepted; DEF-1 requires a new
  RepoWise phase-plan signal before expanding scope.

## Migration Plan

N/A — private V1 refactor with no rollout. Acceptance requires a GREEN
characterization baseline, GREEN after the rewrite, G1-G6, strict OODA
validation, and independent two-phase review.
