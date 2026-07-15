# Design — prop-flow-reachability

## Context

The style universe is config-known (finite props, scales, variant keys); what the
extractor lacks is *reachability proof* at dynamic JSX sites, and any *observability* of
why sites are dynamic. Grounding facts (2026-07-13 code reads):

- Classifier: `PropValueResult::{Static, Dynamic, Skip}` — `Dynamic` is payload-free
  (`jsx_scan.rs`), deduped to prop-name sets in the manifest; residue is unmeasurable.
- Cross-file static-value resolution exists (v1 Phase 2b; v2 statics enrichment in
  `engine.rs` with cycle-guarded re-export following) but is not consulted for JSX
  attribute values.
- Runtime: `systemPropMap` is a pure `(prop → valueKey → class)` lookup; every
  resolution decision passes through `resolveClasses`
  (`packages/system/src/runtime/resolveClasses.ts`). Dynamic variant values already
  expand to the full option universe (reconciler ledger).
- Empirical sample of first-party consumer code: literal attrs dominate ~10:1;
  6 spread-conduit sites in 109 files — residue is likely small and shallow, which is
  why measurement precedes machinery.

Constraints: extract-v2-spine parity gate is live — v1 (`packages/extract/src/`) is
frozen; anything altering CSS, classification, or parity derived-observables is v2-only
and gated on the engine flip. The sibling change `total-dynamic-floor` closes the
silent-drop cliff and owns the runtime fallback totality; this change assumes that floor.

This file supersedes brainstorm.md and proposal.md on any conflict.

## Goals / Non-Goals

**Goals:**

- Make the dynamic residue measurable: per-site records with expression kind + span, and
  a histogram over real builds.
- Convert the unforced Dynamic verdicts: identifiers/member expressions resolvable
  through existing static-value resolution; statically-enumerable conditionals expanded
  into the shared prop map.
- Observe real reachability at the sink: dev-mode witness recorder at `resolveClasses`.
- Gate every further tier (interprocedural summaries, checker oracle, contracts, witness
  feedback) on measurement signals.

**Non-Goals:**

- Building the render-edge/conduit-summary layer now.
- Any checker/type-inference integration now.
- Runtime fallback semantics (owned by `total-dynamic-floor`).
- Any v1 engine modification; any pre-flip change to CSS or classification.

## Decisions

### D1: Residue facts are additive, v2-native, pre-flip safe

- **Choice**: retain expression kind (closed set: `identifier`, `member`, `call`,
  `conditional`, `logical`, `template`, `binary`, `responsive-object-dynamic`, `array`,
  `other`) and byte span on every dynamic usage record in the v2 fact layer; surface
  per-site records under a v2-native camelCase manifest field; change no classification
  behavior.
- **Rationale**: parity compares CSS, transformed-code AST-equivalence, and derived
  observables — v2-native additive fields are outside all three, so measurement can land
  before the flip and produce the histogram that prices every later tier.
- **Alternatives considered**: measuring via ad-hoc grep sampling (done once in the
  session; too coarse — no wrapper depth, conflates non-style attrs); waiting for the
  flip (loses weeks of measurement for no risk reduction).

### D2: Measurement before machinery

- **Choice**: the interprocedural tier and checker tier exist only as Ledger deferrals;
  their packets may not be authored until the histogram signal fires.
- **Rationale**: first-party evidence suggests the residue is small and shallow; the
  expensive tiers are justified only by contrary measurement. This mirrors the repo's
  falsification pattern (extract-v2-spine D4 store experiment).
- **Alternatives considered**: building conduit summaries speculatively (highest
  engineering cost in the whole program, unpriced demand).

### D3: Enrichment is map fattening; the runtime does not change

- **Choice**: statics-into-JSX resolution and enumerable-set expansion inject their
  results as observed static usages into the existing utility-input stream → shared
  prop map entries + emitted classes. The public/NAPI `extractFacts` surface retains raw
  syntax-classified usage facts; enriched usage is an internal, non-serialized engine
  field. Runtime selection uses the existing lookup path untouched. Post-flip, v2-only.
- **Rationale**: the runtime is universe-agnostic by construction; the reconciler
  already expands dynamic variant values to full option sets, so enumerable-set
  expansion has an in-tree precedent and zero runtime risk.
- **Alternatives considered**: a separate "enumerated selection" runtime path
  (rejected: duplicates the lookup that already does exactly this).

### D4: Witness recorder is dev-only, buffered in-page, transport-free

- **Choice**: a bounded ring buffer (default cap 5000 records) on a documented
  `globalThis` handle, appended at `resolveClasses` outcome; records
  `(baseClassName, prop, serializedValue, outcome ∈ static|dynamic|drop)`. Dev-gated
  with the same `typeof process`/`NODE_ENV` idiom as the drop diagnostic; greppable
  token for prod-exclusion checks. Witness-only value serialization occurs inside the
  recorder after its production early-return, never while evaluating a production call
  argument. No network/file transport in this change.
- **Rationale**: the sink observes values after every boundary (spreads, context,
  hooks), making it the cheapest true-reachability oracle; transport/persistence is a
  separate decision with its own signal (DEF-4).
