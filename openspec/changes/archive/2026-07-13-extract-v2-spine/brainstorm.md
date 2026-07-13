# Brainstorm — extract-v2-spine

## Exploration evidence (decision chain input)

This brainstorm captures pre-existing exploration evidence rather than a fresh
interactive session, per the schema's evidence-exists path:

- **2026-07-12 five-agent oxc exploration** (session: oxc architectural lessons
  for animus): oxc crate-layering/allocator architecture, oxc NAPI boundary
  design, a candid current-state audit of `packages/extract`'s oxc usage,
  oxc testing/conformance infrastructure, oxc versioning & consumer
  methodology (oxc pinned 0.124.0; oxc HEAD 0.139.0).
- **2026-07-12 three-agent confirmatory pass**: rolldown deep-dive (owned AST,
  stateful NAPI, churn absorption, emission+sourcemaps), oxc apps tier
  (oxlint js_plugins / oxfmt dual-entry / config / AllocatorPool), tsdown TS
  orchestration layer.
- Headline conclusions persisted in project memory
  (`oxc-consumer-audit-2026-07`); representative file:line citations inline
  below were verified by the exploring agents against the local checkouts at
  `~/agent-workspaces/me-im-counting/{oxc,rolldown,tsdown}`.

## Problem statement

`packages/extract` consumes oxc as a parser vendor, not a pipeline. Root
cause: the intermediate representation escapes the arena into owned
strings/JSON immediately, then buys back AST access by re-parsing.
Defining defects (audit citations):

- Re-parse economy: a k-stage chain parses its file k+3 times
  (`packages/extract/src/lib.rs:683,729`); Phase 5/5b re-parse per stage and
  per file (`project_analyzer.rs:1048,1100`); `system_loader.rs` parses each
  module 3×. Admitted in-code: "For now, we re-parse each stage's argument
  span" (`lib.rs:434`).
- Manifest stores replacement _strings_, not facts, forcing `transform_file`
  to re-parse and to deserialize the whole project manifest per file call
  (`lib.rs:937`) — O(files²) boundary cost.
- Hand-rolled semantic analysis where `oxc_semantic` fits: incomplete
  free-variable walker (`transform_extractor.rs:221-500`), name-based (not
  symbol-based) resolution in `import_resolver.rs` / `chain_walker.rs` /
  `jsx_scanner.rs` — shadowed bindings mis-attribute.
- Emission is raw string surgery: `String::replace_range` splicing, JSON
  string slicing (`transform_emitter.rs:270`), import decisions by
  substring-grep of generated code (`transform_emitter.rs:380-409`), no
  sourcemaps despite exact spans being available.
- NAPI boundary: 14 positional args on `analyze_project`, three inconsistent
  error behaviors, silent swallow of malformed manifest (`lib.rs:939-945`).
- 15 oxc minors behind; nine hand-synced crate pins.

## Decision chain

1. Audit diagnosed the IR (owned strings + re-parse) as the root cause; the
   defect is load-bearing across the manifest schema, phase structure, and
   NAPI surface.
2. Incremental refactor vs parallel rewrite evaluated: punch-list items 1–3
   amount to _changing the IR_, which churns every module seam anyway —
   incremental cost ≈ rewrite cost, plus it inherits the old architecture's
   bias. User explicitly opted for the parallel rewrite.
3. Confirmatory pass verified every spine component has a shipping reference
   implementation (rolldown/oxc/tsdown — see KNOWN-NOW), reducing rewrite
   design risk to near zero.
4. The differential oracle already exists in-repo (verify:canary snapshots,
   verify:integration, three consumer fixture builds + positional
   assertions), so a parity-gated parallel rewrite is the low-risk path:
   v1 becomes the reference-output generator.
5. Known tension surfaced during exploration (recorded, not resolved here):
   adopting symbol-based resolution _fixes bugs whose current behavior v1's
   output embodies_ — strict byte-parity and correctness fixes conflict on
   affected inputs. rolldown faced the same shape vs Babel and ships an
   `overrides/` folder recording intentional deviations
   (`rolldown transform_conformance` pattern); v2 needs the equivalent
   (an intentional-divergence register) baked into the parity gate.

## KNOWN-NOW (evidence-settled; seeds design.md §Decisions)

