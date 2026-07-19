## Context

`parse_object_from_source_with_statics()` is a private V1 parser/evaluator
bridge called by `parse_object_from_source()` and five `process_chain()` stage
arms. It wraps source in parentheses, parses an OXC program, then distinguishes
literal objects from static identifier references and unsupported expressions.

The nested implementation carries observable compatibility edges: literal
objects return partial values, ordered skips, and source-sliced captures;
object-valued identifiers resolve without skips/captures; every unresolved or
non-object identifier gets an identifier-specific error; other shapes get a
generic parse error. V2 owns the parallel policy inside facts extraction and
remains independently implemented.

## Goals / Non-Goals

**Goals:**

- Flatten source-shape routing through explicit structural guards.
- Make the expression-kind decision and identifier outcome legible at one level.
- Characterize every observable route before production editing.
- Preserve all caller, diagnostic, parse-count, runtime, and engine boundaries.

**Non-Goals:**

- Refactor `process_chain`, `parse_variant_from_source`, or style evaluation.
- Change malformed-source or identifier diagnostics.
- Generalize wrapper parsing across helpers.
- Edit or share V2 facts extraction.

## Decisions

### D1: Guard the program and parenthesized shapes before expression dispatch

- **Choice**: use two target-specific `let ... else` guards that return the
  existing generic error, then match once on the parenthesized expression.
- **Rationale**: structural failures share one outcome, while object and
  identifier policies become sibling branches without changing control flow.
- **Alternatives considered**: chained combinators obscure which shapes get
  the generic error; retaining nested `if let` leaves the valid finding open.

### D2: Resolve static identifiers through one object-value guard

- **Choice**: combine optional map/name lookup with the existing `is_object`
  predicate, return the exact identifier-specific error on absence/scalar, and
  clone the accepted object with empty skips/captures.
- **Rationale**: the three failure causes intentionally share one diagnostic
  and do not require separate nesting.
- **Alternatives considered**: adding a generic resolver helper introduces a
  seam with no second policy-compatible consumer.

### D3: Characterize the complete routing matrix before production editing

- **Choice**: add one direct `lib.rs` unit test covering literal partial value
  and skip, exact captured function source, static object identifier, missing
  and scalar identifier errors, and generic non-object failure.
- **Rationale**: direct private-helper output is the narrowest black-box for
  the routing contract, while existing canary/integration remain downstream
  oracles.
- **Alternatives considered**: NAPI-only assertions make it difficult to
  distinguish wrapper routing from later process-chain formatting.

### D4: Keep V1 and V2 phase ownership independent

- **Choice**: edit only V1 `lib.rs`; protect V2 `facts.rs` by exact hash.
- **Rationale**: V1 parses source snippets here, whereas V2 consumes facts
  extracted from its owned AST; shared text would couple distinct phases.
- **Alternatives considered**: cross-engine helper sharing has no co-change or
  compatible ownership evidence.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Literal values/skips/captures, static identifier resolution, and
  exact error partitioning remain stable.
- **NS2**: Two structural guards and one expression match own source routing.
- **NS3**: Caller, stage, parse-count, public NAPI, and diagnostic boundaries
  stay stable.
- **NS4**: Rust units, canary, and integration remain green downstream oracles.
- **NS5**: V2 remains engine-local and byte-stable — provisional — revisit on
  `repowise:cross-engine-parse-cochange`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Flatten `process_chain` variant-stage routing | deferred | external:v1-variant-stage-plan | repowise:v1-variant-stage-plan | 6 reorientations \| 2026-08-19 |
