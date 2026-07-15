# Increment 05: selector-order-removal

## Scope

- **Registry row**: 05 · mode: delegate · review: subagent
- **Resolves**: DEF-1 (selectorOrder wire-vs-remove → REMOVE, per probe
  signal journaled 2026-07-13 03:25)
- **Authors**: §next-webpack-integration/Webpack plugin orchestrates
  extraction pipeline, §pipeline-integration-testing/Integration
  pipeline invokes production NAPI signature — both MODIFIED deltas
  authored at the row-03 reorientation.
- **Depends on (deps:)**: increment 04
- **Inputs from (inputs:)**: none
- **Footprint**: packages/system/src/SystemBuilder.ts,
  packages/extract/crates/extract-v2/src/**,
  packages/vite-plugin/src/**, packages/next-plugin/src/**,
  packages/vite-plugin/tests/**, packages/vite-plugin/tsconfig.build.json,
  packages/next-plugin/tests/**,
  packages/_integration/**, packages/showcase/src/content/**,
  packages/system/src/**, packages/_parity/register.json,
  packages/_parity/src/engine-run.ts,
  packages/_parity/tools/seam-battery.ts,
  vite.config.ts, AGENTS.md,
  openspec/changes/extract-quirk-shed/**.
- **Pushes to a later increment**: none

## Context Capsule

- **Objective**: `selectorOrder` — a dead config surface (v1 parses it
  into underscore-discarded bindings at both entry points lib.rs:113
  and lib.rs:859 while SystemBuilder.ts advertises it) — is removed
  from the SystemBuilder API and its docs. NAPI signatures keep their
  optional `selector_order_json` parameters (removing NAPI params is
  out of scope — v1 is frozen; v2 ignores it already or continues to).
- **Probe result (DEF-1 signal)**: `rg -n 'selectorOrder'` over
  packages/showcase/src, e2e/*/src, packages/test-ds/src matches ONLY
  two showcase MDX doc pages — no authored config sets it → REMOVE.
- **In-scope guardrails** (STOP): G2, G3, G4 — commands as increment 01.
- **Relevant resolved decisions**: D1 (the register's extract-all
  observables `v1-feature-drift` entry for selectorOrder is resolved by
  removal — update/drop it with the shed note); D2 (API-surface sheds
  last); D4 (remove the dead serialized output while keeping the NAPI
  argument slot until v1 retires).
- **In-scope North Star**: NS1 (a wrong advertisement — dead API — is
  made right by removal), NS2.
