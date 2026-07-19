# Design — formalize-style-verification

## Context

Animus's founding thesis (the Finite Style Machine: ENUMERATE → TRANSACT →
RECONCILE → SNOWFLAKE) produces a closed, finitely-described style universe
with named symbolic holes. The 2026-07-19 investigation (see brainstorm.md
for the evidence record) established that the three oracles needed for
formal verification of styling edits already exist — the v2 `ExtractEngine`
(output universe), the type system (input universe), and the witness buffer
(runtime evidence) — and that what is missing is a versioned verdict
contract, an agent-facing query surface, and two additive extraction facts.

Current state: no CLI, daemon, or MCP exists; the manifest is never
persisted; Vite plugin state is closure-private while the Next plugin parks
it on `globalThis`; static callsite locations and spread presence are not
recorded; the witness record carries no build identity. No competing styling
system ships an equivalent capability (verified 2026-07-19: Panda's MCP is
docs-side; StyleX attribution is runtime-only; Tailwind has no oracle).

Constraints: the repo's verification interface is `vp run` tiers governed by
`verification-tier-policy`; extraction outputs are locked byte-identical by
`deterministic-extraction` and the parity baselines; the opx layer of this
workspace is uninitialized, so this change is recorded repo-local through the
standard openspec flow (see DEF-10).

Stakeholders: repo maintainer (codecaaron); AI agents operating in this repo
(primary consumers of the harness); downstream Animus adopters (eventual
consumers of the strategic capability).

## Goals / Non-Goals

**Goals:**

- A versioned, evidence-carrying verdict contract (StyleGoal in,
  VerdictEnvelope out) with a zero-false-exact obligation.
- A server-free analysis session over the existing kernel, exposed as CLI +
  MCP, registered in the repo's verification interface.
- Semantic universe diffs and PR governance as the first shipped product.
- Verdict-honesty facts (callsite spans, spread markers) landed additively.
- A staged path to patch IR + speculation, ledger + bisect, solver, and
  reward research — each gated on its predecessor's evidence.

**Non-Goals:**

- Proving final browser computed style or layout (external CSS, inheritance
  context, fonts, DOM structure, hydration remain outside the model — the
  harness explains the *style plan*, not the pixel).
- A complete UI reward function (only a verifiable subreward for
  declaration-set fidelity).
- Editor/LSP surfaces, incremental analysis, or a biome_rowan session tier
  (deferred with signals; see Ledger).
- Consumer-facing packaging or publication of the harness (repo-internal
  until adoption evidence; NS5).

## Decisions

### D1: Four-valued verdict taxonomy with penalized `unverifiable`
- **Choice**: every answer is `exact | divergent | conditional |
  unverifiable(span)`; selection loops MUST score `unverifiable` strictly
  below `divergent`.
- **Rationale**: under best-of-N or reward pressure the analysis holes become
  attractors — spread-routed edits score "no new residue" by omission. Only
  an explicitly-scored boundary prevents optimizing into blind spots.
- **Alternatives considered**: boolean pass/fail (hides the boundary);
  three-valued without `conditional` (cannot express external-CSS collisions
  and value-dependent outcomes, forcing dishonest exact/unknown coin flips).

### D2: Kernel = long-lived v2 `ExtractEngine`, whole-project re-analysis, no incrementality
- **Choice**: the session holds one engine per (workspace, mode) and re-runs
  `analyze()` on change; no cache, no per-file invalidation.
- **Rationale**: measured — v2 uncached re-analysis (9.8ms at 54-file
  showcase scale) beats v1's cache-hit path (DEF-7, extract-v2-spine
  journal); the synthetic ceiling is 420ms `analyze()` at 2,400 files.
  Incrementality machinery is deleted complexity, not deferred complexity.
- **Alternatives considered**: v1's content-hash cache (superseded by the
  same measurement); a new incremental fact store (unjustified by any
  observed workload; revisit trigger in DEF-2).

### D3: Winner attribution by query-time replay, not recorded spans
- **Choice**: "which declaration wins and why" is computed at query time by
  replaying `resolveClasses` + per-layer fragments + the static cascade
  order (layers → sublayers → shorthand tier → source order), joined to
  stage spans from `fileFacts` for authoring attribution.
- **Rationale**: the cascade is fully static, so the winner is derivable
  from data the manifest already carries; threading spans through theme
  resolution touches `ResolvedStyles`/`CssDeclaration` across the Rust
  pipeline (interning, dedup) for no additional query power.
- **Alternatives considered**: per-declaration provenance spans in Rust
  (deferred as DEF-3 until a replay-unanswerable query is documented).