| DEF-2 | Flatten `parse_variant_from_source` | deferred | external:v1-variant-source-routing | repowise:v1-variant-source-routing | 6 reorientations \| 2026-08-19 |
| DEF-3 | Share parsing policy with V2 facts extraction | deferred | external:cross-engine-parse-cochange | repowise:cross-engine-parse-cochange | 6 reorientations \| 2026-08-19 |
| DEF-4 | Change object-source diagnostics | deferred | external:object-source-diagnostic-contract | spec:object-source-diagnostic-contract | 6 reorientations \| 2026-08-19 |
| DEF-5 | Generalize wrapper parsing | deferred | external:shared-wrapper-policy-consumer | code:shared-wrapper-policy-consumer | 6 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public `lib.rs` type/function signature | footprint:packages/extract/src/lib.rs | STOP | final green (empty public-boundary diff) |
| G2 | Target routing SHALL use two named structural guards and one expression match, with the old nested route absent | footprint:packages/extract/src/lib.rs | STOP | final green (1/1/1; old route absent after inc 01 STOPs at 10:11 and 10:14) |
| G3 | Literal partial evaluation/capture, identifier success/failure, and generic failure SHALL remain characterized | footprint:packages/extract/src/lib.rs | STOP | final green (focused matrix 1/1 before and after) |
| G4 | V2 facts extraction SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/facts.rs | STOP | final green (`7a96b7c54f5d5fe006a9b34a12692576c77981daba55423099c0cbe421bf55fc`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | final green (`e153036189f2cf07aaf2098663b53b4496f510a69a61010eb65d2de324ce731b`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | final green (Clippy; 637 Rust passed/1 ignored; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff --unified=0 -- packages/extract/src/lib.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true
```

**G2** — baseline expected: counts 0, 0, and 0, then a non-empty old-route
match. Final expected: counts 1, 1, and 1, then empty output.

```bash
rg -c '^    let Some\(oxc_ast::ast::Statement::ExpressionStatement\(expr_stmt\)\) = program\.body\.first\(\) else \{' packages/extract/src/lib.rs || true
rg -c '^    let Expression::ParenthesizedExpression\(paren\) = &expr_stmt\.expression else \{' packages/extract/src/lib.rs || true
rg -c '^    match &paren\.expression \{' packages/extract/src/lib.rs || true
sed -n '/^pub(crate) fn parse_object_from_source_with_statics(/,/^pub(crate) fn parse_variant_from_source(/p' packages/extract/src/lib.rs | rg -n -U 'if let Some\(oxc_ast::ast::Statement::ExpressionStatement\(expr_stmt\)\) = program\.body\.first\(\) \{\n\s*if let Expression::ParenthesizedExpression\(paren\)' || true
```

**G3** — expected: focused characterization passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml tests::object_source_routing_preserves_values_captures_and_errors --lib
```

**G4** — expected:
`7a96b7c54f5d5fe006a9b34a12692576c77981daba55423099c0cbe421bf55fc  packages/extract/crates/extract-v2/src/facts.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/facts.rs
```

**G5** — expected:
`e153036189f2cf07aaf2098663b53b4496f510a69a61010eb65d2de324ce731b  -`

```bash
git diff -- . ':(exclude)packages/extract/src/lib.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite
remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Early guards change identifier-specific errors into the generic error
  -> Mitigation: expression matching happens only after the parenthesized guard;
  the identifier branch keeps its exact message and gets direct assertions.
- [Risk] Capture slicing shifts because source is wrapped -> Mitigation: leave
  `wrapped` and span slicing unchanged and assert the exact function source.
- [Risk] Lookup combinators accept a scalar static value -> Mitigation: retain
  `is_object` and assert scalar/missing cases share the exact error.
- [Risk] Cross-engine similarity appears actionable -> Mitigation: protect V2
  `facts.rs` by hash and retain DEF-3.
- [Trade-off] `parse_variant_from_source` remains nested -> accepted; it has a
  different output/error policy and DEF-2 preserves a separate signal.

## Migration Plan

N/A — private V1 refactor with no deployment change. Acceptance requires the
GREEN behavior matrix, genuine structural RED before editing, final GREEN,
G1-G6, strict OODA validation, and independent two-phase review.