- **Prohibitions**: no VCS mutations; keep `loadSystemModule` NAPI
  contract intact (G2 of the flip change; system loading is v1's); do
  not change v1 Rust (`packages/extract/src/**`).

## Plan

## Task 05.1: remove the API surface

- [x] **Step 1:** `rg -n 'selectorOrder|selector_order' packages/system/src/ packages/extract/crates/extract-v2/src/ packages/extract/dist packages/extract/src/lib.rs --glob '!**/*.node'`
  — inventory every reference.
  (Before: two `SystemBuilder.ts` references plus v1's retained optional
  parameter/discarded bindings. After: only v1 `lib.rs` lines 59, 113,
  791, 859, 1091, and 1117 remain; v2 has no reference.)
- [x] **Step 2:** Remove `selectorOrder` from `SystemBuilder.ts`
  (builder option, serialize output) and any system-package types that
  advertise it. Do NOT remove the optional NAPI parameters in v1
  (frozen oracle) — the serialize side simply stops emitting the field.
  (`SerializedConfig` and `serializeInstance()` no longer expose/emit
  the field; selector aliases remain serialized in deterministic order.)
- [x] **Step 2a:** Update active Vite, Next, and `_integration`
  consumers to pass `null` in the retained selector-order NAPI slot;
  update stale comments that promise a serialized selector order.
  (Vite's production call, Next's production and HMR calls, and
  `_integration`'s 14-argument helper all pass literal `null` at index
  10; adapter signatures retain the parameter. Review follow-up adds
  internal typed 14-slot builders for Vite and both Next modes, with
  full-tuple sentinel tests, and replaces the parity runner/seam
  battery's stale config reads with literal `null`.)
- [x] **Step 3:** Update the two MDX doc pages
  (packages/showcase/src/content/reference/create-system.mdx,
  .../architecture/system-setup.mdx) to drop the selectorOrder row.
- [x] **Step 4:** If the v2 crate reads selector_order_json, confirm it
  tolerates absence (it must — fixtures never set it); remove v2 dead
  parsing only if trivially isolated.
  (Confirmed: no `selector_order` reference exists under the v2 crate;
  no v2 Rust edit was needed.)

## Task 05.2: gates

- [x] **Step 1:** `vp run verify:compile && vp run verify:unit:ts` — green.
  (Compile: all nine workspaces exit 0. Unit TS: 11 files, 169 tests
  passed. Focused D4 GREEN: serialization 7/7 plus final adapter set
  4/4.
  Additional required integration tier: 10 files, 138 tests passed.)
- [x] **Step 2:** Register: update the extract-all observables
  `v1-feature-drift` (selectorOrder) entry — note that the surface was
  removed from the builder API (shed 2026-07-13, inc 05); drop or keep
  per how compare consumes it (keep with updated note if dropping
  creates an unregistered divergence).
  (Dropped the anticipated entry; both subsequent parity runs passed,
  proving the removed dead surface creates no unregistered divergence.)
- [x] **Step 3:** `bash scripts/verify/parity.sh | tail -1` → PASS.
  (Final line: `PARITY GATE: PASS`; seam battery v1/v2 14/14, with
  23 prod / 27 dev registered divergences and 0 unregistered.)
- [x] **Step 4:** Consumer proofs:
  `vp run verify:vite && vp run verify:next && vp run verify:showcase` — green.
  (Vite: 1 CSS/1 JS validated; Next: 1 CSS/16 JS plus App+Pages
  validated; showcase: 1 CSS/34 JS validated. All assertions passed.
  After the final tuple-helper and Vite declaration-hiding changes, the
  orchestrator rebuilt both plugin packages and reran all three consumer
  tiers; after the final test/config-only edits it reran Vite, showcase,
  and a fresh Next App+Pages proof. Current-tree integration also passes
  10 files / 138 tests.)

## Guardrail gate

- [x] G2 — result: PASS —
  `git status --short packages/_parity/src/compare.ts packages/_parity/src/scoreboard.ts`
  produced empty output; exit 0.
- [x] G3 — result: PASS — final output of
  `bash scripts/verify/parity.sh | tail -1` was `PARITY GATE: PASS`;
  exit 0.
- [x] G4 — result: PASS —
  `test -f packages/extract/index.js && test -f packages/extract/src/lib.rs`
  produced empty output; exit 0.

## Output contract (delegated)

- [x] Plan checkboxes ticked with RED/GREEN evidence
- [x] Exact diff summary (files + what changed)
- [x] Retained NAPI-slot/null behavior recorded for Vite, Next, and
      `_integration` call sites
- [x] Documentation and parity-register disposition recorded
- [x] Verification and guardrail results with output excerpts
- [x] Proposed journal entries — four review objections and two friction
      entries below
- [x] Surfaced variables — one verification-infrastructure candidate
      below; no D4 semantic spawn candidate

### Returned evidence

- **RED/GREEN:** API RED was 1 failed / 5 passed: the new assertion
  received the built-in alias-order JSON at `config.selectorOrder`.
  Positional RED was 1 failed / 6 skipped: the capture saw 0 arguments,
  not the required 14. After the minimal implementation and documented
  system-package rebuild, the unchanged focused file passed 7/7. The
  positional proof asserts aliases at index 9 and literal `null` at
  retained selector-order index 10.
- **Review-follow-up RED/GREEN:** the first focused run failed both
  suites at module resolution because no argument builders existed; the
  assertion-normalized RED then failed 3/3 (`argsModule` was `null`) for
  Vite, Next production, and Next HMR. GREEN passed 3/3 with static
  imports after refactor. Each test supplies distinct values for every
  nullable/string slot and compares the complete 14-element tuple; the
  selector-order slot is the sole `null` sentinel and is typed exactly
  `null`.
- **Final re-review proof:** Vite now has separate complete 14-slot
  expectations for production (`devMode: false`) and dev (`true`), each
  with mode-specific sentinels in every other position. Final focused
  adapter run passed 4/4. EA-05-1 then rejected the root-only package
  boundary as an out-of-scope plugin API change. The generated helper
  declaration was the RED witness (all three AnalyzeProject symbols
  were public); after `@internal` + `stripInternal`, the rebuilt 61-byte
  file contains exactly `export {};` plus its source-map comment and
  the symbol scan is empty.
- **Exact inc-05 diff:** `SystemBuilder.ts` removes the public field and
  serialized output; Vite removes its selector-order state/load and
  passes `null`; Next does the same in production and HMR;
  `run-pipeline.ts` retains the complete typed 14-slot signature, passes
  aliases + `null`, and exposes an injectable NAPI boundary for the
  positional regression test; `serialization.test.ts` adds the two D4
  regressions; selector-rules/keyframes comments describe the retained
  slot accurately; the two MDX pages drop the obsolete row;
  `register.json` drops the anticipated selectorOrder drift entry; this
  packet records the delegated receipts. Review follow-up adds private
  source modules `vite-plugin/src/analyze-project-args.ts` and
  `next-plugin/src/analyze-project-args.ts`, their focused tests, routes
  all three adapter calls through them, replaces stale selectorOrder
  reads in `_parity/src/engine-run.ts` and `tools/seam-battery.ts`, and
  types `_integration`'s retained slot as `null`. Final re-review adds
  `next-plugin/tests` to `vite.config.ts`'s canonical unit command,
  makes the `AGENTS.md` suite list exact (including parity), splits the
  Vite production/dev tuple proof, marks the Vite helper declarations
  internal, and enables declaration `stripInternal` in
  `vite-plugin/tsconfig.build.json`. The proposed root-only package
  `exports` map and boundary test were removed under EA-05-1. No v1 or
  v2 Rust file changed.
- **Retained NAPI behavior:** v1's two optional `selector_order_json`
  parameters and discarded bindings remain frozen. Vite's v2 adapter
  and Next's singleton adapter retain `_selectorOrderJson` in the
  function surface. Active Vite analysis passes `null`; both Next
  production/HMR analyses pass `null`; `_integration` passes `null`
  while continuing to pass non-null `config.selectorAliases`. The
  active parity runner and v1 seam-battery call now pass literal `null`
  rather than reading the removed config field.
- **Docs/register:** both public `SerializedConfig` tables no longer
  advertise `selectorOrder`. The anticipated `extract-all · observables
  · v1-feature-drift` row was removed rather than rewritten because
  parity remained PASS without it.
- **Gate excerpts:** focused serialization 7/7 and final adapters 4/4;
  compile all nine workspaces exit 0; canonical unit TS 11 files/169 tests;
  integration 10 files/138 tests; parity `PARITY GATE: PASS` with both
  seam engines 14/14; lint 0 warnings/0 errors and format check clean;
  rebuilt Vite root still resolves to `dist/index.mjs`, its helper
  declaration is an empty module with no AnalyzeProject symbols, and
  fresh Vite consumer assertions validate 1 CSS/1 JS; fresh current-tree Next validates 1
  CSS/16 JS with App+Pages, fresh showcase validates 1 CSS/34 JS, and
  current-tree integration passes 10 files/138 tests; scoped `git diff
  --check` exit 0; G2/G4 empty output and exit 0.
- **Proposed journal · objection P2, accepted:** integration's original
  spy pinned only arity and slots 9-10, so same-typed argument
  permutations in the active Vite/Next adapters could evade it. Internal
  full-tuple builders and distinct-sentinel tests now bind Vite, Next
  production, and Next HMR to all 14 positions without exporting a new
  package API.
- **Proposed journal · objection P3, accepted:** parity `engine-run.ts`
  and `seam-battery.ts` still read removed `config.selectorOrder`.
  Both now pass literal `null` in the retained v1 ABI slot; parity and
  both seam engines remain green.
- **Proposed journal · final re-review, accepted:** the canonical TS
  unit tier omitted `next-plugin/tests`, and its root documentation also
  omitted the parity suite. The task command and `AGENTS.md` now list
  system, Vite, Next, properties, assertions, and parity; the canonical
  run directly executes the Next adapter proofs.
- **Proposed journal · EA-05-1, accepted:** the attempted Vite root-only
  exports map changed plugin package-boundary behavior and violated the
  proposal's no-plugin-API-change non-goal. The map and its boundary
  test were removed. Source-only testability remains; `@internal` plus
  `stripInternal` makes the emitted helper declaration an empty module,
  while existing root resolution and the Vite consumer stay green.
- **Proposed journal · friction:** `vp run build:system` is not a
  registered task despite the intuitive package-tier name; the
  documented narrow `bun run --filter '@animus-ui/system' build:ts`
  succeeded, followed by the registered aggregate `vp run build:ts`.
- **Proposed journal · friction:** an extra, non-authoritative direct
  `tsgo -p packages/_integration/tsconfig.json --noEmit` probe exposed
  existing fixture errors (`setup.ts` does not export `ds`, plus one
  possibly-undefined `lcss`); neither changed D4 file was diagnosed and
  the authoritative integration tier passed 138/138, so inc 05 did not
  widen scope.
- **Surfaced variable:** consider a future clean integration type-check
  tier (or repair the existing fixture export/strictness errors) before
  promoting direct `_integration` `tsgo` as a gate. The Next unit-tier
  coverage variable is resolved in this increment. No new D4 behavior
  decision or register row is needed.

## Spec authorship checklist (orchestrator)

- [x] MODIFIED deltas authored for the two main requirements that
      required serialized selector-order values
- [x] DEF-1 resolved to D4 in design.md
- [x] Journal + tick row 05 `· ticked: 2026-07-13 17:05`