### D4: Two additive facts are verdict prerequisites; manifest evolution is additive-only
- **Choice**: land static system-prop callsite records (file + span, the
  currently-dropped `SystemPropUsage.binding` link) and element-level
  spread-presence markers (flag + span) as new manifest fields; all existing
  fields and emitted CSS/code stay byte-identical.
- **Rationale**: without spread markers the harness cannot *see* spreads
  (the JSX scan skips `SpreadAttribute` entirely) and zero-false-exact is
  unachievable; without callsite spans, static usage questions ("which lines
  render p=8") are unanswerable. Additive-only evolution follows the
  `usage-residue-facts` precedent and keeps parity baselines valid.
- **Alternatives considered**: TS-side JSX re-scanning in the harness
  (second parser, drift risk, violates single-source-of-facts); waiting for
  total-dynamic-floor (complementary but addresses survival, not
  visibility — see DEF-11).

### D5: Edits as typed AnimusPatch IR applied by deterministic codemod
- **Choice**: models emit a typed patch ("set prop X on component Y to Z")
  validated against per-project schemas compiled from the manifest (literal
  unions from `system_prop_map`, variant options, state names); a
  deterministic codemod applies it via span-addressed emission
  (`EmissionPlan`-style replacements). Free-form TSX editing remains the
  fallback for structural changes, always followed by verification.
- **Rationale**: schema-compiled tool calls make invalid styles
  unrepresentable at the tool boundary without sampler tricks;
  grammar-constrained decoding of prop islands inside free-form TSX does not
  work with current samplers; schema-validity still does not imply intent
  correctness, so the kernel verifies every patch regardless.
- **Alternatives considered**: grammar-constrained TSX generation (rejected:
  infeasible islands); unconstrained generation + verify only (kept as the
  structural-edit fallback, not the primary mutation path).

### D6: Universe ledger over historical re-analysis
- **Choice**: CI persists a normalized, content-addressed universe snapshot
  per commit, stamped with engine identity + contract schema version (the
  parity envelope pattern: `surfaceSchemaSha256`/`corpusSha256`); bisect,
  PR diffs, and training-data extraction are ledger comparisons.
- **Rationale**: re-running historical commits drags historical NAPI
  binaries, dependencies, and schema versions — that cost dominates
  analysis. Content-addressing is sound because `deterministic-extraction`
  guarantees byte-identical output.
- **Alternatives considered**: per-commit worktree re-analysis (kept only as
  the degradation path for pre-ledger history, bounded and fail-graceful).

### D7: Agent surface = CLI + MCP registered as `vp run` tiers; LSP facade deferred
- **Choice**: the query core ships behind a CLI (CI/one-shot) and an MCP
  server (agent sessions); both register in the verification interface and
  the Change-Type Map. Hover/LSP is a later facade over the same core.
- **Rationale**: agent LSP clients (including Claude Code's) speak only
  standard operations — custom provenance queries cannot ride LSP;
  `verification-tier-policy` names the Change-Type Map as the agent-facing
  instructability surface, so the harness must join it, not bypass it.
- **Alternatives considered**: LSP-first (blocked by client capability);
  standalone binary outside vp (parallel entry point, violates NS5).

### D8: tsgo stays off the critical path
- **Choice**: no tsgo dependency in stages 1–2; batch `verify:compile`
  remains the type gate. The embedded `--lsp` / `--api` server modes are a
  later spike (DEF-1) when a StyleGoal first needs type-level validation.
- **Rationale**: the API mode is an undocumented dev-snapshot protocol
  (upstream labels it not ready); the manifest + replay answer every stage
  1–2 query without type services.
- **Alternatives considered**: `--api` sidecar now (protocol churn risk for
  zero MVP queries served); LSP sidecar now (same conclusion, better
  protocol — preserved as the favored spike candidate).

### D9: Reward claim scoped to a verifiable subreward
- **Choice**: the harness is positioned as a cheap, compositional,
  provenance-rich semantic verifier for a bounded region of frontend work —
  declaration-set fidelity. Best-of-N deterministic filtering ships in stage
  3; training/inversion research is gated last (DEF-6).
- **Rationale**: the verifier scores an IR, not UI quality; the statement
  problem (goal formalization) bounds what any formal verifier can claim.
  WebArena/Design2Code-style evaluators exist for the rest — slower and
  less attributable, but they cover what this cannot.
- **Alternatives considered**: "UI joins the verifiable-rewards regime"
  (overclaim; rejected in review).

### D10: Production-mode manifests are the verdict truth source
- **Choice**: all verdicts derive from production-mode analysis; dev-mode
  (only-grow, reconciliation-skipped) manifests serve only witness
  correlation and live-tap convenience, and every manifest is stamped with
  its mode.
- **Rationale**: dev-mode manifests are supersets that accumulate stale
  values across HMR by spec (`dev-mode-only-grow`); answering production
  questions from them produces false positives. Cost is a non-issue (dev ≈
  prod analyze cost, measured).
- **Alternatives considered**: dev-manifest reuse for speed (rejected: wrong
  answers at no meaningful savings).

### D11: Harness working home is `packages/_verify`
- **Choice**: all harness code lands in a private workspace package at
  `packages/_verify` (underscore convention shared with `_parity`,
  `_integration`, `_assertions`); external identity, name, and
  publishability remain deferred (DEF-8).
- **Rationale**: increments need a stable footprint now; the private
  convention already exists for load-bearing internal packages and defers
  nothing that matters until adoption evidence arrives.
- **Alternatives considered**: deciding the public name up front (couples a
  marketing decision to plumbing increments); a `tools/` root (new
  top-level edit surface, heavier Change-Type Map obligation).

## North Star

**Adversarial cadence K**: 3

- **NS1**: Zero false-exact answers — the harness may be incomplete, never
  falsely certain.
- **NS2**: Every answer carries evidence, environment, assumptions, and
  `runtime_confirmation_required` — answers are auditable artifacts.
- **NS3**: Each oracle stays in its region: manifest for output-universe
  claims, types for input-universe claims, witness for runtime claims.
- **NS4**: Determinism is inherited, never weakened — every harness artifact
  is byte-replayable.
- **NS5**: Adoption rides existing conventions (vp tiers, parity envelope
  stamping, Change-Type Map rows; no parallel entry points) — provisional —
  revisit when the harness gains consumers outside this repo.
- **NS6**: The manifest is a world model: plan in the model, act once —
  browser demoted to spot-check oracle. Provisional — revisit if witness
  triage shows systematic model/runtime divergence beyond the named holes.

## Decision Ledger

| ID     | Decision                                             | Status   | Owner increment | Resolving signal                                                                 | Review-by                      |
| ------ | ---------------------------------------------------- | -------- | --------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| DEF-1  | tsgo transport: LSP vs `--api` sidecar               | deferred | lazy (stage 3+) | first StyleGoal query requiring type-level validation beyond the manifest        | 3 reorientations \| 2026-10-31 |
| DEF-2  | kernel incrementality                                | deferred | lazy            | external:consumer-scale-p50-breach (prod-mode analyze p50 > 250ms, real workspace) | 3 reorientations \| 2026-12-31 |
| DEF-3  | per-declaration provenance spans in Rust             | deferred | lazy            | journal-documented query that replay provably cannot answer                       | 3 reorientations \| 2026-12-31 |
| DEF-4  | interprocedural spread/conduit tracing               | deferred | lazy            | residue histogram (post inc-02 facts) shows depth≥1 mass                          | 3 reorientations \| 2026-12-31 |
| DEF-5  | solver search machinery (CSP/SMT vs reverse indexes) | deferred | lazy (stage 5)  | measured reverse-index solve rate insufficient on real StyleGoals                 | 3 reorientations \| 2027-01-31 |
| DEF-6  | training/reward research go/no-go                    | deferred | lazy (stage 6)  | stages 1–4 shipped AND best-of-N measurably capped by candidate quality           | 3 reorientations \| 2027-03-31 |
| DEF-7  | ledger normalization + snapshot schema details       | deferred | lazy (stage 4)  | stage-1 verdict contract schema stable through one full adversarial pass          | 3 reorientations \| 2026-11-30 |
| DEF-8  | harness package identity, name, publishability       | deferred | lazy (stage 2)  | PR governance comment in active use on this repo                                  | 3 reorientations \| 2026-10-31 |
| DEF-9  | biome_rowan session tier / LSP hover facade          | deferred | lazy            | external:editor-surface-demand (hover/codemod demand from harness users)          | 3 reorientations \| 2027-03-31 |
| DEF-10 | opx store membership of this change                  | deferred | n/a             | external:opx-workspace-init (human runs `opx ensure --init --repo … --grouping …`) | 3 reorientations \| 2026-09-30 |
| DEF-11 | coordination with total-dynamic-floor (spread survival) | deferred | lazy         | external:total-dynamic-floor-landed (drafted change applied in some worktree)     | 3 reorientations \| 2026-10-31 |

## Guardrail Register

| ID  | Invariant                                                                                                                                              | Scope                                  | On trip | Status          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------- | --------------- |
| G1  | SHALL NOT emit verdict `exact` for any element carrying a spread marker, or whose facts predate spread-marker support                                    | footprint:packages/*verify*/**         | STOP    | proposed        |
| G2  | SHALL NOT derive verdicts from a dev-mode manifest (mode stamp checked at query entry)                                                                  | footprint:packages/*verify*/**         | STOP    | proposed        |
| G3  | SHALL NOT change existing extraction outputs: parity baselines byte-identical for pre-existing fields (blind spot: does not cover new additive fields)   | footprint:packages/extract/**          | STOP    | active          |
| G4  | SHALL NOT let any selection scoring rank `unverifiable` ≥ `divergent`                                                                                    | inc:08                                 | STOP    | proposed        |
| G5  | SHALL NOT compare witness records to predictions without matching manifest digest, build identity, mode, and epoch                                       | footprint:packages/*verify*/**         | STOP    | proposed        |
| G6  | SHALL NOT report equivalence without non-empty `contract` and `coveredRegion` fields in the result                                                       | footprint:packages/*verify*/**         | WARN    | proposed        |
| G7  | SHALL NOT auto-delete on reachability weaker than `proven-unreachable` (5-state taxonomy)                                                               | change-end                             | STOP    | proposed        |

```text
G1 — check (armed when the verdict engine increment lands):
bunx vp test run packages/_verify/__tests__/spread-verdict.test.ts
Expected: PASS — fixture with `{...props}` on a styled element yields verdict `unverifiable` with a span, never `exact`.
```

```text
G2 — check (armed with the query surface):
bunx vp test run packages/_verify/__tests__/mode-gate.test.ts
Expected: PASS — feeding a devMode:true manifest to any verdict query returns an error, not an answer.
```

```text
G3 — check (runnable today):
vp run verify:parity
Expected: PASS. Calibrated 2026-07-19 on the current tree (which carries
in-flight uncommitted extract/*.rs edits from an unrelated refactor):
"PARITY GATE: PASS", exit 0 — all usage-case families identical. Expected
transition: stays PASS after every extract-footprint increment of this
change; any divergence is a STOP.
```

```text
G4 — check:
bunx vp test run packages/_verify/__tests__/scoring-order.property.test.ts
Expected: PASS — property test over candidate sets asserting score(unverifiable) < score(divergent) for all inputs.
```

```text
G5 — check:
bunx vp test run packages/_verify/__tests__/witness-envelope.test.ts
Expected: PASS — triage of records lacking or mismatching {manifestDigest, buildId, mode, epoch} returns verdict `unknown`.
```

```text
G6 — check:
bunx vp test run packages/_verify/__tests__/equivalence-schema.test.ts
Expected: PASS — result schema rejects equivalence outputs with empty contract/coveredRegion.
```

```text
G7 — check (change-end):
rg -ln "auto-delete|autoDelete|pruneComponent" packages/_verify/src 2>/dev/null || echo "no deletion path — vacuously PASS"
Expected: if no auto-deletion path exists in the harness (the current plan
builds none), the check passes vacuously. If any hit appears, then
`rg -n "proven-unreachable" packages/_verify/src` must also hit at that
gate, and manual review confirms deletion switches on the 5-state enum with
only proven-unreachable auto-deleting.
```

## Risks / Trade-offs

- **[Risk] tsgo protocol churn** → kept off the critical path (D8); exact
  pin already repo policy; spike decides transport with LSP favored.
- **[Risk] Goodhart residue beyond spreads** (props flowing through
  wrappers, render props) → markers cover JSX spread visibility only; the
  witness channel plus the empty-universe-diff-on-style-edit alarm catch
  what static facts cannot; DEF-4 owns escalation.
- **[Risk] additive manifest fields perturb parity observables** → new
  fields use `skip_serializing_if` and are excluded from existing
  `UnitSurface` observables; G3 gates every extract-footprint increment.
- **[Trade-off] whole-project re-analysis over incrementality** → accepted
  on measurement (D2); DEF-2 names the reversal trigger.
- **[Trade-off] attribution recomputed per query instead of recorded** →
  accepted; replay cost is milliseconds and avoids a Rust data-model change
  (D3); DEF-3 names the reversal trigger.
- **[Trade-off] epic breadth vs. delivery risk** → stages 3–6 are lazy
  registry rows gated on signals; only stages 1–2 are eagerly decomposed.
- **[Risk] manifest size at scale (8MB at synthetic ceiling)** →
  parse-once-and-index in the session; queries never re-serialize; ledger
  snapshots are normalized and compressed.

## Migration Plan

No consumer-facing deployment change. Landing order follows the Increment
Registry (tasks.md): contract → facts → session/CLI/MCP → diff/governance,
then signal-gated stages. Each extract-footprint increment is
rollback-trivial (additive fields, byte-identical existing outputs, G3
gated). The CI ledger step lands disabled-by-default and flips on after one
week of shadow operation. Acceptance: stage-2 exit = a PR on this repo
carrying a universe-diff governance comment produced by the harness, with
every verdict in it either `exact` with evidence or honestly bounded.
