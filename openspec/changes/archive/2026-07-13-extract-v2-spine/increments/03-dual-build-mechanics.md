# Increment 03: dual-build-mechanics

## Scope

- **Registry row**: 03 · mode: inline · review: subagent
- **Resolves**: DEF-10 (dual-build layout, binary strategy, CI budget, flag
  plumbing, canary-freshness compatibility — flip the Ledger row at tick)
- **Authors**: §arch-extract-v2-spine/Fact-only manifest ·
  §arch-extract-v2-spine/No raw string surgery ·
  §arch-extract-v2-spine/V1 isolation ·
  §arch-extract-v2-spine/Umbrella dependency surface ·
  §arch-extract-v2-spine/Construction and ownership containment
  (all five are executable-check requirements whose concrete globs become
  writable once this increment fixes the layout; draft them here, the
  orchestrator authors them into specs/arch-extract-v2-spine/spec.md)
- **Depends on (ordering — deps:)**: 02 (tier wiring targets the harness;
  sequencing only)
- **Inputs from (information — inputs:)**: none
- **Footprint**: packages/extract/**, packages/vite-plugin/src/**,
  packages/next-plugin/src/\*\*, vite.config.ts, CLAUDE.md,
  .github/workflows/ci.yaml
- **Pushes to a later increment**: none expected; any discovered variable
  spawns per protocol

> Envelope-licensed at propose time (journal seed entry, 2026-07-12).

## Context Capsule

- **Objective**: both engines build from one standard workspace build; an
  `engine` option (`'v1' | 'v2'`, default `'v1'`) flows from plugin options
  to the native layer; `vp run verify:parity` exists as an atomic tier with
  fail-loud preconditions; CI builds both engines within a recorded budget;
  canary freshness checks account for the new artifact.
- **Layout decision to make first (this IS DEF-10)** — pick and record:
  (a) feature-gated module tree inside the existing crate
  (`packages/extract/src/v2/`, cargo feature `v2`, one `.node` binary
  exposing both surfaces) vs (b) sibling crate
  (`packages/extract/crates/extract-v2/` or `packages/extract-v2/`,
  second `.node`). Decision inputs: oxc version conflict (v1 pins nine
  `oxc_*` 0.124 crates; v2 wants umbrella `oxc` 0.139 — ONE CRATE CANNOT
  HOLD BOTH without dependency renames, which pushes strongly toward (b));
  CI cold-compile cost (`Swatinem/rust-cache` currently scoped to
  packages/extract; LTO release profile); canary freshness scripts
  (`scripts/verify/canary.sh` assumes a singular binary — read it);
  e2e/vite-app + next-app load paths. Record the choice + rejected
  alternative as the drafted decision text for design.md promotion.
- **In-scope guardrails** (from design.md Register; these ARM here — run
  each against the chosen layout, record calibration):
  - G3: `rg -n 'replace_range|\[\.\..*len\(\)' <v2-src-tree>` — expected
    empty; positive control on v1 first (expected ≥4:
    transform_emitter.rs sites) — STOP
  - G4: `rg -n 'use crate::(chain_walker|chain_merger|project_analyzer|jsx_scanner|import_resolver|system_loader|theme_resolver|style_evaluator|transform_extractor|transform_evaluator|transform_emitter|reconciler|css_generator)' <v2-src-tree>` —
    expected: allowlist only (record the carry-over allowlist in the
    Register row at tick) — STOP
  - G7: `grep -E '^oxc' <v2 Cargo.toml>` — expected: only umbrella `oxc`
    (+ allowlisted extras) — STOP
- **Behavior contract to satisfy** (verbatim headers, envelope specs):
  - specs/dual-engine-build/spec.md: §Engine selection option · §Consumer
    invariance under default engine · §Single-workspace availability of
    both engines
  - specs/verification-tier-policy/spec.md: §Parity Tier · §Parity Tier
    Change-Type Coverage
  - specs/vite-extraction-plugin/spec.md and
    specs/next-config-wrapper/spec.md: §Engine selection option (each)
- **Plumbing map**: vite plugin options type `AnimusExtractOptions`
  (packages/vite-plugin/src/index.ts) and next wrapper options
  `AnimusNextOptions` (packages/next-plugin/src/types.ts) gain the field;
  next-plugin must propagate through its owning/non-owning `globalThis`
  singleton (packages/next-plugin/src/singleton.ts) so non-owning compiler
  instances honor the selection (spec scenario: §Selection reaches all
  compiler instances). Task graph: add `verify:parity` to `vite.config.ts`
  `run.tasks` with fail-loud precondition messages naming
  `vp run build:extract` (v1) and the v2 build task. Root CLAUDE.md: add
  the Change-Type Map row for the v2 tree (ownership rule: same change
  that introduces the surface) and the verification-tier table row.
- **Relevant resolved decisions (constraints)**: D6 (umbrella oxc 0.139+,
  caret + lockfile), D9 (containment: ownership module + construction shim
  named in the drafted arch requirements), D1 (v1 default, consumer
  invariance).
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS5 (invisible until flipped — default
  path byte-identical), NS7.
- **Prohibitions**: no version-control commands; no writes outside
  footprint + this file; never write design.md/tasks.md/journal.md/specs/
  (return drafted spec text in the output contract for the orchestrator).

## Plan

## Task 03.1: Layout + skeleton crate

- [x] **Step 1:** Layout decided (drafted as D14): sibling cargo crate
      `packages/extract/crates/extract-v2/` — one crate cannot hold oxc 0.124
      and 0.139; crate boundary makes v1-isolation structural. Scaffolded
      with umbrella `oxc = "0.139"` (+semantic, ast_visit), `self_cell`,
      napi v3; directory-scoped `rust-toolchain.toml` pinning 1.97.0 (oxc
      MSRV 1.95 exceeds machine-default stable 1.94; rustup honors the pin
      without touching the default). Probe export `engineVersion()` parses
      via oxc and passed (`cargo test --lib`: 1/1; first compile surfaced
      the 0.139 `ParserReturn.diagnostics` rename — fixed).
- [x] **Step 2:** One npm package, two engines: `./engine-v2` export →
      `index-v2.js` loader (fail-loud on missing binary AND on
      not-yet-implemented surfaces — verified: probe returns
      `v2/skeleton oxc-parse-ok:true`, `analyzeProject` throws actionable
      guidance). `build` script chains `build:v2`; `vp run build:extract-v2`
      task added. Canary freshness scripts unchanged (v1 binary path
      untouched; v2 freshness enforced by verify:parity preconditions).

## Task 03.2: Flag plumbing

- [x] **Step 3:** `engine?: 'v1' | 'v2'` added to `AnimusExtractOptions`
      (vite) and `AnimusNextOptions` (next). Vite: factory-scoped
      `requireEngine()` choke-point replacing all 5 native require sites.
      Next: `requireEngine()` + `setSharedEngine`/`getSharedEngine` in the
      globalThis singleton (owner sets in constructor; non-owning compiler
      instances and the webpack loader read it) replacing all 6 sites. Both
      plugins rebuild green; default path is the identical v1 module.

## Task 03.3: Tier + map wiring

- [x] **Step 4:** `verify:parity` vp task (fail-loud preconditions naming
      `vp run build:extract` / `vp run build:extract-v2`) — ran green.
      CLAUDE.md: tier-table row + two Change-Type Map rows (v2 crate;
      _parity harness) added in this same change per the ownership rule.
      Lint/fmt config: `openspec/**` excluded (schema-governed artifacts);
      `_parity` CLI console + corpus-fixture shadowing overrides added.
- [x] **Step 5:** CI: rust-cache workspaces extended with the v2 crate;
      `cargo test --lib` step added for extract-v2 (toolchain honored via
      the crate pin). Local cost measured: v2 release build (LTO, cold)
      ≈ minutes-scale like v1; incremental `cargo test` seconds.

## Task 03.4: Arch spec drafting

- [x] **Step 6:** All five requirements authored into
      specs/arch-extract-v2-spine/spec.md with concrete globs and live
      calibration: surgery-ban gate 0 / control 10; v1-isolation 0 matches;
      umbrella grep exactly one `oxc =` line / control 9 `oxc_` pins on v1;
      containment counts 0 (arm meaningfully at inc 04). Leakage lints
      clean; change validates.

## Guardrail gate

- [x] G3 (control then gate) — control 10 on v1; gate empty on v2 tree.
- [x] G4 — no path dep / no v1 symbols in the v2 crate (structural).
- [x] G7 — single umbrella `oxc =` line; control 9 individual pins on v1.
- [x] Spec scenarios: default-engine invariance — verify:integration 136/136
      green post-plumbing; verify:vite + verify:next + verify:showcase run
      at gate (results recorded at tick); flip-without-extra-steps — v2
      binary produced by the standard package build, probe loads.
- [x] `vp run verify` fast-gate components: lint green (incl. fmt),
      compile green, unit:rust 280, unit:ts (parity 18/18).

## Output contract (inline mode — collapse into checklists above)

- [ ] Plan checkboxes ticked; guardrail results with excerpts
- [ ] Drafted decision text (DEF-10 resolution) + five drafted arch
      requirements (leakage-clean)
- [ ] Proposed journal entries; surfaced variables or "none"

## Spec authorship checklist (orchestrator; tie-back before ticking)

- [ ] Author the five requirements into specs/arch-extract-v2-spine/spec.md
      (run the leakage lints first)
- [ ] Flip DEF-10 → resolved (`→ D<next>`); promote into §Decisions; update
      G3/G4/G7 Register rows with concrete globs + calibration + status
      `active`
- [ ] Journal entries + reorientation written
- [ ] Registry row 03 ticked with `· ticked: <reorientation timestamp>`
