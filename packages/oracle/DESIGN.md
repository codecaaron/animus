# The Animus Render Oracle

**Working name:** `@animus-ui/oracle` — a Speculative Render Oracle.

**One-sentence definition:** a source-level, incremental, counterfactual model checker
and causal debugger for UI rendering, built on animus's closed, declared style universe.

**Why this exists / why animus:** every other styling substrate is an open world — the
set of rules that can apply to an element is not statically enumerable, so any tool that
answers "why does this look like this" has to render first and reverse-engineer after.
Animus's extraction pipeline is a *closed world*: every rule that can ever exist, every
condition under which it applies, and the source construct that produced it are compiler
outputs. That closure is precisely what makes render facts derivable, cacheable,
attributable, and provable — and it is the reason to use animus at all. This package is
the homogenization layer: the surface through which humans and (especially) LLM agents
inspect, diagnose, simulate, compare, and prove properties of UI behavior using the
system's own semantics, with source provenance and explicit uncertainty, instead of
predictive guessing over pixels or grep.

The product wedge is `explain → simulate → prove`, not "describe what it looks like."

---

## 1. North-star contract

```text
Given:
  a source target or semantic UI target,
  a base program world,
  a scenario or scenario domain,
  optional hypothetical interventions,
  and either a question, symptom, or invariant,

return:
  the strongest render facts supported by the model,
  their source-level derivations,
  the semantic effects of the interventions,
  a proof or counterexample where possible,
  all remaining unknown obligations,
  and the next operation that would produce new information.
```

"Strongest supported facts" means answers are never forced into known/unknown. A fact
value may be exact, a finite set, an interval, symbolic, piecewise over guards, or an
addressable unknown — and independently of its precision it carries an *authority*
(how it was established).

## 2. The canonical abstraction: a render world

Everything operates against an immutable, hashable **RenderWorld**:

```text
RenderWorld =
    ProgramRevision      (the exact source world: working tree / commit / speculative revision)
  + RenderModelVersion   (the oracle's own semantics version)
  + ScenarioDomain       (viewport, mode, variants, states, props, content — point or domain)
  + EnvironmentProfile   (pinned environment assumptions)
  + InterventionSet      (hypothetical deltas, applied without touching source)
  + EvidenceRevision     (the set of valid discharged evidence)
```

Immutability gives sound caching, deterministic comparison, no-progress (fixpoint)
detection, shared computation across speculative alternatives, and exact dependency
invalidation.

## 3. Precision and authority are separate axes

```text
AbstractValue<T> = Exact | FiniteSet | Interval | Symbolic | Piecewise | Unknown
FactAuthority    = StaticProof | DeclaredContract | AbstractBound
                 | MeasuredWitness | EnvironmentAssumption | Heuristic
```

A proven interval over a whole domain can be *stronger* than an exact measurement at one
point. The system never collapses a proven general fact into a point measurement; it
partitions the domain instead (general fact + guarded measured scenario).

## 4. Unknowns are first-class proof obligations

An unknown is never a dead end ("JavaScript involved"). Every unknown has identity, an
origin, a guard, an effect class, an influence scope, an optional current bound, and a
list of discharge procedures. `OUTSIDE_MODEL` is a successful terminal state that names
the residual candidate classes; it is safer than inventing a culprit.

## 5. The unified probe

Every user-facing operation compiles to one canonical query:

```text
RenderProbe = baseWorld + targets + scope + scenario + interventions?
            + objective (fact | symptom | diff | assertion | discharge)
            + budget? + policy?
```

and every operation returns one envelope:

```text
ProbeResult = verdict + summary + facts + derivations
            + semanticDiff? + witnesses? + causalFindings?
            + assumptions + unknowns + modelCoverage
            + knowledgeDelta + nextOperations + stateId
```

Verdicts: `ESTABLISHED | PROVED | DISPROVED | CONDITIONAL | INCONCLUSIVE | FIXPOINT |
OUTSIDE_MODEL`.

**Fixpoint enforcement:** each probe gets a `stateId` derived from (target, objective,
scenario domain, program-world hash, interventions, model version, evidence revision,
assumptions). Repeating a probe against an unchanged state returns `FIXPOINT` with the
prior result reference and the untried progress operations — repeated invocations
without new information are impossible to mistake for progress. Every response exposes
its `knowledgeDelta` (new facts, precision improvements, candidates eliminated, new
obligations).

## 6. The six operations

| Operation  | Question                                                        |
| ---------- | --------------------------------------------------------------- |
| `inspect`  | What can be established about this target in this context?      |
| `explain`  | Why does this symptom occur / why does this fact have this value? |
| `simulate` | What changes in a hypothetical world?                           |
| `diff`     | What render semantics changed between two worlds?               |
| `prove`    | Does this invariant hold across a declared domain?              |
| `refine`   | Resolve this specific unknown as cheaply and narrowly as possible. |

All six are projections of the same render fact graph:

```text
inspect = read facts            explain = traverse derivations backward
diff    = compare fact worlds   simulate = evaluate a hypothetical world
prove   = quantify over worlds  refine  = discharge a specific unknown
```

That reuse — one substrate, many surfaces — is what makes the platform economically
coherent.

## 7. Causal language discipline

`simulate` results use careful terms: *sufficient under domain D*, *necessary under
domain D*, *1-minimal causal set*, *model-relative intervention witness*. "Removing this
makes the symptom disappear" is never equated with "this is the rule that should be
deleted." Causation is not defect attribution; repair choice needs assertions and
change-cost policy.

