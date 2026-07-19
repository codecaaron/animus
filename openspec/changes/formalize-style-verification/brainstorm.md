# Brainstorm — formalize-style-verification

**Exploration evidence (cited in lieu of re-running the brainstorming skill):**
this change captures a completed investigation (session 2026-07-19): six
parallel exploration agents mapped the extractor invocation surface, the
extraction-graph contents, the runtime style model, tsgo capabilities, the
dev-server integration seams, and the full OpenSpec corpus (zero prior art
for MCP/daemon/LSP concepts); a measured benchmark spike
(`ExtractEngine.analyze()` at 1×/10×/50×/150× synthetic fixture scale); and
three rounds of adversarial design review that produced the settled
development order v3. Durable record: auto-memory
`analysis-harness-feasibility-2026-07` (with `prop-flow-feasibility-2026-07`,
`biome-rowan-evaluation-2026-07` as upstream context). Primary in-repo
evidence: `packages/extract/crates/extract-v2/src/engine.rs` (stateful
kernel), `packages/system/src/runtime/resolveClasses.ts` (pure resolution),
`packages/_parity/src/engine-run.ts` (standalone driver precedent),
`openspec/changes/archive/2026-07-13-extract-v2-spine/journal.md` (DEF-7
timing: 22.3ms cold / 9.8ms uncached re-analyze at 54-file showcase scale).

## The idea

Animus can make a substantial subset of UI styling **formally verifiable** —
not merely faster to test. The unifying abstraction is a formal style-goal
language:

```
Natural-language intent
        │  formalization gap
        ▼
StyleGoal + Environment
        ▼
Typed AnimusPatch candidates
        ▼
Animus semantic kernel  (ExtractEngine analyze + resolveClasses replay + universe index)
        ▼
VerdictEnvelope: exact | divergent | conditional | unknown/unverifiable(span)
```

Inverse solving, best-of-N selection, bisect predicates, PR governance, and
reward research are all consumers of that one contract.

## 1. KNOWN-NOW vs DEFERRED

### Known now (settled by evidence)

- The style universe is closed and finitely described **with named symbolic
  holes**: dynamic prop scalars (SNOWFLAKE slots), contextual-var values,
  runtime theme overrides, and spread-carried props. Runtime is pure class
  lookup; override ordering is fully static (`@layer base < variants <
  compounds < states < system < custom`, standalone/composed sublayers,
  shorthand-before-longhand, topo parent→child merge).
- The kernel host is v2 `ExtractEngine` (stateful NAPI class; no daemon or
  bin exists; standalone invocation proven by the parity child process). v2
  has no cache **by design** — uncached whole-project re-analysis beat v1's
  cache-hit path (DEF-7).
- Cost: 22.3ms cold / 9.8ms re-analyze at real showcase scale; synthetic
  ceiling 420ms at 2,400 files / 3,900 components (analyze() only; manifest
  parse/index/candidate multiplication excluded and unmeasured).
- The manifest already serializes the fact graph: `fileFacts`, `crossFile`,
  `usageResidue` (dynamic sites with byte spans + closed kind set),
  `reverse_provenance`, `system_prop_map`, `dynamic_props`, per-component
  fragments, diagnostics, reconciliation report.
- Two additive Rust facts are **verdict-honesty prerequisites**: static
  callsite spans (`SystemPropUsage.binding` is computed then dropped) and
  spread-presence markers (jsx scan currently skips `SpreadAttribute`
  entirely — the harness cannot even *see* a spread today).
- tsgo (pinned `7.0.0-dev.20260421.2`) embeds `--lsp` and `--api` server
  modes; types encode the complete **input** universe (literal unions) and
  deliberately not the output universe (token values widen to string).
  Deferred off the MVP critical path.
- Dev-mode manifests are only-grow supersets (reconciliation skipped);
  production-mode analyze is the truth source for verdicts.
- Claude Code's built-in LSP client speaks only standard operations → the
  agent surface is CLI/MCP; hover is a later LSP-facade channel.
- No shipped analog exists: Panda's MCP is docs/theming-side; StyleX's
  determinism ships only as a runtime DevTools attribution extension;
  Tailwind offers legibility without an oracle; design-side MCPs verify
  against design intent, not rendered consequence.
- Goodhart: under search/reward pressure the unverifiable holes become
  attractors (spread-routed edits score "no new residue" by omission), so
  `unverifiable` must be explicitly penalized in any selection loop.

### Deferred (each with its resolving signal)

- **tsgo transport (LSP vs `--api`)** — resolve by spike when a StyleGoal
  query first requires type-level validation beyond the manifest (stage 3+).
- **Incrementality in the kernel** — signal: a real consumer workspace where
  production-mode analyze p50 exceeds ~250ms. Until then, whole-project
  re-analysis is the architecture.
- **Per-declaration provenance spans in Rust (4b)** — signal: a concrete
  query the TS-side replay provably cannot answer from stage spans +
  fragments + static cascade order.
- **Interprocedural spread/conduit tracing** — signal: the residue histogram
  (enabled by callsite facts) shows depth≥1 mass (per prop-flow plan).