- **Parallel spine rewrite**, v1 untouched and shippable throughout
  (strangler fig; consumers flip via plugin flag). Not a total rewrite:
  ~8 of 14 modules form the oxc-touching spine; the 4 pure-JSON modules
  (`chain_merger`, `reconciler`, `theme_resolver`, `css_generator`) port
  as-is initially; the rquickjs evaluator is ported, not reinvented;
  `style_evaluator`'s skip-don't-bail design and `jsx_scanner`'s `Visit`
  usage carry forward.
- **Owned AST primitive**: `self_cell!{ owner: Allocator + source,
dependent: Program }` — rolldown `EcmaAst`
  (`rolldown_ecmascript/src/ecma_ast/program_cell.rs:5-22`), same pattern in
  oxc's type checker (`oxc_type_checker/src/compiler/source_file.rs`) and
  linter (`oxc_linter/src/service/runtime.rs:110`). Parsed files become
  owned, movable, `Send` values held in an index-keyed store for the whole
  build; dropped by value after the last reader (rolldown
  `render_chunk_to_assets.rs:54-57` documents the drop point).
- **Facts vs AST**: the manifest is an owned fact table referencing the AST
  only by `Span`/`NodeId`/`SymbolId` (rolldown `EcmaView`,
  `ecma_view.rs:98-140`); oxc's owned `Scoping` extracted once via
  `semantic.into_scoping()` and reused, never re-derived.
- **Symbol-based resolution** via `oxc_semantic` replaces the hand-rolled
  free-variable walker and all name-string matching.
- **Umbrella `oxc` crate** with an explicit feature list, single version,
  committed lockfile; start at current oxc (0.139+), not 0.124.
  (rolldown consumes `oxc = "0.139.0"` + features, `Cargo.toml:265-279`.)
- **Stateful NAPI handle**: a `#[napi]` class owning Rust-side analysis state
  across calls (rolldown `BindingBundler`, `binding_bundler.rs:20-32`), with
  the two-tier session-state vs build-state split
  (`classic_bundler.rs:30-46`). One typed options object (not 14 positional
  args); one shared error struct; errors-as-data, exceptions only for
  programmer/config faults (oxc `OxcError`,
  `crates/oxc_napi/src/error.rs:7-96`). The full-manifest-through-JS
  round-trip is eliminated by construction.
- **Emission**: per-unit `oxc_codegen` where the AST was rewritten, composed
  with MagicString-style span-chunk splicing (`string_wizard`) and a
  sourcemap chain folded via `collapse_sourcemaps`
  (`rolldown_sourcemap/lib.rs:57-108`). Span splicing is legitimate; raw
  `replace_range` and JSON-string slicing are banned.
- **Keep rquickjs embedded** for user transform evaluation. oxc's
  host-Node-callback model (oxlint `external_linter.rs`) exists for open
  plugin ecosystems needing npm/V8; it costs 64-bit-LE-only, single-threaded
  JS, heavy unsafe, and Node-launch dependency — exactly the properties
  animus needs to keep. Revisit only if QuickJS interpreter speed is a
  measured bottleneck.
- **Facade scope is narrow** (revised from earlier advice by rolldown
  evidence): contain _ownership_ (one module owns the self_cell type) and
  _AST construction_ (one factory shim absorbs builder-API churn — rolldown's
  `ast_factory.rs` absorbed the oxc 0.138 builder break at +2300/−1423);
  read-only AST/`Span`/`Semantic` types flow freely (187 files import oxc in
  rolldown by design).
- **Parity harness is built first**, before any spine module: a differential
  runner executing v1 and v2 over the existing fixture corpus, diffing
  emitted CSS + transformed code, with a diffable scoreboard (percentages +
  sorted failing-fixture list, oxc conformance-snapshot style) and an
  intentional-divergence register.
- **TS layer shape** (tsdown evidence): one options-assembler module + one
  engine call site; three type layers (public `UserConfig` → canonical
  `ResolvedConfig` → engine options); engine diagnostics pass through with
  policy, not reformatting.

## DEFERRED (Decision Ledger seeds — each with its resolving signal)

- **D1. Exact NAPI method surface** (handle methods, what `extract()`
  single-file API becomes — thin wrapper vs removed). Signal: parity harness
  landed + grep of actual plugin call patterns in
  `packages/vite-plugin`/`next-plugin`/`extract/pipeline`.
