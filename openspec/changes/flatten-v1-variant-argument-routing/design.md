## Context

`parse_variant_arg()` is the public V1 evaluator for `.variant({...})` stage
arguments. Its sole V1 caller parses an object snippet and forwards the result
into chain processing. The parser currently defaults the prop to `variant`,
accepts string `prop`/`defaultVariant`, evaluates object-valued `base`, merges
object-valued `variants` entries in encounter order, and accumulates per-style
skip warnings. Non-property entries and known fields with wrong value types are
ignored.

The behavior is compatible with the canonical evaluator contracts. The
maintainability issue is that config routing and inner option collection occupy
one seven-level decision tree. V2 carries a verbatim engine-local compatibility
port and remains independently implemented.

## Goals / Non-Goals

**Goals:**

- Make top-level field routing one typed match after a flat entry guard.
- Give variant-option collection one private helper.
- Characterize config shape, ignored entries, repeated-option override, and
  skip order before editing.
- Preserve every evaluator/caller/runtime and engine boundary.

**Non-Goals:**

- Change structural-bail versus per-property-skip semantics.
- Add static-value resolution to variant arguments.
- Refactor neighboring evaluator functions or share code with states parsing.
- Edit or share the V2 evaluation port.

## Decisions

### D1: Route top-level fields through one typed match

- **Choice**: guard non-`ObjectProperty` entries with `let ... else`, evaluate
  the key exactly once, then match `(key.as_str(), &p.value)` for the supported
  string/object combinations.
- **Rationale**: wrong-typed known fields and unknown fields still fall through,
  but branch-local `if let` nesting disappears.
- **Alternatives considered**: a builder object adds state and API surface; a
  match on key alone retains the type-check nesting.

### D2: Extract one private option collector

- **Choice**: add `collect_variant_options()` that guards non-property entries,
  evaluates each option key/value in order, extends the shared skip vector, and
  inserts into the shared variants map.
- **Rationale**: the deepest loop becomes independently legible without
  changing allocation, override, error, skip order, or option-key iteration
  order observed by the sole caller.
- **Alternatives considered**: returning a new map/vector would add intermediate
  allocations and complicate repeated `variants` field semantics.

### D3: Characterize compatibility before production editing

- **Choice**: add `variant_arg_preserves_config_and_skip_order` plus
  `variant_arg_preserves_structural_bails` and run both GREEN against the
  nested implementation first.
- **Rationale**: this is a behavior-preserving refactor. The direct matrix pins
  defaults/explicit fields, base and option skips, ignored spreads/wrong types,
  ordered option keys, and repeated option override in one contract. The bail
  contract separately proves that config-container spreads remain ignored while
  spreads inside base/option style objects remain structural errors.
- **Alternatives considered**: canary fixtures prove downstream output but do
  not isolate parser result and skip ordering.

### D4: Keep V1 and V2 independent

- **Choice**: edit only V1 `style_evaluator.rs`; protect V2 `eval.rs` by content
  hash.
- **Rationale**: V1 remains the behavioral oracle and V2 owns a distinct facts
  evaluation phase despite source similarity.
- **Alternatives considered**: sharing the parser would couple engine-local AST
  and evaluation ownership with no demonstrated co-change need.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Variant config shape, ordered option keys, repeated-option override,
  and skip order remain exact.
- **NS2**: One typed top-level match and one private option collector own the
  routing.
- **NS3**: Ignored-entry, wrong-type, structural-error, and per-property-skip
  semantics remain unchanged.
- **NS4**: Public evaluator, sole caller, manifest, NAPI, canary, and integration
  boundaries stay stable.
- **NS5**: V2 remains independent — provisional — revisit on
  `repowise:v2-variant-routing-plan`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Refactor `eval_object_expr_with_statics()` nesting | deferred | external:object-evaluator-plan | repowise:object-evaluator-plan | 3 reorientations \| 2026-08-19 |
