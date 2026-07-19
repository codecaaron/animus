# Brainstorm: extract V1 `resolve_value` scale lookup

Exploration evidence already exists, so no new interactive brainstorm was
needed. This capture is grounded in:

- RepoWise targeted health/context/risk/why evidence at indexed commit
  `fd168798bbc4`: `theme_resolver.rs` health 3.98, hotspot risk 99%, eight
  dependents, no test gap, and `resolve_value` at 98 NLOC / CCN 30 / cognitive
  101 / nesting 6;
- high-confidence RepoWise plan `97b46b4ca95a4079b16707571d99297c`,
  isolating the scale-lookup paragraph (live lines 543-592) with estimated CCN
  reduction 13 and no external callers;
- the live V1 source, callers, colocated tests, and exact V2-local counterpart;
- archived decisions for token aliases, negative scale values, cascade order,
  transform evaluation, and Rust intelligibility.

## Decision chain

1. The original queue lead is valid: this is a central, churn-heavy resolver
   with one critical private method and strong unit/integration coverage.
2. The analyzer's file-wide duplication and hidden-coupling suggestions are not
   sufficient change authority. `CSS_SHORTHANDS` duplication is an archived,
   intentional anti-cycle decision, and V1/V2 resolver duplication is an
   engine-local compatibility oracle with no evidence that a shared module is
   desirable.
3. The high-confidence private scale-lookup slice is different: it is one
   cohesive stage already labeled in `resolve_value`, has no public caller, and
   can be observed through exact `Value` outputs before any extraction.
4. Existing tests cover theme-scale lookup, no-scale passthrough, and transform
   composition, but do not directly pin inline-object values, non-empty array
   membership/miss, empty-array phantom passthrough, invalid key types, and
   theme misses as one matrix. Characterize that matrix first.
5. Keep negative normalization before the helper and transform eligibility,
   evaluator failure fallback, placeholder emission, final CSS conversion, and
   negation after it. This makes the increment a private structural refactor,
   not a semantics change.
6. Apply only to V1. V2 is a behavioral comparison source, not a shared-code
   destination; changing both would enlarge the rollback unit without a
   product signal.

## Known now

- Target: clean `packages/extract/src/theme_resolver.rs`; no open OODA change
  owns it.
- The scale stage accepts only string or numeric lookup keys.
- String scales lookup `<scale>.<key>` in `FlatTheme` and return a cloned
  string value on hit.
- Inline object scales clone either string or non-string values on hit.
- Non-empty array scales return the original lookup value only for same-kind
  string equality or numeric `as_f64()` equality.
- Empty array scales, misses, unsupported scale shapes, and object/array lookup
  keys leave the stage unresolved so downstream passthrough/transform rules
  remain authoritative.
- Negative integer/float normalization occurs before the scale stage and must
  remain outside it.
- Transform eligibility depends on `resolved.is_some()`, absent scale, or an
  empty-array phantom; the helper's `Option<Value>` result is therefore part of
  behavior, not merely an internal convenience.
- The exact repository map for `packages/extract/src/**/*.rs` is strict Clippy,
  Rust units, NAPI canary, then integration. Atomic failures must print and use
  their exact remediation.

## Deferred variables and resolving signals

- **Change scale miss or unsupported-key semantics** — defer until
  `external:v1-scale-lookup-behavior-contract` provides a consumer-visible
  compatibility decision and failing oracle.
- **Change numeric membership equivalence for non-empty array scales** — defer
  until `external:v1-array-scale-numeric-contract` provides explicit NaN,
  integer/float, and precision cases.
- **Change transform eligibility, evaluator-error fallback, or legacy
  placeholder emission** — defer until
  `external:v1-transform-failure-diagnostics-contract` lands.
- **Extract negative normalization or final negation** — defer until
  `external:v1-negative-scale-refactor-plan` isolates a separately
  characterized seam.
- **Share V1 and V2 resolver code** — defer until
  `external:cross-engine-theme-cochange-contract` demonstrates sustained
  co-change and explicitly preserves engine-local phase boundaries.
- **Surface the history-only `style_evaluator.rs` coupling in a shared type** —
  defer until `external:style-value-resolution-interface` identifies a real
  source contract or defect; current co-change alone is not dependency proof.
- **Split `theme_resolver.rs` or extract other complex methods** — defer until
  `external:v1-theme-resolver-next-seam` supplies a reviewed, independently
  testable next slice after this increment's health/evidence result.

## Candidate North Stars

- Every currently accepted scale shape and key type preserves the exact
  pre-extraction `Option<Value>` outcome.
- `resolve_value` reads as negative normalization → scale resolution →
  transform → CSS conversion, with the scale policy owned once.
- Transform/placeholder/error fallback and negative-value behavior remain
  byte-stable.
- Public resolver types, callers, CSS ordering, token aliases, contextual vars,
  globals, and keyframes remain outside the change.
- V1 remains locally coherent and independently revertible; V2 stays untouched
  unless the cross-engine co-change signal appears.
- The exact V1 Rust owner map remains the downstream truth.

## Candidate guardrails

- The change SHALL NOT alter a public declaration in `theme_resolver.rs`.
  Check: zero-context target diff search for added/removed `pub` declarations.
- The change SHALL add exactly one private scale helper and one production call
  while removing the inline `let mut resolved` scale branch from
  `resolve_value`. Check: definition/call/state counts.
- Scale outcomes SHALL remain exact for no scale, theme hit/miss, inline object
  string/non-string hit/miss, empty array, non-empty string/numeric
  member/miss, and unsupported lookup key. Check: focused direct matrix GREEN
  before and after; structural helper count RED then GREEN.
- Changed production lines SHALL NOT touch negative normalization, transform
  eligibility/evaluation, placeholder formatting, final CSS conversion,
  negation, token aliases, globals, or keyframes. Check: protected-token diff
  search plus manual target-only review.
- The increment SHALL NOT move any pre-existing tracked work outside the clean
  target. Check: calibrated foreign-diff hash excluding only the target.
- The exact mapped chain SHALL remain GREEN: strict Clippy → Rust units → NAPI
  canary → integration. Check: `repowise distill vp run ...` in map order,
  following only printed prerequisite remediation.

The smallest honest increment is therefore: add a direct scale-outcome matrix,
prove it against the inline code, extract one private helper, prove exact output
and structure, run the complete V1 owner map, and independently review it.
