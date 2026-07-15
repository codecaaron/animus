# Increment 07: oracle inversion and v1 retirement boundary

## Scope

- **Registry row**: 07 · mode: inline · review: subagent
- **Resolves**: DEF-2 → D6; DEF-3 → D7
- **Authors**: §extraction-parity-harness/Registration authorizes privileged
  refresh; §extraction-parity-harness/Oracle inversion to committed
  baselines; §extraction-parity-harness/Differential comparison at the raw
  NAPI boundary; §extraction-parity-harness/Per-artifact-class comparison
  surfaces; §extraction-parity-harness/Emitted CSS parses cleanly;
  §extraction-parity-harness/Divergence register gating;
  §extraction-parity-harness/Self-check mode;
  §extraction-parity-harness/Parse-count reporting;
  §extraction-parity-harness/Diagnostics multiset comparison;
  §transform-evaluation-contract/Recorded-expectation battery;
  §verification-tier-policy/Parity Tier;
  §verification-tier-policy/Parity Tier Change-Type Coverage
- **Depends on (deps:)**: increments 01–06 and 08; this is final
- **Inputs from (inputs:)**: increment 06 — the last live-v1 differential
  set is known and duplicate-compose's physical license drop is handed here
- **Footprint**: packages/_parity/**, packages/extract/**,
  packages/vite-plugin/src/**, packages/vite-plugin/tests/**,
  packages/next-plugin/src/**, packages/next-plugin/tests/**,
  scripts/verify/**, .github/workflows/ci.yaml, vite.config.ts, AGENTS.md,
  .prettierignore,
  openspec/changes/extract-quirk-shed/**
- **Pushes to a later increment**: physical deletion of the v1
  compatibility binding/package payload after its documented escape-hatch
  release window; it leaves the oracle and default loader path here

## Context Capsule

- **Objective**: replace the live v1 differential with immutable committed
  v2 canonical-surface baselines; make drift exact-content licensed and
  ordinary-run immutable; extract `loadSystemModule` into one
  engine-neutral Rust crate exported by v2; route v2-default plugin paths
  through it. Remove all v1 oracle prerequisites and licenses while keeping
  the explicit v1 compatibility option functional for this release.
- **Decisions**: D6 (versioned production/development surfaces, exact hash
  licenses, privileged journal-intent refresh); D7 (shared loader crate,
  no copied implementation); D2 (this row is final).
- **Guardrails**: G2 is intentionally in-footprint and must be strengthened,
  not loosened; G3 becomes baseline-v2 PASS with zero unregistered; G4's
  old oracle-presence form retires only after equivalent v2 loader and v1
  escape-hatch proofs exist.
- **Prohibitions**: no mutative VCS operations; no ordinary/red path may
  write `baselines/**`; no wildcard or artifact-wide active license; no
  duplicated loader implementation; no v1 analysis call in the standing
  parity tier; do not remove the explicit v1 plugin option in this release.

## Task 07.1: specify exact baseline and refresh behavior with RED tests

- [x] Add tests proving normal baseline comparison detects changed content,
  missing baseline units, extra candidate units, and stale baselines even
  when a divergence is registered.
- [x] Add register tests requiring active entries to match exact
  `{unit, artifact, baselineSha256, candidateSha256}` values; anticipated
  entries may omit hashes but license nothing.
- [x] Add refresh tests proving absent/unknown journal intent, unregistered
  drift, failed determinism, or either-mode failure cannot replace an
  existing baseline; preserve the RED output.

Evidence: `packages/_parity/__tests__` passes 5 files/42 tests. The refresh
pair tests preserve both existing files for a production determinism failure
and a development invariant failure; shell REDs for unknown intents preserve
the recorded file hashes.

## Task 07.2: implement the immutable committed-baseline oracle

- [x] Add envelope-versioned, canonically sorted production/development v2
  surface snapshots under `packages/_parity/baselines/v2/`, including a
  corpus/schema digest and refresh-intent reference.
- [x] Compare the union of baseline and candidate unit IDs and all canonical
  artifact classes. Render exact baseline/candidate SHA-256 values for every
  drift and require exact active register matches for refresh eligibility.
- [x] Make the ordinary CLI read-only for oracle files. Keep scoreboard and
  last-failure as receipts; any baseline delta makes the ordinary gate red.
- [x] Add a separate documented refresh command that requires a standing
  journal intent and validates green two-process/thread determinism, both
  modes, CSS/family invariants, and exact registered drift before atomic
  replacement. Verify a fabricated red refresh leaves baseline bytes intact.

Evidence: approved intent `extract-quirk-shed-inc-07-seed` produced the
production/development pair atomically. Their SHA-256 values are
`01b1a909fbf343e5496053b9cb27f4ecf9b9ad8dfa66375e9568e0f60b6b5475` and
`3c27aeff42cf13c2d1e1dc00046f5873adc3ae411d2bf1fec8e03a2ca2786de2`;
ordinary parity and formatter checks left both values unchanged. The
recorder-owned JSON is excluded from general format rewriting via
`.prettierignore`.

## Task 07.3: remove live v1 from standing verification

- [x] Change `scripts/verify/parity.sh` to require only a fresh v2 binary,
  run v2 fresh-process and thread determinism, run the v2 seam battery, and
  compare v2 to committed baselines in both modes with parse-budget checks.
- [x] Convert the seam baseline's recorder/default to v2 and remove every v1
  loader/recording branch from the standing tool.
- [x] Remove live-v1 divergence licenses (including duplicate-compose), flip
  affected family verdicts to `identical`, and prove self-check/family output
  no longer prints false `VIOLATED` lines.

Evidence: standing parity runs v2 fresh-process, 1/8-thread, v2 seam 14/14,
and committed-baseline comparison. Production and development each pass
48/48 units with zero divergences/unregistered entries and all families
reported `ok ... observed identical`; `register.json` has no live-v1 rows.

## Task 07.4: extract and route the engine-neutral system loader

- [x] Move the existing system-loader implementation into one internal Rust
  library under `packages/extract/crates/`; consume it from both bindings
  during the compatibility window and export `loadSystemModule` from v2.
- [x] Add unit/canary parity for loader output and error behavior on the
  showcase/test system; do not fork the implementation.
- [x] Route Vite and Next v2-default `engineApi` paths to v2's loader export;
  keep the explicit v1 leg on the v1 binding. Add focused routing tests for
  both plugins and update stale comments/declarations.

Evidence: `animus-system-loader` is the sole loader implementation consumed
by both Rust bindings; v2 exports `loadSystemModule`. Focused plugin routing
tests pass, and canary proves identical v1/v2 loader output plus exact missing
path errors. The canonical Rust tier passes v1 272, shared 8 (+1 ignored),
and v2 303 tests; all three crates pass dependency hygiene.

## Task 07.5: final proof

- [x] Run focused RED/GREEN tests, `vp run verify:hygiene:rust`,
  `vp run verify:unit:rust`, rebuild both bindings, then run
  `vp run verify:compile`, `vp run verify:unit:ts`, and
  `vp run verify:integration`.
- [x] Run `vp run verify:showcase`, `vp run verify:vite`, and
  `vp run verify:next` on the v2 default; run the documented v1 escape-hatch
  consumers required by the retained compatibility promise.
- [x] Run the new parity tier twice and prove baseline files are byte-stable;
  run registry/spec leakage lints and `openspec validate
  extract-quirk-shed --strict`.

Evidence: focused parity RED/GREEN is 5 files/42 tests; canonical TS units
are 17 files/202 tests. Rust units pass v1 272, shared loader 8 (+1 ignored,
also run explicitly against showcase), and v2 303; all three dependency
hygiene checks pass. Compile covers all nine workspaces, canary passes 199,
and integration passes 10 files/138 tests. The serial CI mirror passes all 17
tasks; default-v2 Vite/showcase assertions pass there and default-v2 Next
passes separately. `ANIMUS_ENGINE=v1` Vite, showcase, and Next builds/asserts
also pass. Two final parity runs each report v2 self-checks and committed
baselines at 48/48 production and development, seam 14/14, zero drift, and
all families identical. Production, development, and seam oracle hashes stay
byte-stable at `01b1a909...b5475`, `3c27aeff...6de2`, and
`a9e6fee2...db9ab` respectively. Registry lint is 0/0, all spec-leakage lints
are empty, the collision scan hits only this change, and strict validation
passes.

## Guardrail gate

- [x] G2 — result: PASS — comparator/register changes are explicitly in this
      row's footprint; the 42 focused tests pin exact hashes, invalid
      categories, unioned units/files, structural arrays, parser counts,
      atomic refresh/recording, CLI arguments, and every family declaration.
- [x] G3 — result: PASS — both final parity runs report committed v2
      production/development 48/48, zero drift/unregistered/stale register
      rows, seam 14/14, and all families identical; `register.json` is empty.
- [x] G4 retirement replacement — result: PASS — one shared Rust loader is
      consumed by v1/v2, v2 exports it, focused routing and 199 canaries pass,
      default consumers use v2, and all three explicit-v1 consumer gates pass.

## Output contract (inline)

- [x] Every plan and guardrail checkbox reflects actual evidence
- [x] Baseline envelope/refresh protocol and exact license shape recorded
- [x] Loader extraction/routing and compatibility boundary recorded
- [x] Independent spec and code-quality review objections dispositioned
- [x] Journal, D6/D7 ledger, and row 07 tick reconciled

## Spec authorship checklist (orchestrator)

- [x] All authored extraction-parity-harness, transform-evaluation-contract,
      and verification-tier-policy requirements match implementation
- [x] Journal + tick row 07 `· ticked: 2026-07-13 18:45`