## 8. Trust model

- **Proofs are always scoped**: program revision + scenario domain + environment
  assumptions + model version + opaque exclusions + evidence dependencies. "Proved"
  means proved *under the stated model and domain*, never "true in all browsers under
  arbitrary runtime code."
- **No silent approximation**: unsupported behavior yields an obligation or
  `OUTSIDE_MODEL`, never plausible-looking exact values.
- **Heuristics live in a separate channel** and never appear as proof-bearing facts.

## 9. Host integration boundary (six providers)

The oracle core is host-independent. A host (here: animus) satisfies a provider
contract; the quality of each provider bounds the strength of derivable facts, never
their soundness:

1. **Style universe provider** — every modeled rule: stable `RuleId`, selector model,
   declarations, condition predicate, precedence order, source provenance, and origin
   (component / variant / prop / state / token).
2. **Invocation & source-identity provider** — stable identities linking source symbol
   → component definition → invocation → generated selector/class.
3. **Render-shape provider** — symbolic host-tree description (conditionals, repetition,
   portals). *(Phase 2+; interface defined now, animus adapter later.)*
4. **Component-contract provider** — declared summaries (intrinsic bounds, content
   domains, opaque obligations). *(Phase 2+.)*
5. **Scenario provider** — named scenario dimensions and domains: breakpoints/viewport,
   color modes, variants, states, props, content contracts.
6. **Dependency provider** — precise edges from source inputs to rules/facts/evidence,
   for incremental invalidation.

## 10. What this branch builds (the spike)

Delivery-sequence position: **Phase 1 (exact cascade + provenance) in full**, plus the
**entire canonical substrate** (worlds, values, authorities, facts, derivations,
obligations, probes, evidence ledger, equivalence classes), plus **Phase-3-shaped
operations restricted to cascade-level facts** (simulate / diff over hypothetical
worlds) and **Phase-4-shaped bounded proof over finite scenario domains**. Symbolic
layout (Layout Constraint IR) is *typed but not derived* — geometry questions return
addressable obligations, not fabricated numbers.

Concretely:

- `src/core/` — value lattice, authorities, predicates/guards, identities & hashing,
  worlds & deltas, fact graph with derivations, obligations, probe envelope + fixpoint
  ledger, evidence ledger.
- `src/providers/` — the six provider interfaces.
- `src/host/animus/` — the real adapter over animus extraction output (see §11).
- `src/engines/` — inspect, explain, simulate, diff, prove, refine, equivalence
  partitioning; all cascade-scoped in this spike.
- `src/protocol/` — agent-facing JSON request/response with progressive disclosure.
- `src/cli.ts` — `oracle inspect|explain|simulate|diff|prove|refine` (human + `--json`).
- Tests — end-to-end killer-demo path at cascade level (see §12).

**Not built now** (deliberately): full layout derivation, browser context capsules
(interface + obligation plumbing only), paint/stacking IR, repair synthesis, LSP.

## 11. Animus host mapping

*(Grounded in the extraction pipeline as of this branch — see the adapter sources for
the authoritative mapping.)* The animus adapter backs:

- **Style universe** from the extraction pipeline's emitted rule set: atomic/component
  classes, their declarations, breakpoint/media conditions, mode/theme selectors, and
  emission order; provenance from the extractor's source spans; origin from the builder
  vocabulary (styles/variants/states/props/tokens).
- **Scenario dimensions** from the system's theme: breakpoint scale → viewport
  intervals; color modes; per-component variant/state/prop domains.
- **Invocation identity** from extraction's component/callsite records.
- **Dependency edges** from the pipeline's per-file ingestion — source file → rules.

Gaps discovered during adaptation are recorded as obligations or `OUTSIDE_MODEL`
exclusions in the adapter, never papered over.

## 12. The demonstration path (acceptance)

The end-to-end test tells this story on a fixture design system:

1. `inspect` a component target under `compact.dark` — effective declarations with
   winners, defeated candidates (with defeat reasons), provenance to source, active
   guards.
2. `explain` a symptom ("this padding is not the token value I set") — backward
   derivation slice naming the defeating rule and its origin, plus one conditional
   unknown.
3. `simulate` two candidate repairs as world deltas without touching source — one is
   sufficient under the domain but has collateral effects in another context class; one
   is clean.
4. `diff` the winning hypothetical world against baseline — classified semantic diff,
   affected context classes only.
5. `prove` an invariant over `breakpoints × modes × variants` — PROVED, and after a
   deliberate break, DISPROVED with a minimized counterexample witness.
6. Repeat step 5 unchanged — `FIXPOINT`, with prior state reference and untried
   progress operations.
7. Ask a geometry question — an addressable `UnknownObligation` with discharge options,
   not a fabricated number.

That path proves the distinctive value: source provenance, context awareness, causal
diagnosis, counterfactual evaluation, bounded verification, collateral checking,
uncertainty honesty, and non-repeating agent search.

## 13. What not to build first

No browser replacement, no full CSS semantics, no state-space enumeration of the
application, no screenshot description, no aesthetic scores, no arbitrary patch
synthesis, no single opaque confidence number, no silent browser fallback, no
pixel-perfect cross-browser claims. The core stays: closed declared model, exact
provenance, incremental facts, explicit uncertainty, side-effect-free speculative
worlds, proof or witness where possible.