- **D2. string_wizard: depend vs vendor vs minimal in-house span-chunk
  builder.** Signal: a spike sizing the dependency and checking API fit
  against animus's actual edit shapes (prepend imports, replace chain call,
  strip import lines).
- **D3. Sourcemap scope for first release** (full chain vs
  sourcemap-_ready_ spans only). Signal: consumer fixture demand — whether
  next-app/vite-app debugging stories require maps at flip time; cost data
  from D2 spike.
- **D4. AllocatorPool vs per-task `Allocator::default()`** for the parallel
  parse fan-out. Signal: parse-count/allocation benchmark on the showcase
  corpus after parse-once lands (pooling may be immaterial once re-parsing
  is gone; oxc/rolldown use the pool only for bounded or throwaway parses).
- **D5. Manifest transfer format** at the boundary (structured `#[napi]`
  objects vs one JSON string vs Rust-resident only). Signal: manifest size
  measurement on showcase/next-app corpora; oxc evidence says JSON-once is
  fine at scale — measure before optimizing. Rust-resident state (via the
  handle) is the KNOWN-NOW default; this deferral is only about what the TS
  layer receives for serialization/caching (e.g. dev-server restarts).
- **D6. Cargo feature to compile out rquickjs** (oxfmt dual-entry pattern,
  `main.rs` vs `main_napi.rs` behind `#[cfg(feature="napi")]`). Signal:
  first concrete need — a JS-free consumer, or a test tier that wants a
  QuickJS-less build.
- **D7. Watch/incremental invalidation semantics** (what state survives a
  file change; tsdown's persistent-in-watch / hard-restart-on-config
  lifetime is the template). Signal: v2 spine landed + first dev-server
  integration increment.
- **D8. Formalized oxc upgrade cadence** (4–8 week batch policy, bump-PR
  shape). Signal: experience from the first post-v2 oxc bump.
- **D9. Parity-vs-correctness divergence policy details** (who approves an
  intentional divergence, how fixtures encode expected-v2-differs). Signal:
  first real divergence produced by symbol-based resolution on the fixture
  corpus — the harness build will surface concrete cases.

## Candidate NORTH STAR criteria (directional; seeds design.md §North Star)

- Each source file is parsed **exactly once per build**; a second parse of
  the same bytes is a defect. (Provisional: a chunk-level post-processing
  increment may later license a bounded throwaway re-parse, rolldown
  minify-style — revisit signal: such an increment being proposed.)
- The manifest is a **pure fact table**: no generated code strings, nothing
  whose only consumer re-parses or re-greps it.
- Boundary crossings are **O(project) total**, not O(files × manifest).
- Every emitted byte is **traceable to a source span** (sourcemap-ready even
  if maps ship later — keeps D3 reversible).
- The rewrite is **invisible to consumers until flipped**: v1 fixtures pass
  at every increment; no consumer-visible behavior change without an
  intentional-divergence entry.
- Prefer **shipping reference implementations** (oxc/rolldown/tsdown
  patterns, cited) over novel design anywhere both exist.

## Candidate GUARDRAILS (negative invariants + executable check sketches)

- **G1.** The v2 spine SHALL NOT invoke `Parser::new` more than once per
  (file, build). Check: parse-counter golden snapshot per fixture (oxc
  `track_memory_allocations` count-snapshot style), gated by diff in a
  verify tier.
- **G2.** The manifest SHALL NOT contain generated JS/CSS code strings.
  Check: `rg` gate over the manifest type definitions (no code-bearing
  string fields; deny `format!` writes into manifest structs) + serde-schema
  review assertion.
- **G3.** Emission SHALL NOT use `String::replace_range` or manual
  JSON-string slicing. Check: `rg -n 'replace_range|\[\.\.[a-z_]*len' `
  over the v2 source tree must return empty.
- **G4.** v2 SHALL NOT import v1 modules (outside an explicitly listed
  carry-over set). Check: `rg` import gate with allowlist.
- **G5.** The NAPI boundary SHALL NOT swallow errors: every fallible export
  returns errors-as-data or `napi::Result`; malformed input yields a
  non-empty diagnostic. Check: unit test feeding malformed manifest/options
  asserting diagnostics; `rg` for `if let Ok(`/`unwrap_or` swallow patterns
  in `#[napi]` functions.
