# Increment 02: parity-harness-corpus

## Scope

- **Registry row**: 02 · mode: inline · review: subagent
- **Resolves**: DEF-9 (divergence-register categories & adjudication
  process — resolved by building the register; flip the Ledger row and
  promote to a new D entry in design.md at tick)
- **Authors**: — (envelope; `extraction-parity-harness` and
  `rendered-usage-semantics` requirements already cover this row)
- **Depends on (ordering — deps:)**: 01 (self-check substrate must be green
  before baselines are recorded; packet content does not depend on 01's
  outputs — the comparison surface is fixed by design.md D2)
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/\_parity/**, packages/extract/tests/fixtures/**
- **Pushes to a later increment**: `verify:parity` task-graph wiring and
  Change-Type Map row → increment 03 (build-config footprint lives there)

> Envelope-licensed at propose time (journal seed entry, 2026-07-12).

## Context Capsule

- **Objective**: a differential harness exists as a private workspace
  package (`packages/_parity`, following the `_assertions`/`_integration`
  private-package convention) that runs two engines over the corpus,
  compares per design.md D2's per-artifact-class surfaces, emits the
  scoreboard, enforces the divergence register, and supports self-check and
  parse-count modes. Acceptance for this increment: **v1-vs-v1 identity
  mode is green across the full corpus** (v2 does not exist yet), and the
  adversarial fixture families exist with declared verdicts.
- **In-scope guardrails** (from design.md Register):
  - G8: `vp run verify:parity -- --self-check` (harness implements this
    mode; until task wiring lands in 03, invoke the harness binary/test
    directly) — expected: empty diffs — STOP
  - G6: parity scoreboard green or every divergence register-covered —
    trivially green in v1-vs-v1 mode; the gate arms for real at 04 — STOP
- **Behavior contract to satisfy** (verbatim headers, envelope specs —
  read these files before implementing):
  - specs/extraction-parity-harness/spec.md: §Differential comparison at
    the raw NAPI boundary · §Per-artifact-class comparison surfaces ·
    §Diffable scoreboard with failure classification · §Emitted CSS parses
    cleanly · §Divergence register gating · §Self-check mode ·
    §Parse-count reporting · §Diagnostics multiset comparison
  - specs/rendered-usage-semantics/spec.md: §Usage-case fixture families
    with declared verdicts (all five families) · §MDX provider-scope
    rendering is preserved · §Aliased imports attribute usage to the
    aliased component
- **Register schema** (resolves DEF-9): file-based register in
  packages/\_parity (one entry per divergence: fixture, artifact class,
  category ∈ {intentional-correctness, ordering, v1-feature-drift,
  known-quirk}, adjudication note). Pre-seed known-quirk entries:
  `'use client'` detected only at byte offset 0; import-need detection by
  substring grep of replacement text; line-based multi-line-import
  stripping (all live in v1 `transform_emitter.rs`).
- **New fixture classes to author** (under packages/extract/tests/fixtures/
  or a parity-corpus dir in packages/\_parity — keep each minimal):
  shadowed local binding of an imported builder; aliased re-export chain;
  duplicate binding names across two packages in one universe (mirror the
  live Button/Card showcase+test-ds pair); multi-line named imports;
  `'use client'` preceded by a comment; cyclic extension; MDX
  provider-scope tag (mirror `_integration/fixtures/components/
mdx-rendering/`); bare `createElement`; `compose()` reassignment. Each
  G-USAGE family carries expected-verdict frontmatter.
- **Comparison implementation notes**: CSS byte-compare + lightningcss
  (dev-dependency of packages/\_parity only) for classification; JS
  AST-equivalence via oxc-parse of both outputs (the `oxc-parser` npm
  package is acceptable here — harness-only, not the engine); manifest
  derived-observables per D2. Scoreboard format: totals + percentages +
  sorted failing list + classification (oxc conformance-snapshot style, a
  committed `.snap` the diff of which is the review surface).
- **Relevant resolved decisions (constraints)**: D2 (surfaces + measurement
  point), D10 (v1 reference is post-patch v1), D12-adjacent: harness is
  workspace-topology-compliant (packages/\_parity may import packages/\*;
  never the reverse — root CLAUDE.md One-Way Dependency Rule).
- **Upstream inputs**: none (deps-only edge on 01).
- **In-scope North Star criteria**: NS5, NS6.
- **Prohibitions**: no version-control commands; no writes outside
  footprint + this file; never write design.md/tasks.md/journal.md/specs/.

## Plan

## Task 02.1: Harness package

- [x] **Step 1:** `packages/_parity` scaffolded (private workspace member —
      root package.json workspaces list is enumerated, so registration there
      was a required one-line footprint addition, recorded here). CLI:
      `--engines`, `--self-check`, `--parse-count`, `--both` (dev-mode pair);
      `--threads` activates with a v2 engine (mode implemented, no v2 yet).
- [x] **Step 2:** Corpus enumeration: 35 units — extract per-file (16) +
      `extract-all` combined + integration components (incl. mdx-rendering via
      the pipeline's `preprocessMdx`) + 11 parity adversarial units. Engines
      invoked at the raw NAPI boundary in FRESH child processes per
      engine×devMode.
- [x] **Step 3:** Four comparison surfaces + CSS-validity check +
      scoreboard snapshot + register + exit codes implemented; 15 synthetic-
      divergence tests green (`bunx vitest run __tests__` in packages/\_parity;
      tier wiring is row 03).

## Task 02.2: Adversarial corpus

- [x] **Step 4:** Nine families authored/declared in
      `corpus/families.json` (five required usage-case families + shadowed-
      local, multiline-import, use-client-comment, cyclic-extension); harness
      hard-fails on missing family/verdict/unknown unit (loadFamilies).

## Task 02.3: Identity-mode acceptance

- [x] **Step 5:** v1-vs-v1 identity + self-check green across all 35 units,
      both dev modes: self-check 35/35 (100%); compare gate PASS with 6/8
      divergences — all `css-validity`, all register-covered (see surprise
      entry: latent v1 unresolved-alias passthrough), 0 unregistered.
      Scoreboards committed: `scoreboard.snap`, `self-check.snap`.

## Guardrail gate

- [x] G8: harness `--self-check` (v1 ×2) — result: pass, 35/35 units
      byte-identical.
- [x] G6: identity-mode scoreboard — result: green (0 unregistered; 8
      registered css-validity entries, known-quirk category).
- [x] Workspace topology: `_parity` imports only `packages/extract` (+ its
      pipeline export) and dev-deps — one-way rule holds.
- [x] Showcase-scale D1 measurement recorded in baselines.md (62 files /
      197 components / ~50 ms total).

## Output contract (inline mode — collapse into checklists above)

- [ ] Plan checkboxes ticked; guardrail results recorded with excerpts
- [ ] Proposed journal entries; surfaced variables (spawn candidates) or "none"

## Spec authorship checklist (orchestrator; tie-back before ticking)

- [ ] Flip DEF-9 → resolved (`→ D<next>`) in design.md; promote the
      register schema decision into §Decisions
- [ ] Journal entries + reorientation written (full three-stance pass — K=3
      cadence starts here if not triggered earlier)
- [ ] Registry row 02 ticked with `· ticked: <reorientation timestamp>`