- **biome_rowan session tier / LSP facade** — signal: harness adoption
  creates demand for editor hover/codemod surfaces (per prior evaluation).
- **Inverse-solver search machinery (CSP/SMT)** — signal: measured
  reverse-index solve rate insufficient on real StyleGoals. Design doc first;
  ranking-by-edit-distance is the product.
- **Training/reward research (RLVR)** — signal: stages 1–4 shipped AND
  best-of-N selection measurably capped by candidate quality.
- **Universe-ledger normalization + schema details** — signal: stage 4
  start; depends on verdict-contract schema stability from stage 1.
- **opx store membership of this change** — workspace opx layer is
  uninitialized (identity/declaration missing; `opx ensure --init` requires
  human-supplied `--repo`/`--grouping`). Recorded repo-local until a human
  initializes opx.

## 2. Candidate NORTH STAR criteria

- **Zero false-exact answers.** The harness may be incomplete; it must never
  be falsely certain. (Not provisional; no revisit signal.)
- **Every answer carries evidence.** Verdict + source facts + environment +
  assumptions + `runtime_confirmation_required` — answers are auditable
  artifacts, not strings.
- **Each oracle stays in its region.** Manifest for output-universe claims,
  types for input-universe claims, witness for runtime claims. No oracle
  answers outside its region.
- **Determinism is inherited, never weakened.** Every harness artifact is
  replayable byte-for-byte (rides the `deterministic-extraction` spec).
- **Adoption rides existing conventions.** `vp run` tier registration,
  parity envelope stamping (`surfaceSchemaSha256` pattern), Change-Type Map
  row — no parallel entry points. (Provisional: revisit if the harness
  outgrows repo-internal use and needs a consumer-facing distribution.)
- **World-model agency.** The manifest is a world model: plan in the model,
  act once. External framing leads with this claim.

## 3. Candidate GUARDRAILS

- SHALL NOT emit verdict `exact` for any element whose facts include a
  spread marker — or whose facts predate spread-marker support. Check: fixture
  with `{...props}` asserting verdict ≠ `exact`.
- SHALL NOT answer production questions from a dev-mode manifest. Check:
  manifests stamped with mode; query layer rejects mode mismatch.
- SHALL NOT let any selection loop score `unverifiable` ≥ `divergent`.
  Check: property test on the scoring function.
- SHALL NOT compare witness records to predictions without matching manifest
  digest / build identity / epoch. Check: triage path asserts envelope match
  else returns `unknown`.
- SHALL NOT claim equivalence beyond "equivalent over observable contract X
  and covered region Y". Check: equivalence result schema requires both
  fields non-empty.
- SHALL NOT auto-delete on reachability weaker than `proven-unreachable`
  (5-state taxonomy: proven-unreachable | conditionally-unreachable |
  unobserved | externally-unknown | dynamically-reachable). Check: pruning
  gate switches on the enum.
- SHALL NOT change existing extraction outputs: new facts are additive with
  byte-identical existing CSS/code. Check: existing `verify:parity` baselines
  pass unchanged.
- SHALL NOT run or authorize `opx promote apply` (human action).

## 4. Decision chain

1. **Six-agent mapping (round 0)** → verdict "assembly, not research": the
   kernel, universe, and data model exist; gaps are persistence, indexing,
   long-lived process, and two dropped facts.
2. **Review round 1 (four pushbacks)** → tsgo demoted off the critical path
   (transport = future spike, LSP-favored); the ~22ms datapoint replaced
   with a measured curve (17/33/110/420ms at 16/160/800/2400 files);
   per-declaration spans (4b) deferred in favor of query-time replay
   attribution; spread blindness elevated from footnote to first-class
   `unverifiable` verdict — which exposed that the spread *fact itself* is
   missing.
3. **Extrapolation review (round 2)** → Goodhart scoring constraint;
   "RLVR for UI" narrowed to *verifiable subreward for declaration-set
   fidelity* (best-of-N now, training-by-inversion later); grammar-constrained
   TSX rejected in favor of a typed AnimusPatch IR applied by deterministic
   codemod (applier substrate = v2 `EmissionPlan`); historical re-analysis
   rejected in favor of a CI-persisted content-addressed universe ledger;
   value/effort reordering (governance first as the adoption trojan horse).
4. **Final consolidation (round 3)** → StyleGoal identified as the missing
   input contract completing the kernel/VerdictEnvelope symmetry; headline
   sharpened to "formally verifiable subset"; equivalence verdict form fixed
   ("contract X, region Y" — where Y for app refactors is the app's entire
   enumerated universe, not a sample corpus); witness record found
   insufficient for cross-process triage (needs digest/identity/mode/epoch);
   five-state reachability taxonomy for pruning; development order v3
   settled: contract+StyleGoal → diff+governance → patch IR+BoN →
   ledger+bisect → solver+symbolic equivalence → training research.

Guiding discipline (epigraph for the whole epic): never call a corpus a
universe, an observation a proof, or the Animus semantic model the complete
browser world.
