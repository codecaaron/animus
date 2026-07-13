# Design — extract-v2-spine

## Context

`packages/extract` is a Rust+NAPI crate that statically extracts CSS from
animus styled-component chains: it parses TS/JSX with oxc (nine crates
hand-pinned at 0.124.0; oxc HEAD is 0.139.0), walks chains, evaluates style
objects, runs user `createTransform` callbacks in embedded QuickJS
(rquickjs), resolves themes, generates layered CSS, and splices transformed
JS back into source. A 2026-07-12 multi-agent audit (evidence in
brainstorm.md, now immutable history) found the architecture fights oxc's
design: the IR escapes the arena into owned strings, forcing repeated
re-parsing; resolution is name-string based with live mis-attribution cases;
emission is raw string surgery; the NAPI boundary swallows errors and
round-trips the whole manifest per file.

A three-reviewer adversarial panel reviewed the brainstorm pre-design; its
amendments are folded in here. Where this file disagrees with brainstorm.md
or proposal.md, **this file wins**.

Constraints: single-maintainer cadence; v1 consumers (vite-plugin,
next-plugin, showcase, e2e apps) must be unaffected until an explicit flip;
repo rules (no mutative git ops; verify tiers fail loud; bun for packages,
vp for tasks); next-plugin runs multiple compiler instances coordinated via
a `globalThis` owning/non-owning singleton.

## Goals / Non-Goals

**Goals:**

- Replace the oxc-consuming spine of `packages/extract` with a parse-once,
  fact-table, span-emission architecture behind a differential parity gate,
  with v1 as the reference oracle.
- Establish the parity harness, adversarial fixture corpus, and
  divergence-register process as durable verification assets.
- Redesign the NAPI boundary: stateful handle, one typed options object,
  errors-as-data, no whole-manifest round-trips.

**Non-Goals:**

- Symbol-correct resolution semantics in the initial spine (post-flip, via
  the register — see D3).
- Shipping sourcemaps in the first release (kept _reachable_ — see DEF-3).
- Watch/incremental redesign, dev-server integration changes (DEF-7).
- Any v1 behavior change beyond the sanctioned determinism patch (D10).
- Migrating consumers (showcase/e2e) to new plugin options beyond the
  engine flag.

## Decisions

### D1 — Parallel spine rewrite behind a parity gate (not incremental refactor)

**Choice:** Build a v2 spine alongside v1 (strangler fig); v1 stays default
and shippable; consumers flip via a plugin engine option.
**Rationale:** The boundary-contract redesign (manifest schema, NAPI
surface, phase structure) is inherently coordinated churn across every
module seam. The correctness/maintainability case (silent error swallowing,
string-typed IR, name-collision unification, JSON-string slicing) carries
the change; performance claims are asymptotically real but unmeasured at
real scale (n≈55 files) — increment 0 records baselines so they become
measured or are dropped from the case. The user explicitly chose this path.
**Alternatives considered:** Incremental in-place repair — viable for
several audited defects, which are module-local (the free-variable walker
sits in the same file that already builds `SemanticBuilder`; the manifest
round-trip dies with one Rust-resident cache), but it repairs modules while
preserving the string-IR contract that couples them; rejected as churn
without the architectural payoff, per the user's call.

### D2 — Parity bar per artifact class, at a pinned measurement point

**Choice:** Compare raw NAPI outputs (before TS post-processing):

- **CSS**: byte-parity primary; order-aware parsed-CSS diff (lightningcss)
  as automatic failure classifier {formatting | rule-order | selector |
  value}.
- **Transformed JS**: AST-equivalence (oxc-parse both, normalized;
  key-order-insensitive for embedded config object literals).
- **Manifest**: no parity by design; compare derived observables — CSS
  text, per-file transform results, per-layer `sheets` contents and
  `component_fragments` VALUES (consumer-visible: dev split delivery,
  fragment caches — inc-02 review), `component_fragments` key-set,
  `reverse_provenance` edge-set, consumer-composition strings (post-parse),
  diagnostics multiset.
  **Rationale:** v1's transformed JS is not byte-reproducible by a
  codegen-based emitter (hand-formatted `format!` templates), and v1's
  manifest is nondeterministic (std HashMap ordering, wall-clock timing).
  Byte-parity where the reference is deterministic and semantically
  order-bearing (CSS), semantic parity where bytes cannot match.
  **Alternatives considered:** uniform byte-parity (unbuildable — panel
  BLOCKING findings ×2); uniform semantic parity (weaker than needed for
  CSS, where cascade order is meaning).