- **G6.** No landed increment SHALL regress parity: v2 output byte-equal to
  v1 across the fixture corpus, except entries in the intentional-divergence
  register. Check: differential runner (`verify:parity` tier) with scoreboard
  snapshot diffed in CI.
- **G7.** v2 SHALL NOT depend on individual `oxc_*` crates outside the
  umbrella + explicit allowlist (`oxc_allocator` extras if needed). Check:
  grep of `Cargo.toml [dependencies]` against allowlist.
- **G8.** (Repo rule, inherited) No mutative git operations; verify tiers
  fail loud, never silently rebuild.

## Scale note

This is a large change: expect a two-digit increment count, built lazily per
the schema. The envelope artifacts should stay honest rather than
exhaustive — the Increment Registry (tasks.md) owns decomposition, and
reorientation checkpoints own re-steering as parity evidence lands.

---

## Peer review record and amendments (2026-07-12, pre-design)

Three-reviewer adversarial panel (architecture-skeptic, delivery-risk,
domain-correctness stances) reviewed this brainstorm before design.md.
Verdicts: APPROVE-WITH-OBJECTIONS ×2, REQUEST-CHANGES ×1. All objections
were adjudicated; the amendments below SUPERSEDE the corresponding items
earlier in this file. design.md consumes the amended state.

### Convergent findings (all/multiple reviewers, accepted)

- **The differential oracle does NOT already exist** — decision-chain step 4
  overstated it. What exists is the _corpus_ (19 extract fixtures, 11
  integration test files, 3 consumer apps, ~69 chain-terminal files) and
  invocation plumbing. The existing 197 canary tests are `toContain`
  substring assertions (4 snapshots); `_assertions` checks layer order and
  placeholder absence, not content equality. The oracle is the thing the
  harness increment builds.
- **v1 is not byte-deterministic against itself.** std `HashMap` fields
  serialize in randomized order in the manifest (`project_analyzer.rs:182-237`)
  AND in emitted JS (compound conditions `lib.rs:523` →
  `transform_emitter.rs:213-218`; `customPropMap` `transform_emitter.rs:283-289`;
  live on `tests/fixtures/compound-variants.tsx`); the manifest embeds
  wall-clock timing. `preserve_order` only stabilizes `serde_json::Value`.