- **Alternatives considered**: dev-server endpoint streaming (premature; needs plugin
  coordination); build-time only analysis (cannot see through boundaries at all).

### D5: Soundness invariant for all enrichment

- **Choice**: enrichment may only move sites dynamic→static/enumerable; inferred value
  sets must contain every runtime-reachable value of the site; anything uncertain stays
  dynamic (the total floor catches it). Project static values are usable only when OXC
  resolves each identifier reference to the exact root const/import symbol; lexical
  shadowing stays dynamic. Partial objects, skipped values, and captured transforms are
  never promoted. Already-static sites must resolve byte-identically.
- **Rationale**: makes every tier independently safe to ship and independently
  falsifiable; unsound narrowing would manufacture missing styles, the exact failure
  class this program exists to eliminate.
- **Alternatives considered**: none serious.

### Retained raw-fact invariant seam

- **Dynamic `AttrFact` payload assertions (#15)**: retain the two fail-loud `expect`s.
  `PropValueResult::Dynamic` structurally supplies kind and span together, and the sole
  production collector clears both together when enrichment promotes a site. Missing
  payloads therefore indicate an internal construction bug; fabricating a residue value
  would violate NS3. Revisit when a second `AttrFact` constructor/deserializer exists or
  a schema-versioned raw-facts redesign can encode the state structurally without
  changing the current serialized contract.

## North Star

**Adversarial cadence K**: 3

- **NS1 (Over-approximation only)**: any value set inferred for a site contains every
  runtime-reachable value; widen on doubt.
- **NS2 (Additivity)**: already-static sites resolve byte-identically across every
  increment.
- **NS3 (Stated-reason residue)**: every dynamic site in the manifest carries a
  machine-readable expression-kind reason.
- **NS4 (Measurement before machinery)**: no interprocedural or checker tier work
  without a measurement that directly observes its resolving predicate. Increment 01's
  kind-only first-party histogram does not observe wrapper depth, typing, or annotation
  resolvability and therefore licenses no such machinery.

## Decision Ledger

| ID    | Decision                                                       | Status   | Owner increment | Resolving signal                                                                 | Review-by                      |
|-------|----------------------------------------------------------------|----------|-----------------|----------------------------------------------------------------------------------|--------------------------------|
| DEF-1 | Build conduit summaries (render-edge layer + fixpoint)         | deferred | external:prop-flow-wrapper-depth-probe | follow-up residue sample carrying wrapper depth + summarizable-shape facts; inc 01 does not measure these | 3 reorientations \| 2026-10-01 |
| DEF-2 | Checker oracle (Node-side batched type queries over residue)   | deferred | external:prop-flow-typed-resolvability-probe | follow-up typed-resolvability probe over residue; inc 01 does not measure this tail | 3 reorientations \| 2026-10-01 |
| DEF-3 | Token-type alias exports (scale-key contracts for wrappers)    | deferred | external:prop-flow-annotation-resolvability-probe | follow-up annotation-resolvability probe over identifier sites; inc 01 does not measure annotations | 3 reorientations \| 2026-10-01 |
| DEF-4 | Witness feedback loop (witness manifests as build hints)       | deferred | external:prop-flow-witness-dogfood | increment-02 dogfood: stable witness sets across showcase dev runs                | 3 reorientations \| 2026-11-01 |
| DEF-5 | Arm-join breadth beyond ternary/`??`/`\|\|` with static arms   | resolved → retain narrow breadth (2026-07-13) | inc 01 | first-party histogram has zero extra arm-join forms (one identifier site total) | fulfilled at inc 01 reorientation |

## Guardrail Register

| ID | Invariant (SHALL NOT ...)                                                    | Scope           | On trip | Status  |
|----|-------------------------------------------------------------------------------|-----------------|---------|---------|
| G1 | SHALL NOT change classification or emitted class of any currently-static site | inc:03 | STOP | passed |
| G2 | SHALL NOT perturb v1↔v2 parity surfaces pre-flip | inc:01 | STOP | passed |
| G3 | SHALL NOT ship witness-recorder code in production bundles | inc:02 | STOP | passed |
| G4 | SHALL NOT modify v1 engine sources (`packages/extract/src/`) | all | STOP | active |

**G1** — static-site invariance (expected: test passes; corpus CSS byte-identical with
enrichment on vs off for fixtures containing only currently-static sites):

```bash
cd packages/extract/crates/extract-v2 && cargo test --lib enrichment_static_invariance
```

**G2** — parity clean pre-flip (expected: scoreboard unchanged, zero new register entries):

```bash
vp run verify:parity
```

**G3** — prod exclusion (expected: build succeeds; rg prints nothing and exits 1; the
token is the witness global handle name). The focused witness test also proves production
variant resolution performs no witness-only serialization:

```bash
bunx vp test run packages/system/__tests__/witness.test.ts
vp run verify:build:showcase && rg -l "__ANIMUS_WITNESS__" packages/showcase/dist/
```

**G4** — v1 frozen (expected: empty output):

```bash
git diff --name-only HEAD -- packages/extract/src/
```

`HEAD` is the immutable apply-session baseline: this repository forbids mutative git
operations, while the feature branch already contains unrelated v1 deltas relative to
`main`.
