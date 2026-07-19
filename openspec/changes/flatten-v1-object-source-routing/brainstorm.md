# Brainstorm: flatten V1 object-source routing

Existing exploration evidence: RepoWise targeted health/risk/context/why for
`packages/extract/src/lib.rs` at indexed commit `fd168798bbc4`, followed by
live symbol reads of `process_chain`, `parse_object_from_source_with_statics`,
and `parse_variant_from_source`; current canonical `rust-extraction-pipeline`
and `per-property-bail` requirements; live active-change ownership search; and
exact dirty-tree/V2 hashes. This evidence is sufficient to skip a second
interactive exploration pass.

## Decision chain

1. RepoWise's file-wide lead is real but too broad: `lib.rs` scores 4.43 and is
   a 97th-percentile increasing hotspot, yet `process_chain` spans 199 NLOC and
   multiple independent stage policies.
2. The smaller `parse_object_from_source_with_statics` finding is independently
   actionable: six nesting levels and cognitive complexity 24 are concentrated
   in one private routing helper with stable direct callers.
3. Live code exposes four distinct observable outcomes that a flat rewrite
   must not conflate: literal object evaluation; object-valued static identifier
   resolution; identifier-specific failure; generic non-object parse failure.
4. Literal evaluation also owns partial-value skip warnings and transform-source
   capture slicing, so the characterization must pin those outputs rather than
   assert only success/failure.
5. V2 implements the compatibility policy in its facts phase, not through this
   parser helper. Identical errors do not license sharing across engine phases.
6. Therefore the smallest honest increment is one V1-only routing flatten:
   two early structural guards plus one expression-kind match, with direct
   behavior characterization and V2/protected-diff hashes.

## Known now

- `parse_object_from_source()` and five `process_chain()` stage arms call the
  target helper; no active non-archive OpenSpec change owns `lib.rs`.
- The input is wrapped in parentheses before OXC parsing. A first statement
  that is not an expression statement, or an expression that is not the
  expected parenthesized shape, returns `failed to parse object expression`.
- An object expression delegates to `eval_object_expr_with_statics`, preserving
  its partial value, ordered skip warnings, and captured function spans; capture
  source is sliced from the wrapped string.
- A parenthesized identifier resolves only when `static_values` contains an
  object value. Missing maps, missing names, and scalar values all return
  `identifier '<name>' not resolvable to static object`.
- Any other parenthesized expression returns the generic parse error.
- The target file is clean before the increment. The protected foreign tracked
  diff is `e153036189f2cf07aaf2098663b53b4496f510a69a61010eb65d2de324ce731b`.
- V2 `facts.rs` is engine-local and initially hashes to
  `7a96b7c54f5d5fe006a9b34a12692576c77981daba55423099c0cbe421bf55fc`.

## Deferred variables and resolving signals

- Flatten `process_chain`'s variant-stage body — defer until a dedicated
  `repowise:v1-variant-stage-plan` identifies one independently testable output
  seam and its exact returned state.
- Flatten `parse_variant_from_source` — defer until
  `repowise:v1-variant-source-routing` shows a material nested-complexity or
  co-change benefit; similarity alone is not a resolving signal.
- Share V1 parsing with V2 facts extraction — defer until
  `repowise:cross-engine-parse-cochange` demonstrates sustained co-change and a
  compatible AST ownership boundary.
- Change identifier or malformed-expression diagnostics — defer until
  `spec:object-source-diagnostic-contract` explicitly revises those externally
  observed messages.
- Generalize wrapper parsing across object/variant helpers — defer until a
  second consumer with identical error and static-identifier policies exists
  (`code:shared-wrapper-policy-consumer`).

## Candidate North Star

- NS1: Every current object-source outcome remains exact: partial literal
  evaluation, skip ordering, capture source, static-identifier resolution,
  identifier-specific errors, and generic errors.
- NS2: Source-shape routing reads top-down through two structural guards and one
  expression-kind decision, without nested `if let` ownership.
- NS3: Callers, signatures, process-chain stages, parse counts, and public NAPI
  outputs remain unchanged.
- NS4: Rust units, canary, and integration remain the downstream oracle.
- NS5: V2 remains engine-local and byte-stable — provisional; revisit on
  `repowise:cross-engine-parse-cochange`.

## Candidate guardrails

- G1: SHALL NOT alter a public `lib.rs` type/function signature. Check the
  zero-context target diff for added/removed public declarations.
- G2: SHALL contain exactly two target-local `let ... else` structural guards,
  one expression-kind match, and no old three-level `if let` route. Check exact
  anchored source counts and an old-shape search.
- G3: SHALL preserve an exact direct matrix for literal partial evaluation and
  capture, static object identifier, unresolved/scalar identifier messages,
  and generic non-object failure. Run one focused Rust test.
- G4: SHALL NOT alter V2 facts extraction. Check the exact `facts.rs` hash.
- G5: SHALL NOT move pre-existing dirty work. Hash the tracked diff excluding
  `packages/extract/src/lib.rs`.
- G6: SHALL NOT regress mapped V1 extraction verification. Run strict Clippy,
  Rust units, fresh NAPI canary, and integration in root-map order, following
  only exact fail-loud remediation.
