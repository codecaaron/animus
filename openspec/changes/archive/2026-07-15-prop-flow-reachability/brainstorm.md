# Brainstorm — prop-flow-reachability

> **Exploration evidence**: captured directly from the 2026-07-13 explore-mode session
> (style-universe / N-boundary prop-flow investigation). Grounding: one deep read over
> `packages/system` + `packages/properties` (types + runtime), one over `packages/extract`
> (v1 + `crates/extract-v2`), plus a rough empirical sample of JSX attribute forms across
> `packages/showcase`, `e2e/*`, `packages/test-ds` (~700 literal-ish attrs vs ~70
> expression-valued; 6 spread-conduit sites in 109 files). Sibling change
> `total-dynamic-floor` (drop-cliff closure) was split out as a correctness fix; THIS
> change is the reachability/observability program.

## Problem

The extractor proves reachability only for literal JSX attribute values on name-matched
animus components. Values that are dynamic expressions — or that flow through wrapper
components — fall to the CSS-var runtime path (or, pre-`total-dynamic-floor`, silently
drop). Three structural losses were confirmed:

1. **Payload-free classification.** `PropValueResult::Dynamic` carries no expression
   kind, no span; usages are deduped to prop-name sets. Nothing downstream can say *why*
   a site is dynamic. A residue histogram is impossible from today's manifest.
2. **Unforced Dynamic verdicts.** Member expressions (`p={Tokens.sm}`), resolvable
   identifiers (`p={SPACING_LG}`), and static-armed conditionals classify Dynamic even
   though cross-file static-value resolution already exists (v1 Phase 2b; v2 statics
   enrichment with re-export following) — it is wired into chain configs but not JSX
   attributes.
3. **No render-edge graph.** A non-animus wrapper is invisible; `<Card pad="lg"/>` +
   internal `<Box p={pad}/>` produce two disconnected facts. Interprocedural flow is
   entirely absent (though the summary→cross-file→fixpoint *pattern* already runs twice:
   import/const graph, `.extend()` DAG).

Key architectural gift discovered: the runtime is a universe-agnostic lookup
(`systemPropMap[prop][valueKey]` → class). Any reachability improvement reduces to
*injecting more justified (prop, value) pairs into the map at build time* — enumerated
selection needs zero runtime changes. Precedent in-tree: dynamic variant values already
expand to the full option universe (reconciler ledger `__dynamic__` → all options).
Second gift: every resolution decision funnels through one function (`resolveClasses`),
so a dev-mode witness recorder observes reachability *after* all boundaries, including
context/hooks/network-sourced values.

## KNOWN-NOW vs DEFERRED

### Known now

- Residue facts are purely additive: retain expression kind + span at the classifier
  (v2 `AttrFact` / `DynamicPropUsage`), surface per-site records in v2-native manifest
  fields. No classification behavior change; parity derived-observables unaffected.
- Statics-into-JSX and arm-joins are map-fattening: members of a statically-enumerable
  value set become observed static usages; existing runtime lookup selects at runtime.
- The soundness rule: enrichment may only move sites dynamic→static/enumerable; inferred
  sets must over-approximate runtime-reachable values; widen on doubt; the CSS-var floor
  (change `total-dynamic-floor`) remains the catch-all.
- Witness recorder: dev-only wrap/append at `resolveClasses` outcome, bounded in-page
  buffer, greppable token for prod-exclusion checks.
- Anything that changes emitted CSS or classification must be v2-only and post-flip
  (extract-v2-spine parity gate; v1 frozen).
- The empirical sample says the dynamic residue in first-party code is small (dozens of
  sites) and shallow — which is precisely why measurement precedes machinery.

### Deferred (with resolving signal each)

- **Conduit summaries (render-edge layer + fixpoint)** — the expensive tier.
  → Signal: residue histogram (increment 01 output on showcase + e2e apps) shows a
  material share of dynamic residue at wrapper depth ≥ 1 in summarizable shapes.
- **Checker oracle (Node-side batched type queries over the residue)**.
  → Signal: histogram shows a typed-but-value-unresolvable tail (annotated identifiers,
  imported union types) large enough to justify a `ts.LanguageService` sidecar.
- **Token-type alias exports** (`SpacingKey`-class contracts for wrapper authors).
  → Signal: histogram identifies annotation-resolvable identifier sites; aliases make
  them harvestable via the existing import-graph machinery.
- **Witness feedback loop** (witness manifests as build-time pre-enumeration hints).
  → Signal: recorder dogfood on showcase dev produces stable witness sets across runs.
- **Arm-join breadth** beyond ternary/`??`/`||` with static alternatives (e.g. template
  concatenation partial eval).
  → Signal: histogram kind-counts show the extra forms are non-negligible.

## Candidate NORTH STAR criteria

- Over-approximation only: any value set inferred for a site contains every
  runtime-reachable value of that site; when in doubt, widen to dynamic.
- Additivity: already-static sites resolve byte-identically before and after any
  enrichment; enrichment only converts dynamic→static/enumerable.
- Stated-reason residue: after this change, every dynamic site in the manifest carries a
  machine-readable reason (expression kind), so "dynamic" is a classification, not a
  shrug.
- Provisional: measurement before machinery — no interprocedural tier until the
  histogram licenses it.

## Candidate GUARDRAILS

- SHALL NOT change the classification of any currently-static site.
  Check: fixture-corpus CSS byte-compare before/after enrichment increments.
- SHALL NOT perturb v1↔v2 parity surfaces pre-flip (residue facts are v2-native
  additive only). Check: `vp run verify:parity` green, zero new register entries.
- SHALL NOT ship witness-recorder code in production bundles.
  Check: prod build, `rg` for the recorder token over dist — no matches.
- SHALL NOT modify v1 engine sources. Check: `git diff --name-only main -- packages/extract/src/` empty.

## Decision chain

1. Investigated "extract exact style types / detect values through N boundaries" →
   reframed: universe is config-known; the problem is *reachability* proof at dynamic
   sites; types give finiteness certificates per hop but not call-site narrowing (TS
   does not infer parameter types from call sites).
2. Code reads established the two gifts (universe-agnostic map; single-choke-point
   runtime) and the three losses (payload-free classifier; unforced Dynamic verdicts;
   no render graph).
3. Ranked mechanisms by cost/leverage: (0) total floor → split into sibling change;
   (1) residue facts + histogram — prerequisite for pricing everything else;
   (2) statics-into-JSX + arm joins — existing machinery, depth-0 wins;
   (3) witness recorder — cuts through all boundaries by observing the sink;
   (4) conduit summaries, (5) checker oracle, (6) token contracts — all gated on the
   histogram rather than built speculatively.
