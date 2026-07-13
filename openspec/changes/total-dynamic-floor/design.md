# Design — total-dynamic-floor

## Context

`resolveClasses` (`packages/system/src/runtime/resolveClasses.ts:169-218`) resolves system
prop values by static map lookup, then by CSS-var slot (`dynamicPropConfig`), then **falls
through silently** — no class, no var, and the prop is stripped from the DOM by
`filterProps`. Dynamic metadata is generated lazily: a prop gets a slot **iff** the JSX
scanner detected ≥1 dynamic usage project-wide, and the scanner cannot see spread
attributes at all. The composition is a silent correctness cliff on exactly the flows the
system cannot statically analyze (wrapper/spread boundaries).

Everything needed to close it exists: `DynamicPropMeta` construction (incl. full
`scale_values` per prop), slot-rule emission in `@layer system`, and the runtime var path.
The gap is purely that emission is gated on detection.

Constraints: the extract-v2-spine change is mid-flip; v1 (`packages/extract/src/`) is
frozen bug-compatible behind a parity gate and MUST NOT change. The runtime
(`packages/system`) is engine-agnostic and freely editable.

This file supersedes brainstorm.md and proposal.md on any conflict.

## Goals / Non-Goals

**Goals:**

- Make the CSS-var fallback **total** over the props that can ever be looked up
  (union of `systemPropNames` across evaluated components).
- Make the residual drop branch **observable** in development.
- Measure the CSS cost of totality before extending it to custom props.

**Non-Goals:**

- Widening static detection (spread scanning, wrapper tracing) — that is the separate
  `prop-flow-reachability` change; this change removes the *penalty* for undetected flows.
- Any v1 engine modification.
- Changing static resolution results, class naming, or lookup precedence.
- Runtime computation of styles from the theme.

## Decisions

### D1: Total floor over active system props

- **Choice**: `dynamic_props` metadata + slot rules are generated for **every** prop in the
  union of evaluated components' `systemPropNames`, unconditionally (v2 engine).
- **Rationale**: `resolveClasses` only ever looks up props named in a component's
  `systemPropNames`, so this set is exactly the reachable-lookup universe — totality by
  construction, zero detection required. The machinery (`DynamicPropMeta`, `scale_values`,
  slot emission) already exists and is merely gated.
- **Alternatives considered**: all registered group props (strictly larger than reachable
  set — waste); widening detection (rejected: detection incompleteness is the failure
  mode; any analysis gap re-opens the cliff); runtime theme fallback (rejected: violates
  zero-runtime-computation; `scale_values` already pre-bakes value resolution).

### D2: Dev-mode drop diagnostic in `resolveClasses`

- **Choice**: the fall-through branch emits a development-only diagnostic naming the
  component, prop, and serialized value; compiled out of production bundles via a
  `process.env.NODE_ENV !== 'production'` guard.
- **Rationale**: after D1 the branch should be near-unreachable for system props; anything
  that still lands there (custom props pending DEF-1, config drift) is a bug the user must
  see. Single choke point — both `createComponent` and `createClassResolver` route here.
- **Alternatives considered**: throwing (rejected: a style bug must not crash rendering);
  silent metric counter (rejected: invisible is the current failure).

### D3: v2-only, sequenced after the engine flip

- **Choice**: emission changes land only in `packages/extract/crates/extract-v2/`; the
  emission increment is gated on `external:extract-v2-engine-flip`. The runtime diagnostic
  (D2) ships independently and immediately.
- **Rationale**: v1 is the parity oracle for the live extract-v2-spine gate; touching its
  emission perturbs the oracle mid-flip. The diagnostic changes no CSS and no manifest, so
  it is safe at any time.
- **Alternatives considered**: dual-engine implementation with register entries (rejected:
  double work on a retiring engine, plus deliberate parity divergence noise).

### D4: Lookup precedence unchanged

- **Choice**: `systemPropMap` hit → CSS-var slot → diagnostic. No reordering.
- **Rationale**: guarantees static-path invariance (NS2): any value that resolves to a
  class today resolves identically after this change; the floor only catches what
  previously fell through.
- **Alternatives considered**: none serious.

## North Star

**Adversarial cadence K**: 2

- **NS1 (Totality)**: no style value reaching a leaf animus component may vanish without
  either taking effect (class or var) or emitting a dev diagnostic.
- **NS2 (Static-path invariance)**: every (prop, value) that resolves to a class before
  this change resolves to the identical class after it.
- **NS3 (Bounded floor cost)**: floor CSS stays O(|active props| × |breakpoints|),
  independent of usage count — provisional — revisit when the increment-02 byte-delta
  measurement lands.

## Decision Ledger

| ID    | Decision                                                                 | Status   | Owner increment | Resolving signal                                          | Review-by                        |
|-------|--------------------------------------------------------------------------|----------|-----------------|-----------------------------------------------------------|----------------------------------|
| DEF-1 | Totalize custom props too, or keep them lazy                             | deferred | lazy (03)       | byte-delta measurement artifact from increment 02          | 3 reorientations \| 2026-09-01   |
| DEF-2 | Diagnostic escalation policy (warn-once vs per-hit; strict mode in tests) | deferred | lazy (04)       | first dogfood run of the diagnostic on showcase dev (01)   | 3 reorientations \| 2026-08-15   |
| DEF-3 | Floor-set narrowing fallback (rendered-components-only) if bytes breach NS3 | deferred | lazy (03)     | same increment-02 measurement breaching NS3                | 3 reorientations \| 2026-09-01   |

## Guardrail Register

| ID | Invariant (SHALL NOT ...)                                                        | Scope             | On trip | Status  |
|----|-----------------------------------------------------------------------------------|-------------------|---------|---------|
| G1 | SHALL NOT change any existing `systemPropMap` lookup result                        | increment 02      | STOP    | pending |
| G2 | SHALL NOT emit slot rules for props inactive on every evaluated component          | increment 02      | STOP    | pending |
| G3 | SHALL NOT ship the drop diagnostic into production bundles                         | increment 01      | STOP    | pending |
| G4 | SHALL NOT modify v1 engine sources (`packages/extract/src/`)                       | every increment   | STOP    | active  |

**G1** — static-path invariance (expected: test passes; `system_prop_map` for static-only
fixtures byte-identical with the floor enabled vs disabled):

```bash
cd packages/extract/crates/extract-v2 && cargo test --lib total_floor_static_invariance
```

**G2** — floor set exactness (expected: test passes; slot count == |union of
`systemPropNames`| on the fixture project):

```bash
cd packages/extract/crates/extract-v2 && cargo test --lib total_floor_active_set
```

**G3** — prod stripping (expected: rg finds no matches and exits 1):

```bash
vp run verify:build:showcase && rg -l "animus:drop" packages/showcase/dist/
```

**G4** — v1 frozen (expected: empty output):

```bash
git diff --name-only main -- packages/extract/src/
```
