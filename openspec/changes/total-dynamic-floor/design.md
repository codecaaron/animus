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

- Make the CSS-var fallback **total** over the props that can ever be looked up on
  reconciliation-retained components, conservatively widening on uncertain identity.
- Make the residual drop branch **observable** in development.
- Measure the CSS cost of totality before extending it to custom props.

**Non-Goals:**

- Widening static detection (spread scanning, wrapper tracing) — that is the separate
  `prop-flow-reachability` change; this change removes the *penalty* for undetected flows.
- Standalone package-first extraction that permanently transforms an exported component
  without the downstream consumer source graph. The supported external-package path
  source-walks the package and analyzes it together with the consuming application.
- Any v1 engine modification.
- Changing static resolution results, class naming, or lookup precedence.
- Runtime computation of styles from the theme.

## Decisions

### D1: Total floor over reachable active system props

- **Choice**: `dynamic_props` metadata + slot rules are generated for **every** prop in the
  union of `systemPropNames` on components retained by the reconciliation reachability
  rules (rendered bindings, provenance parents, `asClass`, and compose slots). Imported
  JSX aliases are canonicalized by one identity policy shared with the reconciler. Any
  unresolved component-like identity (including member JSX, local aliases, and dynamic
  `createElement` arguments) widens both the floor and reconciliation retention to all
  evaluated components; lowercase JSX intrinsics and string-literal native elements do
  not widen.
- **Rationale**: `resolveClasses` only ever looks up props named in a retained component's
  `systemPropNames`. The initial all-evaluated floor proved correctness but added 84–447%
  total CSS across first-party consumers. The reconciler's conservative survival
  universe provides a structural upper bound that removes known-dead component props
  without depending on prop-use detection; the current first-party consumers contain no
  such removable props, so their measured bytes remain unchanged.
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

### Retained boundaries and seams

- **Exported but locally unrendered package components (#4)**: retained as outside the
  package-first model above. In supported Vite/Next consumer builds, external package
  source and application render sites enter one analysis graph, so a consumer render is
  not absent. Revisit on the first supported source-unavailable/pretransformed package
  fixture, or an explicit decision to make standalone package extraction authoritative.
- **Diagnostic dedupe granularity (#13)**: the initial `(component, prop)` warn-once key
  remains provisional under DEF-2. A value-inclusive key can retain more evidence but
  can also grow with runtime value cardinality; choose it only after showcase-dev
  dogfood shows distinct values for one component/prop are independently actionable.
- **Detection-only floor seam (#14)**: retain the private `total_system_floor` boolean
  and `detected_dynamic_prop_names` branch for G1's legacy-vs-total comparison.
  Production's sole caller passes `true`. Revisit if a second production caller makes
  the mode variable, the seam reaches a public API, or binary/profile evidence shows
  material retained detection-only work.

## North Star

**Adversarial cadence K**: 2

- **NS1 (Totality)**: no style value reaching a leaf animus component may vanish without
  either taking effect (class or var) or emitting a dev diagnostic.
- **NS2 (Static-path invariance)**: every (prop, value) that resolves to a class before
  this change resolves to the identical class after it.
- **NS3 (Bounded floor cost)**: floor CSS stays O(|reachable active props| ×
  |breakpoints|), independent of usage count. This is an asymptotic reachability bound,
  not a promise of small bytes for a project whose retained components collectively
  expose the full prop universe. First-party measurement accepts the intrinsic current
  totality cost of +84.61% to +447.15%; increment 03 remains valuable for future dead
  components even though it produces zero savings in today's consumers.

## Decision Ledger

| ID    | Decision                                                                 | Status   | Owner increment | Resolving signal                                          | Review-by                        |
|-------|--------------------------------------------------------------------------|----------|-----------------|-----------------------------------------------------------|----------------------------------|
| DEF-1 | Totalize custom props too, or keep them lazy                             | resolved → keep lazy (2026-07-13) | inc 02 | byte-delta measurement artifact from increment 02 | fulfilled at inc 02 reorientation |
| DEF-2 | Diagnostic escalation policy (warn-once vs per-hit/value; strict mode in tests) | deferred | lazy (04)       | first dogfood run of the diagnostic on showcase dev, including whether distinct values per component/prop are independently actionable | 3 reorientations \| 2026-08-15   |
| DEF-3 | Floor-set narrowing fallback (reconciliation-retained components) if bytes breach NS3 | resolved → narrow (2026-07-13) | inc 03 | inc 02 measured +84.61% to +447.15% total CSS | fulfilled at inc 02 reorientation |

## Guardrail Register

| ID | Invariant (SHALL NOT ...)                                                        | Scope             | On trip | Status  |
|----|-----------------------------------------------------------------------------------|-------------------|---------|---------|
| G1 | SHALL NOT change any existing `systemPropMap` lookup result                        | increments 02–03  | STOP    | passed  |
| G2 | SHALL NOT omit a prop active on any reconciliation-retained component, SHALL use one canonical identity set for floor and reconciliation, and SHALL widen both on uncertain component identity | increment 03 | STOP | passed |
| G3 | SHALL NOT ship the drop diagnostic into production bundles                         | increment 01      | STOP    | passed  |
| G4 | SHALL NOT modify v1 engine sources (`packages/extract/src/`)                       | every increment   | STOP    | active  |

**G1** — static-path invariance (expected: test passes; `system_prop_map` for static-only
fixtures byte-identical with the floor enabled vs disabled):

```bash
cd packages/extract/crates/extract-v2 && cargo test --lib total_floor_static_invariance
```

**G2** — reachable floor exactness (expected: tests pass; dead component props are absent,
rendered/import-aliased/asClass/compose/parent props are present, uncertainty widens):

```bash
cd packages/extract/crates/extract-v2 && cargo test --lib total_floor_reachability
```

**G3** — prod stripping (expected: rg finds no matches and exits 1):

```bash
vp run verify:build:showcase && rg -l "animus:drop" packages/showcase/dist/
```

**G4** — v1 frozen (expected: empty output):

```bash
git diff --name-only HEAD -- packages/extract/src/
```

`HEAD` is the immutable apply-session baseline: this repository forbids mutative git
operations, while the feature branch already contains unrelated v1 deltas relative to
`main`.