| DEF-2 | Resolve static identifiers in variant arguments | deferred | external:variant-static-values | test:variant-static-values | 3 reorientations \| 2026-08-19 |
| DEF-3 | Share routing abstractions with states parsing | deferred | external:second-config-router | external:second-config-router | 3 reorientations \| 2026-08-19 |
| DEF-4 | Apply a parallel source refactor to V2 | deferred | external:v2-variant-routing-plan | repowise:v2-variant-routing-plan | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public evaluator type/function signature or caller boundary | footprint:packages/extract/src/style_evaluator.rs | STOP | active (inc 01 final: empty) |
| G2 | Exactly one private option collector SHALL have exactly one production call, one typed top-level match SHALL remain, and the old nested variants branch SHALL be absent | footprint:packages/extract/src/style_evaluator.rs | STOP | active (inc 01 final: definition 1; occurrences 2; typed match 1; old nesting empty) |
| G3 | Config shape, ignored config entries, ordered option keys, repeated-option override, skip order, and style-object structural bails SHALL remain characterized | footprint:packages/extract/src/style_evaluator.rs | STOP | active (inc 01 final: focused 2/2) |
| G4 | The V2 evaluation implementation SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/eval.rs | STOP | active (inc 01 final: `6ebaae6dfd240a0fd2e160024228dd76196bb7e00d8b6435a7bd0750023f4b97`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `276312e597aa3be55c0edf7be881feff3780f4ab18f1b1a3bacea67bd68a2132  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust units 278 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff -- packages/extract/src/style_evaluator.rs | rg '^[+][^+].*(pub struct BailError|pub struct SkippedProperty|pub struct CapturedTransform|pub fn eval_object_expr|pub fn eval_object_expr_with_statics|pub struct VariantStageConfig|pub fn parse_variant_arg|pub fn parse_states_arg)|^[-][^-].*(pub struct BailError|pub struct SkippedProperty|pub struct CapturedTransform|pub fn eval_object_expr|pub fn eval_object_expr_with_statics|pub struct VariantStageConfig|pub fn parse_variant_arg|pub fn parse_states_arg)' || true
```

**G2** — expected: counts 1, 2, and 1, then empty output

```bash
test "$(rg -c '^fn collect_variant_options\(' packages/extract/src/style_evaluator.rs)" = 1
test "$(rg -c 'collect_variant_options\(' packages/extract/src/style_evaluator.rs)" = 2
test "$(rg -c 'match \(key\.as_str\(\), &p\.value\)' packages/extract/src/style_evaluator.rs)" = 1
rg -n -U '"variants" => \{\n\s*if let Expression::ObjectExpression\(obj\).+\n\s*for vprop in &obj\.properties' packages/extract/src/style_evaluator.rs || true
```

**G3** — expected: both focused characterizations pass

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml style_evaluator::tests::variant_arg_preserves_ --lib
```

**G4** — expected:
`6ebaae6dfd240a0fd2e160024228dd76196bb7e00d8b6435a7bd0750023f4b97  packages/extract/crates/extract-v2/src/eval.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/eval.rs
```

**G5** — expected:
`276312e597aa3be55c0edf7be881feff3780f4ab18f1b1a3bacea67bd68a2132  -`

```bash
git diff -- . ':(exclude)packages/extract/src/style_evaluator.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Tuple matching changes wrong-type/unknown-field fallthrough ->
  Mitigation: include both in the direct characterization and preserve one
  wildcard arm.
- [Risk] Helper extraction changes ordered keys, repeated-option override, or
  skip order -> Mitigation: mutate the existing map/vector in encounter order
  and assert all three.
- [Risk] A flat guard conflates ignored config-container spreads with bailing
  style-object spreads -> Mitigation: characterize both layers explicitly.
- [Risk] Cross-engine duplication appears actionable -> Mitigation: V2 is
  hash-protected and engine-local; DEF-4 names the only reopening signal.
- [Trade-off] Other critical evaluator nesting remains -> accepted; this
  increment owns only the bounded `parse_variant_arg()` lead.

## Migration Plan

N/A — private V1 refactor with no rollout. Acceptance requires GREEN-to-GREEN
characterization, G1-G6, strict OODA validation, and independent two-phase
review.
