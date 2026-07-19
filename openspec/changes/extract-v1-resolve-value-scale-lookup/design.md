## Context

V1's private `resolve_value()` owns four stages: negative normalization, scale
lookup, transform evaluation/fallback, and final CSS conversion. RepoWise ranks
`theme_resolver.rs` at health 3.98 and 99%-hotspot risk; `resolve_value` is 98
NLOC with CCN 30, cognitive complexity 101, and nesting 6. Its high-confidence
plan isolates the scale paragraph with an estimated CCN reduction of 13.

The file is clean, has no current OODA owner, and already has extensive local
and downstream tests. Archived decisions make scale misses, empty-array
phantoms, negative values, and transform fallback compatibility-sensitive.
V2 contains an engine-local counterpart, but cross-engine sharing is outside
this V1 rollback unit.

## Goals / Non-Goals

**Goals:**

- Give V1 scale lookup one private named owner.
- Characterize every current scale/key outcome before production editing.
- Preserve negative, transform, placeholder, alias, global, keyframe, and
  public behavior exactly.
- Run the exact V1 Rust change map and protect the mixed dirty tree.

**Non-Goals:**

- Change any scale hit/miss, numeric membership, or transform semantics.
- Edit V2 or introduce cross-engine shared code.
- Surface history-only coupling to `style_evaluator.rs` without a source
  contract.
- Extract other `resolve_value` stages or split `theme_resolver.rs`.
- Deduplicate intentional shorthand lists or other analyzer-reported clones.

## Decisions

### D1: Extract one private scale-outcome helper

- **Choice**: add `resolve_scale_value()` taking the normalized lookup value,
  `Option<&Value>` scale, and flat theme, returning the existing
  `Option<Value>` outcome. `resolve_value()` retains negative normalization,
  transform eligibility/evaluation, fallback, and final conversion.
- **Rationale**: the scale paragraph is cohesive, private, and directly feeds
  transform eligibility through `resolved.is_some()`. This signature exposes
  only the stage's true inputs and output.
- **Alternatives considered**: passing all of `PropConfig` leaks unrelated
  transform fields; extracting all of `resolve_value` is too broad; early
  returns inside the main method would reduce nesting less predictably.

### D2: Characterize observable outcomes first, then exact helper state

- **Choice**: add one direct `resolve_value` matrix covering no scale, theme
  hit/miss, inline object string/non-string hit/miss, empty array, non-empty
  string/numeric member/miss, empty/null keys, and unsupported lookup keys
  before production editing. After extraction, add a helper-level matrix that
  pins `Some` versus `None` for the same scale states.
- **Rationale**: final CSS/placeholder bytes prove caller-visible behavior and
  transform eligibility, while the helper-level matrix proves the exact
  `Option` state where final conversion or unconditional transform eligibility
  would otherwise collapse distinct states.
- **Alternatives considered**: rely on broad canary tests or compare only the
  helper after extraction. Both miss precise pre-edit characterization.

### D3: Keep V1 and V2 engine-local

- **Choice**: edit only V1 and use V2 solely as a comparison source for current
  semantics.
- **Rationale**: V1 is a behavioral oracle, not a shared-code target. No
  co-change or product signal authorizes a cross-engine module.
- **Alternatives considered**: extract a shared crate helper or edit both
  copies. Both enlarge the rollback unit and blur engine-local phase ownership.

### D4: Preserve the exact V1 owner claim

- **Choice**: protect public and non-scale resolver stages, keep the original
  foreign-diff hash, and run strict Clippy, Rust units, NAPI canary, then
  integration in repository-map order.
- **Rationale**: this central resolver has eight dependents and a bus-factor
  risk, so exact boundary and downstream evidence are part of the smallest
  honest refactor.
- **Alternatives considered**: local units alone under-test delivery; adding
  V2 parity is not in the V1 source map and would overstate this change's owner.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Every accepted scale shape and key type preserves its exact
  pre-extraction final value and transform-eligibility outcome.
- **NS2**: `resolve_value` reads as four explicit stages, with scale policy
  owned once.
- **NS3**: Negative normalization, transform fallback, aliases, globals,
  keyframes, CSS ordering, and public callers remain stable.
- **NS4**: V1 remains independently revertible and V2 remains engine-local —
  provisional — revisit only when
  `external:cross-engine-theme-cochange-contract` appears.
