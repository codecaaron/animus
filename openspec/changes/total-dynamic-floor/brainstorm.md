# Brainstorm — total-dynamic-floor

> **Exploration evidence**: captured directly from the 2026-07-13 explore-mode session
> (biome_rowan → prop-flow reachability investigation). Two independent code reads
> produced the findings below: one over `packages/system` (runtime + type machinery),
> one over `packages/extract` (v1 `src/` + `crates/extract-v2/`). No interactive
> brainstorm re-run; this file records that evidence and the decision chain it forced.

## The hazard (three independent facts compose)

1. **Runtime drop branch.** `resolveClasses` (`packages/system/src/runtime/resolveClasses.ts:169-218`)
   resolves a system prop value by `systemPropMap[prop][serializeValueKey(v)]` → else
   `dynamicPropConfig[prop]` (CSS-var slot path) → else **silently drops the value** —
   no class, no var, and `filterProps` (`runtime/index.ts:66-72,143-145`) strips the prop
   from the DOM, so nothing surfaces anywhere.
2. **Gated floor.** A prop enters `dynamicPropConfig` only if the build-time scanner saw
   ≥1 *statically visible* dynamic JSX usage of it anywhere in the project
   (`project_analyzer.rs:1248-1282`; v2 mirrors via `dynamic_meta.rs`).
3. **Spread invisibility.** The JSX scanner ignores spread attributes entirely
   (`jsx_scan.rs` `SpreadAttribute(_) => {}`; test `skips_spread_attributes`), so a value
   flowing only through `{...props}` produces **no** dynamic detection.

Composition: a prop used with literals everywhere, then handed a runtime value through a
spread/wrapper boundary, renders **nothing, silently**. This is a correctness cliff, not
a missed optimization — and it fires precisely on the N-boundary flows that motivated the
investigation.

## KNOWN-NOW vs DEFERRED

### Known now (evidence in hand)

- The complete T3 machinery already exists per-prop and is gated only by detection:
  `DynamicPropMeta { var_name, slot_class, property, properties, transform_*, scale_values }`
  (`project_analyzer.rs:251-275`), slot rules emitted into `@layer system` as
  `.{slot} { prop: var(--{var}) }` + per-breakpoint variants (`css_generator.rs:1152-1195`),
  runtime consumption at `resolveClasses.ts:186-214` with `scale_values` pre-baked so scale
  keys resolve without shipping the theme.
- The set of props that can ever reach the lookup is **finite and known at build time**:
  `resolveClasses` iterates `config.systemPropNames`, so the union of `systemPropNames`
  across evaluated components is the exact total floor set. No detection needed.
- Making the floor total is therefore *emission of already-existing machinery for a
  known finite set* — not new analysis.
- Lookup order (`systemPropMap` hit wins before the var path) means a total floor cannot
  change any currently-working static resolution.
- The drop branch is the correct place for a dev-mode diagnostic; both runtime terminals
  (`createComponent`, `createClassResolver`) funnel through this single function.
- The dev diagnostic is engine-agnostic (pure TS runtime change, no CSS/manifest delta)
  and can ship independently of, and before, the emission change.

### Deferred (with resolving signal each)

- **CSS byte cost of the total floor** (slot rules ≈ |active props| × (1 + |breakpoints|)).
  → Resolving signal: measured byte delta on showcase + next-app builds during the
  emission increment; if unacceptable, fall back to "props active on components that
  appear in JSX" (still total for the observable hazard).
- **Custom-prop scope.** Per-component `customDynamicConfig` has the same gating
  (`project_analyzer.rs:1357-1423`); totalizing it multiplies by component count.
  → Resolving signal: the same byte-delta measurement, broken out custom vs system;
  decide inclusion after numbers exist.
- **Implementation engine.** v1 is frozen bug-compatible behind the extract-v2-spine
  parity gate; changing v1 emission perturbs the oracle mid-flip.
  → Resolving signal: extract-v2-spine flip completes (DEF-13 release artifact + next-app
  oracle green). Emission increment lands v2-only, post-flip.
- **Diagnostic escalation policy** (warn once per (component,prop) vs per resolution;
  optional strict mode throwing in test environments).
  → Resolving signal: first dogfood run of the diagnostic on showcase dev.

## Candidate NORTH STAR criteria

- **Totality**: no style value that reaches a leaf animus component may vanish without
  either taking effect (class or var) or emitting a dev diagnostic.
- **Static-path invariance**: any (prop, value) that resolves to a class today resolves
  to the identical class after this change.
- *Provisional*: floor cost stays O(|active props| × |breakpoints|), independent of usage
  count. Revisit signal: the byte-delta measurement.

## Candidate GUARDRAILS

- SHALL NOT change any existing `systemPropMap` lookup result.
  Check: parity-style CSS byte-comparison + transformed-code AST-equivalence on the
  static-only corpus fixtures, before/after.
- SHALL NOT emit slot rules for props inactive on every component.
  Check: unit test asserting slot count == |union of `systemPropNames`|.
- SHALL NOT ship the dev diagnostic into production bundles.
  Check: prod build of showcase; grep dist for the diagnostic string — zero hits.
- SHALL NOT touch v1 engine emission while the extract-v2-spine parity gate is live.
  Check: emission increment is gated on flip completion; `vp run verify:parity` stays
  green with zero new register entries until then.

## Decision chain

1. Investigated "detect runtime prop values through N boundaries" → two code reads
   surfaced facts 1–3 above; recognized their composition as a silent correctness cliff.
2. Options considered:
   - **(a) Total floor — chosen.** Free because the prop-name universe is finite; reuses
     existing slot/var machinery; requires zero detection.
   - (b) Widen detection (scan spreads, trace wrappers) — rejected for this change:
     detection incompleteness *is* the failure mode; fixing it with more detection leaves
     the cliff for whatever the next analysis misses. (Reachability analysis is valuable
     for *optimization* and proceeds separately.)
   - (c) Runtime fallback computing styles from the theme — rejected: violates the
     zero-runtime-computation architecture; `scale_values` already solves value
     resolution via a pre-baked map.
3. Split shippable-now (runtime diagnostic, engine-agnostic) from post-flip (v2-only
   total-floor emission) to respect the live parity gate.