### D3 — Initial spine is bug-compatible with v1's name-based resolution

**Choice:** v2's first spine reproduces v1's name-based resolution
semantics (it may use `oxc_semantic` infrastructure, but resolution _rules_
match v1). Symbol-correct resolution is a separate post-flip increment
entering through the divergence register, with a designed JSX-tag rule:
symbol resolution where resolvable, name-fallback for provider-scope tags.
`mdx-rendering.test.ts` passing under v2 is a named acceptance criterion.
**Rationale:** Symbol-correctness breaks a test-guarded feature (MDX
unimported provider-scope rendering) and, sequenced during bring-up, would
confound every downstream parity failure with intentional divergence —
making the scoreboard unreadable exactly when v2 confidence is lowest.
Both reviewers converged on this independently.
**Alternatives considered:** symbol-first (original brainstorm position;
rejected per above); never fixing resolution (defeats a primary motivation).

### D4 — Owned-AST store as the default spine primitive

**Choice:** `self_cell!{ owner: Allocator + source, dependent: Program }`
(rolldown `EcmaAst` pattern; same in oxc's type checker and linter), stored
in an index-keyed table for the analysis phase; dropped by value after the
last reader.
**Rationale:** Proven three times in shipping code; directly kills the
re-parse economy; keeps phase structure simple.
**STATUS (inc 11): FALSIFICATION FIRED** — the recorded criterion was met
with proof (journal 2026-07-13 00:35: property-tested fact algebra, oracle
green, zero post-resolution program() reads). The store-shrink row (12)
executes the criterion's consequence; its packet carries the reviewer's
reversal criterion and the commit-before-delete external gate.
**Alternatives considered:** deeper parse-time fact extraction (partial-value
IR with named holes, extending `style_evaluator`'s skip model) keeping every
AST per-file-scoped with no self_cell/Send machinery — recorded as the
falsification path: if the chain-evaluation increment demonstrates
parse-time facts suffice for stage evaluation and JSX scanning, shrink the
store to per-file scope (this is NS7's revisit signal in action).

### D5 — Keep rquickjs embedded for user-transform evaluation

**Choice:** Port the evaluator; do not adopt oxc's host-Node-callback model.
**Rationale:** oxlint's callback model serves open plugin ecosystems needing
npm/V8 and costs 64-bit-LE-only, single-Node-thread JS, heavy unsafe, and a
hard Node-launch dependency — the exact properties animus needs to keep
(any-thread eval, self-contained binary). Revisit only if QuickJS
interpreter speed becomes a measured bottleneck.
**Alternatives considered:** threadsafe-function callbacks into host Node
(rejected per above); dropping runtime evaluation for pure static analysis
(rejected: user transforms are arbitrary JS by contract).

### D6 — Umbrella `oxc` crate at current version, caret + lockfile

**Choice:** v2 consumes `oxc` (0.139+) with an explicit feature list plus an
allowlisted set of extras; caret requirements with the committed lockfile
pinning builds; scheduled batch upgrades.
**Rationale:** rolldown's shipping practice; collapses nine hand-synced pins
to one; every oxc 0.x minor is breaking by policy, so caret-vs-exact is
immaterial with a lockfile — the discipline is one version string +
dedicated mechanical bump PRs.
**Alternatives considered:** nine individual exact pins (v1 status quo;
desync hazard, no stability benefit).

### D7 — Stateful NAPI handle, one typed options object, errors-as-data

**Choice:** A `#[napi]` class owning Rust-side analysis state across calls
(rolldown `BindingBundler` two-tier session/build split); one typed options
struct (replacing 14 positional args); one shared error struct
(oxc `OxcError` shape); expected failures are data, exceptions only for
programmer/config faults. The whole-manifest-through-JS round-trip is
eliminated by construction.
**Rationale:** Reference-proven; removes the O(files × manifest) boundary
cost and the arity/stale-binary hazard class.
**Alternatives considered:** stateless functions + Rust-side global cache
(v1's shape; keeps the global-state failure modes without the lifecycle
clarity). Handle _ownership topology_ (per-build vs per-process; next-plugin
multi-compiler owning/non-owning coordination; vitest-worker safety) is
deliberately NOT decided here — DEF-1.

### D8 — Emission via span-chunk splicing with per-unit codegen; single map

**Choice:** MagicString-style span-preserving chunk edits over original
source; `oxc_codegen` only for subtrees the spine actually rewrites; one
sourcemap-capable layer (no multi-stage `collapse_sourcemaps` chain). Raw
`String::replace_range` and JSON-string slicing are banned (G3).
**Rationale:** Span splicing is the industrial norm (rolldown emits per
module then composes strings); animus's transform is chain-length ~2 and
bundlers compose plugin maps downstream, so chain-folding machinery is
rolldown-shaped, not animus-shaped.
**Alternatives considered:** full-program re-codegen (destroys untouched
formatting, guarantees JS parity failure); v1's raw splicing (offset-fragile,
sourcemap-hostile).

### D9 — Narrow containment: ownership module + AST-construction shim only

**Choice:** One module owns the self_cell type; one factory shim owns AST
construction; read-only oxc types (`AST`/`Span`/`Semantic`) flow freely.
**Rationale:** rolldown evidence — 187 files import oxc by design, yet the
0.138 builder break (+2300/−1423) was absorbed almost entirely inside
`ast_factory.rs`. Total type-facades fight the grain for no churn benefit.
**Alternatives considered:** full oxc facade (earlier draft recommendation;
rejected by consumer evidence).

### D10 — Harness first; sanctioned v1 determinism patch

**Choice:** No v2 spine code before the parity harness and its
preconditions. One minimal v1 patch is sanctioned: deterministic
serialization (sorting) of currently HashMap-ordered emitted fields
(compound conditions, `customPropMap`, `customDynamicConfig`), entering the
register as a known v1 fix.
**Rationale:** The oracle does not exist yet — the existing 197 canary
tests are substring assertions; only the corpus is reusable. v1 is not
byte-deterministic against itself (panel BLOCKING ×2), so G8 (self-check)
is a precondition for any baseline. Excluding the nondeterministic fields
instead would weaken the gate where it matters (they are consumer-visible
emitted JS).
**Alternatives considered:** field exclusion (weakens gate); full v1
determinism overhaul (scope creep — manifest-internal nondeterminism is
handled by D2's derived-observables bar instead).

### D11 — TS layer: one assembler, one call site, three type layers

**Choice:** Public `UserConfig` → canonical `ResolvedConfig` → engine
options, normalized in a single assembler module with a single engine call
site per plugin; engine diagnostics pass through with policy (fail-on-warn
style), never reformatted.
**Rationale:** tsdown's shipping shape; makes the engine flag (D1) and
options-object (D7) plumbing one-file concerns per plugin.
**Alternatives considered:** per-call ad hoc assembly (v1 status quo — the
14-arg hazard's TS-side twin).

### D12 — Carry-over means semantics-preserved adaptation, costed per module

**Choice:** `reconciler`, `css_generator`, `theme_resolver`, `chain_merger`
are ported with explicit interface adaptation and per-module cost lines in
the registry — not "as-is."
**Rationale:** Panel BLOCKING finding: none is decoupled — reconciler is
binding-name-keyed, css_generator calls `resolve_styles` (QuickJS seam) and
arbitrates cascade order by class-name prefix matching, theme_resolver
carries the evaluator in its context type, chain_merger's production
surface is only `topological_sort` (merge fns are `#[cfg(test)]`; real
merge semantics live inline in the spine).
**Alternatives considered:** as-is reuse (original brainstorm position;
factually wrong).

### D13 — Divergence register: file-based, prefix-matched, category-typed (resolves DEF-9)

**Choice:** `packages/_parity/register.json` — entries
`{ unit (exact or prefix), artifact | any, category ∈ {intentional-correctness,
ordering, v1-feature-drift, known-quirk}, note, status ∈ {active, anticipated} }`.
Only `active` entries register a divergence; `anticipated` entries document
expected future divergences (pre-seeded v1 quirks) without gating. The
scoreboard prints every registered divergence with its category — coverage
is visible, never silent. Refinement absorbed from the inc-01 review
(RF-4/RF-10): the comparison surface INCLUDES the consumer-composition
observables (`system_prop_map`/`dynamic_props` stringified post-JSON.parse
— JS canonicalizes integer-like keys, so composition-point comparisons are
post-parse by construction).
**Rationale:** File-based + diffable keeps adjudication in review; the
anticipated/active distinction separates documentation from gating;
prefix matching lets one entry cover a fixture family without wildcards.
**Alternatives considered:** per-fixture frontmatter (scatters the
register across the corpus); a single markdown table (not machine-checked).

### D14 — Dual-build layout: sibling crate, one npm package, two engines (resolves DEF-10)

**Choice:** `packages/extract/crates/extract-v2/` — a standalone cargo crate
(own `Cargo.lock`, own `rust-toolchain.toml` pinning 1.97.0 because oxc
0.139's MSRV exceeds the machine-default stable; rustup honors the
directory-scoped pin so v1 keeps building on the default). The npm surface
stays `@animus-ui/extract`: the v2 binary ships inside the package and loads
via the `./engine-v2` export (`index-v2.js`), which fails loud on
unimplemented surfaces. Standard package build produces BOTH engines
(`build` chains `build:v2`); plugins select via one `engine` option flowing
through a single `requireEngine` choke-point (vite: factory-scoped; next:
singleton-propagated so non-owning compiler instances and the webpack
loader honor the owner's choice). `verify:parity` is a first-class vp task
with fail-loud preconditions naming the build command for whichever binary
is missing.
**Rationale:** One crate cannot hold oxc 0.124 and 0.139 simultaneously
(dependency renames would be required) — the crate boundary also makes
v1-isolation structural (G4). One npm package avoids consumer/workspace
churn and keeps the flip a pure option change (NS5).
**Alternatives considered:** feature-flagged single crate (impossible per
above); separate npm package `packages/extract-v2` (consumer plumbing
churn, second publish surface, workspace changes for every consumer).

## North Star

Adversarial cadence K: 3

- **NS1 — Parse once.** Each source file is parsed exactly once per build.
  `provisional — revisit when` a chunk-level post-processing increment
  proposes a bounded throwaway re-parse (rolldown-minify-style); any such
  license is a register entry.
- **NS2 — Pure fact table.** The manifest carries facts (spans, ids, owned
  values), never generated code strings or data whose only consumer
  re-parses it. `provisional — revisit when` a fact is demonstrated cheaper
  to store as a rendered fragment; requires a register entry.
- **NS3 — O(project) boundary.** Total NAPI crossing cost scales with the
  project, not files × manifest. `provisional — revisit when` DEF-7
  (incremental/watch design) lands and re-prices the boundary.
- **NS4 — Span traceability.** Every emitted byte is traceable to a source
  span (sourcemap-ready even while maps don't ship). `provisional — revisit
when` DEF-3 resolves.
- **NS5 — Invisible until flipped.** No consumer-visible behavior change
  without a register entry; v1 fixtures pass at every landed increment.
  Not provisional — this criterion is load-bearing for the whole strategy;
  if it must bend, the change strategy itself is wrong (heretic-stance
  material, not a quiet revision).
- **NS6 — Determinism.** Identical inputs produce identical bytes across
  runs and thread counts, both engines, on the declared comparison surface.
  `provisional — revisit when` a source of benign nondeterminism is found
  that the comparison surface should absorb instead (register entry).
- **NS7 — Reference implementations over novel design.** Prefer shipping
  patterns (oxc/rolldown/tsdown, cited in brainstorm) wherever both exist.
  `provisional — revisit when` a reference pattern demonstrably misfits
  animus's topology — as already happened twice (collapse_sourcemaps chain,
  owned-AST store scope pressure-tested in D4).

## Decision Ledger

| ID     | Decision                                                                                                                                                                                  | Status                  | Owner increment                                          | Resolving signal                                                                                                               | Review-by                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| DEF-1 | v2 NAPI surface + handle topology | resolved (inc 06) | Increment 06 | Grep-proven 4-fn surface; per-instance ExtractEngine (isolation-tested); extract() omitted (canary adapter when needed); plugin TS wiring rides with flip rows | — |
| DEF-2 | Span-chunk dependency | resolved (inc 05) | Increment 05 | Spike ran: string_wizard 1.1.5 fits all three edit shapes natively incl. sourcemaps; light dep tree — DEPEND on the published crate | — |
| DEF-3  | Sourcemap scope for first release (ship maps vs span-ready only)                                                                                                                          | deferred                | TBD                                                      | Consumer fixture debugging demand at flip time + DEF-2 spike cost data                                                         | 3 reorientations \| 2026-10-01 |
| DEF-4 | Allocator strategy | resolved (inc 11) | Increment 11 | Per-task `Allocator::default()` adequate at measured scale (62 files ≈ 15 ms analyze; arenas die per-file post-shrink); pool unjustified absent pressure — adequacy finding, not an A/B benchmark | — |
| DEF-5 | Manifest transfer format | resolved (inc 06) | Increment 06 | Facts returned as JSON once per analyze(); sources + facts Rust-resident on the handle; per-file transforms carry zero manifest payload (NS3) | — |
| DEF-6  | Cargo feature compiling out rquickjs (oxfmt dual-entry pattern)                                                                                                                           | deferred                | TBD                                                      | external:js-free-consumer-need                                                                                                 | 3 reorientations \| 2026-12-01 |
| DEF-7  | Watch/incremental invalidation semantics (state surviving file change; tsdown lifetime-by-mode as template)                                                                               | resolved (inc 13)                | TBD                                                      | v2 spine landed + first dev-server integration increment                                                                       | 3 reorientations \| 2026-11-01 |
| DEF-8  | Formalized oxc upgrade cadence (batch window, bump-PR shape)                                                                                                                              | deferred                | TBD                                                      | external:first-post-v2-oxc-bump                                                                                                | 3 reorientations \| 2026-12-01 |
| DEF-9  | Divergence-register categories & adjudication process                                                                                                                                     | resolved → D13 (inc 02) | Increment 02                                             | Register built + first populated entries                                                                                       | —                              |
| DEF-10 | Dual-build mechanics | resolved → D14 (inc 03) | Increment 03 | Layout decided + both engines building + tiers wired | — |
| DEF-11 | Evaluator reference path: QuickJS (project path) vs TS placeholder resolver (`extract()` path; coerces numeric strings) — pick v2's reference, decide the other's fate                    | resolved (inc 07)       | QuickJS is v2's reference — evaluator.rs verbatim port; seam-battery 14/14 both engines. TS placeholder path dies with extract() (zero plugin consumers, DEF-1 grep) | DEF-1 resolution + G-SEAM battery results on both v1 paths                                                                     | 3 reorientations \| 2026-09-15 |
| DEF-12 | v1 drift policy activation (v1 feature commits must add corpus fixtures; scoreboard tracks known-missing-in-v2 distinctly from divergences)                                               | deferred                | TBD                                                      | external:v1-feature-request-during-rewrite                                                                                     | 3 reorientations \| 2026-12-01 |
| DEF-13 | v2 distribution: release pipeline must build/ship the v2 binary before the `./engine-v2` export is meaningful to npm consumers (today the export exists but no release artifact backs it) | deferred | TBD (flip-preconditions increment) | Flip preconditions met (design.md §Migration Plan) or first external v2 consumer | 3 reorientations \| 2026-11-01 |

## Guardrail Register

| ID  | Invariant (SHALL NOT …)                                                                                                                                                                                                                | Scope                                                                      | On trip | Status                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | v2 spine SHALL NOT parse the same (file, build) twice. Blind spot: counts parser invocations, not lexer-level rescans                                                                                                                  | all                                                                        | STOP    | proposed (parse-counter lands with harness; armed when v2 skeleton increment lands)                                                                                                                                    |
| G2  | v2 manifest types SHALL NOT carry generated JS/CSS code strings. Blind spot: rg denies obvious cases only; authoritative check is human schema review at increment boundaries                                                          | footprint:packages/extract/**/v2\*/** (provisional glob; DEF-10 finalizes) | STOP    | proposed (target tree absent)                                                                                                                                                                                          |
| G3  | v2 emission SHALL NOT use `replace_range` or slice-to-len JSON surgery | footprint:packages/extract/crates/extract-v2/src/** | STOP | active (inc 03; gate empty, control 10× on v1 incl. all four motivating sites) |
| G4  | v2 SHALL NOT depend on/import the v1 crate — carry-over allowlist: EMPTY (crate boundary makes reuse structural; any future allowlist entry requires a register note) | footprint:packages/extract/crates/extract-v2/** | STOP | active (inc 03; no path dep, no v1 symbols) |
| G5  | v2 NAPI exports SHALL NOT swallow errors: malformed input yields non-empty diagnostics or `napi::Result::Err`                                                                                                                          | footprint: v2 NAPI surface                                                 | STOP    | proposed; calibrated: v1 counterexample verified verbatim (lib.rs:937-945 returns source with no diagnostic on malformed manifest)                                                                                     |
| G6  | No landed increment SHALL leave the parity scoreboard red (failures neither fixed nor register-entered)                                                                                                                                | all                                                                        | STOP    | active (inc 02; identity green both modes, 0 unregistered)                                                                                                                                                             |
| G7  | v2 SHALL NOT depend on individual `oxc_*` crates outside {umbrella `oxc`} + allowlist {`oxc_allocator` (if pool needed)} | footprint:packages/extract/crates/extract-v2/Cargo.toml | STOP | active (inc 03; single umbrella line, control 9 pins on v1) |
| G8  | Baselines SHALL NOT be recorded while the self-check is red: v1×2 must byte-match on the declared surface; v2 additionally `--threads 1` vs `--threads N`                                                                              | all                                                                        | STOP    | proposed; calibration evidence: v1 self-nondeterminism already demonstrated statically (HashMap-ordered emitted fields), so the check MUST fail before D10's patch and pass after — that transition is the arming test |
| G9  | The symbol-resolution increment SHALL NOT start before G-USAGE fixtures exist with explicit expected-engine verdicts (MDX provider-scope, aliased imports, duplicate-binding universe, bare `createElement`, `compose()` reassignment) | all                                                                        | STOP    | proposed                                                                                                                                                                                                               |

```text
# G1 — parse budget. INTERIM INSTRUMENT (armed-via-tool at inc 04): the
# harness --parse-count arms for v2 when v2 joins the compare engine set
# (inc 06); until then the budget is enforced by the cross-engine oracle:
cd openspec/changes/extract-v2-spine/tools && bun run chain-parity.ts
# Expected: parseCount == fileCount for every unit; exit 0.
# Structural leg — parser invocations stay contained in the ownership
# module (counted by construction):
rg -l 'Parser::new' packages/extract/crates/extract-v2/src/
# Expected: exactly one file (owned_ast.rs).
vp run verify:parity -- --parse-count
# Expected (from inc 06): per-fixture v2 parse counts equal file counts.
```

```bash
# G2 — rg component (deny-list; authoritative check is human schema review)
rg -n 'format!\(' packages/extract/src/v2 --glob '**/manifest*.rs'
# Expected: no matches writing into manifest-typed fields (human-confirmed).
```

```bash
# G3 — string-surgery ban (positive control first: MUST fire on v1)
rg -n '\.replace_range\(|\[\.\..*len\(\)' packages/extract/src/
# Expected (control): >=4 hits incl. transform_emitter.rs:270,288,329,368  [verified 2026-07-12: 10 hits]
rg -n 'replace_range|\[\.\..*len\(\)' <v2-src-tree>
# Expected (gate): empty. Run control before gate every time; a silent control is a tripped guardrail.
```

```bash
# G4 — v1-import ban (glob finalized by DEF-10)
rg -n 'use crate::(chain_walker|chain_merger|project_analyzer|jsx_scanner|import_resolver|system_loader|theme_resolver|style_evaluator|transform_extractor|transform_evaluator|transform_emitter|reconciler|css_generator)' <v2-src-tree>
# Expected: only allowlisted carry-over modules (allowlist in this row once DEF-10 lands).
```

```bash
# G5 — no-swallow test (lands with v2 NAPI surface)
bunx vp test run packages/extract/tests/v2-boundary-errors.test.ts
# Expected: malformed options/manifest inputs produce non-empty diagnostics; suite green.
```

```bash
# G6 — parity gate
vp run verify:parity
# Expected: scoreboard green — every non-identical fixture carries a register entry.
```

```bash
# G7 — dependency allowlist
grep -E '^oxc' packages/extract/**/Cargo.toml (v2 manifest per DEF-10 layout)
# Expected: only `oxc = ...` (+ allowlisted extras). Any other `oxc_*` line trips.
```

```bash
# G8 — determinism self-check
vp run verify:parity -- --self-check            # v1 twice, byte-diff on declared surface
vp run verify:parity -- --self-check --engine v2 --threads 1,N
# Expected: empty diffs. Known pre-patch state: FAILS on v1 (HashMap-ordered emitted fields) until D10 patch lands — that red→green transition validates the check itself.
```

```bash
# G9 — usage-fixture precondition (structural)
ls openspec/changes/extract-v2-spine/… # authoritative location set by harness increment; fixtures + expected-verdict frontmatter present for all five G-USAGE cases
# Expected: five fixture families present BEFORE symbol-resolution increment row activates.
```

Behavioral batteries that earlier drafts held as guardrails now live in
specs (single-writer rule): CSS-AST classification and measurement-point
pinning → `extraction-parity-harness`; evaluation-seam battery →
`transform-evaluation-contract`; diagnostics-multiset comparison →
`extraction-diagnostics`; usage-case semantics → `rendered-usage-semantics`.

## Risks / Trade-offs

- **[Risk] Parity plateau in the project_analyzer port** (long tail of
  ordering/reconciliation diffs; register fatigue; flip stalls). →
  Mitigation: promote v1's existing sorts to a specified output-ordering
  contract both engines implement (incidental-order diffs die by
  construction); port modules individually behind the harness
  (strangler-within-the-strangler).
- **[Risk] v1 drifts during the rewrite** (bursty history: 43 commits
  Apr–May). → Mitigation: DEF-12 drift policy armed on first feature
  request; scoreboard tracks known-missing-in-v2 as a distinct category.
- **[Risk] Dual-build CI cost and binary-freshness confusion.** →
  Mitigation: DEF-10 is an early, dedicated increment with an explicit CI
  budget; canary freshness checks updated in the same increment.
- **[Risk] Duplicate-binding cascade arbitration** (v1 order is
  stable-but-arbitrary; live Button/Card pairs in showcase+test-ds). →
  Mitigation: ordering category in the register (DEF-9); output-ordering
  contract makes v2's order explicit rather than accidental.
- **[Trade-off] Dual maintenance until flip** — accepted: v1 is dormant
  (last src change 2026-04-21) and the flip is gated, not time-boxed.
- **[Trade-off] Bug-compatible resolution first re-implements known-wrong
  semantics** — accepted: unconfounded parity is worth more during bring-up
  than early correctness; the fix is scheduled, not abandoned (D3).
- **[Trade-off] lightningcss as harness-only dependency** — accepted:
  classifier value outweighs one dev-dependency; never ships in the
  published crate.

## Migration Plan

1. **Land order**: increment 0 (v1 determinism proof + baselines) → parity
   harness + adversarial corpus → dual-build mechanics (DEF-10) → v2 spine
   modules individually behind the harness → flip preconditions
   (scoreboard green across corpus + G-USAGE verdicts honored + consumer
   fixture builds green on v2) → default-engine flip in plugins →
   post-flip increments (symbol-correct resolution, DEF-3/DEF-7 work).
2. **Rollback**: the engine option makes rollback a one-line consumer
   config change at any point post-flip; v1 code is not deleted until a
   separate, later change (out of scope here).
3. **Acceptance**: `vp run verify:parity` green; `vp run verify:full`
   green on both engine settings; `mdx-rendering.test.ts` green under v2;
   no unregistered divergences.