- **NS5**: The exact V1 Rust change map remains the downstream truth.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Change scale miss or unsupported-key semantics | deferred | 02 | external:v1-scale-lookup-behavior-contract | 12 reorientations \| 2026-08-19 |
| DEF-2 | Change non-empty array numeric equivalence | deferred | 03 | external:v1-array-scale-numeric-contract | 12 reorientations \| 2026-08-19 |
| DEF-3 | Change transform eligibility or failure fallback | deferred | 04 | external:v1-transform-failure-diagnostics-contract | 12 reorientations \| 2026-08-19 |
| DEF-4 | Extract negative normalization/final negation | deferred | 05 | external:v1-negative-scale-refactor-plan | 12 reorientations \| 2026-08-19 |
| DEF-5 | Share V1/V2 theme resolution | deferred | 06 | external:cross-engine-theme-cochange-contract | 12 reorientations \| 2026-08-19 |
| DEF-6 | Introduce a style-value resolution interface | deferred | 07 | external:style-value-resolution-interface | 12 reorientations \| 2026-08-19 |
| DEF-7 | Split the resolver file or select another seam | deferred | 08 | external:v1-theme-resolver-next-seam | 12 reorientations \| 2026-08-19 |
| DEF-8 | Change the V1 NAPI remediation path to guarantee synchronous freshness visibility | retired as execution-wrapper false positive (journal 2026-07-19 14:28) | — | later:execution-wrapper-result-contract disproved the original source premise | retired at reorientation 10 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public declaration in `theme_resolver.rs`; blind spot: indirect type behavior requires downstream tests | footprint:packages/extract/src/theme_resolver.rs | STOP | active (calibrated 2026-07-19: empty) |
| G2 | Scale resolution SHALL gain exactly one private helper and one production call while old inline `resolved` state leaves `resolve_value`; blind spot: counts do not prove semantics | inc:01 | STOP | armed(inc 01); baseline `0/0/1`, final `1/2/0` |
| G3 | Exact final scale/transform-eligibility outcomes and helper `Option<Value>` states SHALL NOT drift across the two characterized matrices | inc:01 | STOP | armed(inc 01); baseline focused filter has zero tests; characterization `1`, final `2` |
| G4 | Negative normalization, transform/finalization, negation, alias, global, and keyframe production regions SHALL retain their exact marker-bounded bytes; blind spot: scale-region semantics require G3 and manual target review | footprint:packages/extract/src/theme_resolver.rs | STOP | active (calibrated 2026-07-19: exact hashes below) |
| G5 | The increment SHALL NOT move pre-existing tracked work outside the clean target | all | STOP | active (calibrated 2026-07-19: exact hash below) |
| G6 | The increment SHALL NOT regress the exact mapped V1 verification chain | change-end | STOP | active |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff --unified=0 -- packages/extract/src/theme_resolver.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true
```

**G2** — baseline expected `0`, `0`, `1`; final expected `1`, `2`, `0`

```bash
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/theme_resolver.rs | rg '^fn resolve_scale_value\(' | wc -l
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/theme_resolver.rs | rg 'resolve_scale_value\(' | wc -l
sed -n '/^fn resolve_value(/,/^fn negate_css_value(/p' packages/extract/src/theme_resolver.rs | rg 'let mut resolved = None' | wc -l
```

**G3** — before characterization expected zero tests; after the pre-edit direct
matrix expected one pass; after extraction and helper-state characterization
expected two passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml theme_resolver::tests::scale_lookup_preserves_ --lib
```

**G4** — expected, in order:
`995914a1f03e4c6b3e8c461701250f50c57bfbdbd193c8d8cc91c24058fe9e76  -`,
`c24b5ff9d57551375df87a6795436f1295070c15d13e8d3a2a3cc67013aed8d1  -`,
and
`169c37d13a2fe0b46b10f46227459a5e857e4c6dd1b1dd002f51215bfe6047ac  -`

```bash
sed -n '/^fn resolve_value(/,/    \/\/ 1\. Try scale lookup/p' packages/extract/src/theme_resolver.rs | shasum -a 256
sed -n '/    let final_value = resolved\.as_ref()/,/^fn negate_css_value(/p' packages/extract/src/theme_resolver.rs | shasum -a 256
sed -n '/^fn negate_css_value(/,/^#\[cfg(test)\]/p' packages/extract/src/theme_resolver.rs | shasum -a 256
```

**G5** — expected:
`115b28c5ec3c111aa6d83a356b7941b568ca6dd69da1dc848fe22c2b0d03f72b  -`

```bash
git diff -- . ':(exclude)packages/extract/src/theme_resolver.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after any exact printed
prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] A helper returns the right final value but changes
  `resolved.is_some()` -> Mitigation: the direct pre-edit matrix pins observable
  outcomes and a post-extraction helper matrix pins exact `Some`/`None` state.
- [Risk] Numeric array membership changes across integer/float forms ->
  Mitigation: pin both member and miss outcomes and preserve `as_f64()` logic.
- [Risk] Whole-file Rust 1.97 formatting fails on baseline-owned regions ->
  Mitigation: compare the live diagnostic with `HEAD`, require zero formatter
  output for the extracted helper and new test region independently, and refuse
  unrelated formatting churn.
- [Risk] V2 parity is mistaken for shared ownership -> Mitigation: D3 and G5
  keep the footprint V1-only.
- [Risk] An outer orchestration cell completion is mistaken for nested NAPI
  build completion -> Mitigation: require a surfaced nested exit result or
  process termination plus binary/input mtimes before immediate retry; later
  evidence retired DEF-8 without weakening canary or changing repository code.
- [Trade-off] Other complex stages remain -> acceptable; each has a separate
  resolving signal and lazy row.

## Migration Plan

N/A — no deployment change. Add the behavior matrix first, prove it against
the inline implementation, extract only the scale stage, prove the new regions
formatter-clean without absorbing baseline drift, then require G1-G6 and
independent two-phase review. Rollback is manual reversal of this focused
increment; never use mutative Git.