- **Symbol-based resolution must move out of the initial spine.** It breaks
  a test-guarded feature (MDX unimported provider-scope rendering:
  `_integration/fixtures/components/mdx-rendering/`, asserted by
  `mdx-rendering.test.ts`; v1's name-based scanner is what makes it work),
  and sequencing it during bring-up confounds every downstream parity
  failure with intentional divergence.

### Amended KNOWN-NOW (deltas)

- **Parity bar, per artifact class** (replaces "byte-equal output"):
  - _CSS_: byte-parity primary (v1's CSS emission is sorted/deterministic),
    paired with an order-aware parsed-CSS diff (lightningcss) as failure
    classifier {formatting | rule-order | selector | value}.
  - _Transformed JS_: **AST-equivalence** (oxc-parse both, normalized
    compare; key-order-insensitive for embedded config object literals).
    Byte-parity is unattainable: v1 emits hand-formatted `format!` templates;
    v2 emits via codegen/MagicString.
  - _Manifest_: no parity by design (the schema is the deliverable). Compare
    derived consumer observables instead: CSS text, per-file transform
    results, `component_fragments` key-set, `reverse_provenance` edge-set,
    diagnostics multiset.
  - _Measurement point_: raw NAPI outputs, before TS post-processing
    (`prefix.ts`, `unit-fallback.ts`, `assemble-stylesheet.ts`).
- **Resolution semantics sequencing** (replaces "symbol-based resolution" as
  spine KNOWN-NOW): v2's initial spine reproduces v1's **name-based
  semantics bug-compatibly** (may run on `oxc_semantic` infrastructure, but
  resolution _rules_ match v1). Symbol-correct resolution is a **post-flip
  increment** entering through the divergence register, with a designed
  JSX-tag rule: symbol resolution where resolvable, name-fallback for
  provider-scope/unresolvable tags (MDX contract `mdx-rendering.test.ts`
  passing under v2 is a named acceptance criterion).
- **Carry-over scope corrected** (replaces "4 pure-JSON modules port
  as-is"): none of the four is decoupled. `reconciler` is keyed by
  binding-name strings; `css_generator` calls `resolve_styles` (QuickJS
  seam) and arbitrates cascade order by class-name prefix matching
  (`css_generator.rs:333-344` — stable-but-arbitrary for duplicate binding
  names, which exist live: Button/Card in showcase+test-ds);
  `theme_resolver` carries the evaluator in its context type;
  `chain_merger`'s production surface is only `topological_sort` (the merge
  fns are `#[cfg(test)]`; real merge semantics live inline in the spine).
  Carry-over means _semantics preserved with explicit interface adaptation_,
  costed per module — not zero-cost code reuse.
- **Owned-AST softened from settled to default-choice** with the rejected
  alternative recorded: richer parse-time fact extraction (partial-value IR
  with named holes — `style_evaluator`'s skip model extended) could keep all
  ASTs per-file-scoped with no self_cell/Send/store machinery, since animus
  never re-emits the original program (emission splices spans). Revisit
  signal: if the chain-eval increment shows parse-time facts suffice for
  stage evaluation + JSX scanning, shrink the store to per-file scope.
- **Emission simplified**: drop the `collapse_sourcemaps` chain
  pre-commitment; animus's transform is chain-length ~2 and bundlers compose
  plugin maps downstream — a single MagicString-style map suffices. D3 stays
  open.
- **Rewrite justification restated honestly** (decision-chain step 2/3
  amendment): several audited defects are module-local repairs
  (`transform_extractor` already builds `SemanticBuilder` in the same file;
  the manifest round-trip dies with one Rust-resident cache). The rewrite is
  carried by: the boundary-contract redesign being inherently coordinated
  churn, the correctness/maintainability case (silent error swallowing,
  string-typed IR, name-collision unification), the harness's independent
  value, and the user's explicit choice. Perf claims (k+3 parses, O(files²))
  are asymptotically true but unmeasured at real scale (n≈55 files);
  increment 0 records baseline measurements so they become measured or are
  dropped from the case.

### Amended/new DEFERRED entries

- **D1 (expanded)**: NAPI surface now explicitly includes **handle-ownership
  topology** — per-build vs per-process instances; next-plugin's
  multi-compiler owning/non-owning `globalThis` coordination
  (`next-plugin/src/singleton.ts`); vitest-worker / vite SSR+client
  multi-instance safety; plus the canary-adapter question (197 tests target
  the 6-arg `extract()`; if v2 drops it, budget the adapter in the harness
  increment).
- **D9 (restructured)**: the _sequencing_ is now decided (bug-compatible
  first — see amended KNOWN-NOW). Remaining deferral: divergence-register
  categories and process, which must include {intentional-correctness,
  ordering, v1-feature-drift, known-quirk} categories. Pre-seeded
  known-quirk entries: `'use client'` detected only at byte offset 0;
  import-need detection by substring grep; line-based multi-line-import
  stripping.
- **D10 (new): dual-build mechanics** — second crate vs feature-flagged
  single crate, second `.node` binary, CI cost (Rust cache scoped to
  packages/extract; LTO release builds), flag plumbing through
  `AnimusExtractOptions`/`AnimusNextOptions`, `verify:parity` task in
  `vite.config.ts` run.tasks + Change-Type Map row (ownership rule: same
  change that introduces the surface). Signal: resolved by the dual-build
  increment, which the registry must place EARLY (before any v2 spine
  module).
- **D11 (new): evaluator reference path** — v1 has two semantically
  different transform evaluators: QuickJS (project path) vs the TS
  placeholder resolver (`extract()` path coerces numeric strings via
  `Number()`, `pipeline/resolve-transforms.ts:17-20`). v2 must pick the
  reference and the fate of the other. Signal: D1's `extract()` decision +
  G-SEAM battery results on both paths.
- **D12 (new): v1 drift policy** — v1 is currently dormant (last src change
  2026-04-21) but history is bursty (43 commits Apr-May). Policy: v1 feature
  commits must add fixture-corpus entries in the same change; the scoreboard
  tracks them as known-missing-in-v2 (distinct from divergences). Signal:
  first v1 feature request during the rewrite.

### Amended/new NORTH STAR

- **Determinism (new):** identical inputs SHALL produce identical bytes
  across runs and thread counts. v1 fails this today; v2 with parallel
  fan-out has more ways to fail. Check via G-DET.
- Revisit signals added: _pure fact table_ (revisit: a fact provably
  cheaper to store as a rendered fragment — requires register entry);
  _O(project) crossings_ (revisit: dev-server incremental design in D7);
  _span traceability_ (revisit: D3 resolution); _invisible until flipped_
  (revisit: never — this one is load-bearing for the whole strategy);
  _reference implementations over novel design_ (revisit: when a reference
  pattern demonstrably misfits animus's topology — as already happened with
  collapse_sourcemaps and the owned-AST store scope).

### Amended/new GUARDRAILS

- **G3 (fixed, was vacuous):** the sketched regex missed all three
  JSON-slicing sites it was written to ban (`[a-z_]*` cannot cross
  `base_json.len()`). Corrected check: `rg -n 'replace_range|\[\.\..*len\(\)'`
  — and every guardrail regex must ship with a **positive control**: run it
  against v1 sources and assert it fires there (non-vacuity proof, per the
  repo's recorded rg-gate lesson).
- **G2 (relabeled):** the rg component denies obvious cases; the real check
  is schema review at increment boundaries — labeled human-judgment, not
  executable.
- **G8 (removed as guardrail):** inherited repo policy, not a change-scoped
  check.
- **G-DET (new):** parity runner `--self-check` mode — v1 run twice must
  byte-match on the declared comparison surface; v2 additionally
  `--threads 1` vs `--threads N`. Green G-DET is a precondition for
  recording any baseline. (Sanctioned v1 pre-fix: sorting compound-condition
  and customPropMap keys is a minimal determinism patch to v1, entering the
  register as a known v1 fix — the alternative, excluding those fields,
  weakens the gate.)
- **G-CSSAST (new):** emitted CSS SHALL parse with zero errors under
  lightningcss; v1/v2 equal under order-preserving CSS AST diff; scoreboard
  auto-classifies failures.
- **G-SEAM (new):** QuickJS contract battery — (value type × transform)
  cases with v1-recorded expected outputs: string/number coercion,
  `negate_css_value`, exponent-threshold numbers (`1e16`/`1e21`),
  `"8.0"` vs `"8"` scale keys, throwing transforms, colliding transform
  names across files (last-registration-wins order dependence), `\r`/exotic
  strings (currently a _silently swallowed_ eval error,
  `theme_resolver.rs:602-614`), run against both v1 evaluator paths and v2.
- **G-USAGE (new):** rendered-usage semantics fixtures each with an explicit
  expected-v2 verdict (identical | registered divergence) BEFORE the
  symbol-resolution increment: MDX provider-scope tag, aliased-import render
  (live: `showcase/src/pages/Examples.tsx:3`, `e2e/vite-app/src/App.tsx:1`),
  duplicate-binding universe (live: Button/Card showcase+test-ds), bare
  `createElement`, `compose()` reassignment (live:
  `showcase/src/components/surfaces/Card.tsx:106`).
- **G-POINT (new):** parity is measured on raw NAPI outputs; the harness
  contract pins the measurement point.
- **G-DIAG (new):** diagnostics (bail/skip/warn markers) compared as a
  per-fixture multiset alongside CSS/JS — error-behavior changes are
  scoreboard-visible, never silent.

### First-increments consensus (seeds tasks.md; registry stays lazy)

1. **v1 determinism proof + comparison-surface contract** (G-DET; minimal
   sanctioned v1 determinism patch; baseline perf/manifest-size
   measurements; both `dev_mode` values).
2. **Parity harness + adversarial corpus fill** (v1-vs-v1 identity mode;
   scoreboard + register schema with categories; new fixture classes:
   shadowing, aliased re-exports, multi-line imports, `'use client'`
   variants, cycles, duplicate-binding universes; G-USAGE fixtures;
   `verify:parity` tier + Change-Type Map row).
3. **Dual-build mechanics** (D10) — before any v2 spine module.
4. **v2 skeleton: owned-AST parse-once store + chain_walker port in
   bug-compatible mode**, wired into the harness with the G1 parse-counter.

Stall forecast adopted from review: the likely plateau is the
project_analyzer port's long tail of ordering/reconciliation diffs.
Mitigations: promote v1's existing sorts to a specified output-ordering
contract both engines implement (eliminates incidental-order diffs by
construction), and structure the port so modules flip individually behind
the harness (strangler-within-the-strangler).
