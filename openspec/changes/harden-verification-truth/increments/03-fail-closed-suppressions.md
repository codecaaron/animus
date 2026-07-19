# Increment 03: Fail-closed suppressions

## Scope

- **Registry row**: 03 · mode: inline · review: subagent
- **Resolves**: D5, D6, DEF-2
- **Authors**: — (envelope)
- **Depends on**: increments 01 and 02 (ordering and `packed.sh` overlap;
  increment 02 establishes marker transport before this row edits suppressions)
- **Inputs from**: none
- **Footprint**: unit task registration, Rust verification policy scripts,
  Clippy/hygiene/packed scripts, hygiene presenter/tests, properties/system
  declaration sources, owning main specs
- **Pushes to a later increment**: automatic hygiene build selection remains
  lazy row 04 / DEF-3.

> DEF-2 is envelope-licensed: fresh declaration build and attw output decide
> whether the broad exemption can be removed directly or must be exactly
> incident-bound.

## Context Capsule

- **Objective**: Make blanket Rust lint suppression, non-empty cargo-machete
  ignores, new attw resolution failures, and Knip whole-file deletion fail
  closed. Preserve narrow lint allows and ordinary export cleanup.
- **Existing implementation**:
  - `scripts/verify/clippy.sh` runs strict Clippy across three crate roots but
    has no authored-source suppression guard.
  - `packages/extract/Cargo.toml` currently has an empty
    `[package.metadata.cargo-machete].ignored` array.
  - `scripts/verify/hygiene-rust.sh` invokes cargo-machete after tool checks.
  - `scripts/verify/packed.sh` ignores all `internal-resolution-error`
    diagnostics for properties and system.
  - `scripts/hygiene/presenter.ts` computes `suggestedExitCode` only from
    convergence; `layerDVolume.files` is currently informational.
- **In-scope guardrails**:
  - G4 blanket suppression scan —
    `if rg -n '#!?\s*\[\s*(allow|expect)\s*\(\s*(warnings|clippy::all)' packages/extract -g '*.rs'; then exit 1; fi` — STOP.
  - G5 empty cargo ignores — cargo metadata/JQ check from design — STOP.
  - G6 no broad attw ignored rule —
    `rg -n -- '--ignore-rules internal-resolution-error' scripts/verify/packed.sh` — STOP.
  - G7 whole-file deletion behavior test —
    `bunx vp test run scripts/hygiene/presenter.test.ts -t 'requires manual review after whole-file deletion'` — STOP.
- **Requirements**: envelope requirements in `verification-tier-policy`,
  `packed-consumer-verification`, and `code-hygiene`.
- **North Star**: NS3 and NS4.
- **Prohibitions**: no VCS commands; no generic deviation ledger; no test that
  merely checks a script/config contains a command; do not edit shared change
  artifacts.

## Plan

## Task 03.1: Enforce authored Rust suppression and cargo ignore policy

- [ ] **Step 1 (RED):** Create `scripts/verify/rust-policy.test.ts` for a pure
  validator. Cases: multiline `#![allow(warnings)]`, module-level
  `#[allow(clippy::all)]`, `cfg_attr(..., allow(warnings))` fail; narrow
  `#[allow(clippy::too_many_arguments)]` passes; synthetic cargo metadata with
  an ignored dependency fails and empty lists pass. Run the targeted test;
  expected: FAIL because `rust-policy.ts` is absent.
- [ ] **Step 2 (GREEN):** Create `scripts/verify/rust-policy.ts` with source and
  parsed-metadata CLI modes. Strip comments, normalize whitespace only for
  authored attribute tokenization, report file/package and offending group,
  and exit non-zero on findings.
- [ ] **Step 3:** Invoke source policy from `clippy.sh` before cargo commands.
  Pipe `cargo metadata --no-deps --format-version 1` to metadata policy from
  `hygiene-rust.sh` before cargo-machete. Register the behavior test in the unit
  tier and run it, `vp run verify:clippy`, and `vp run verify:hygiene:rust`.

## Task 03.2: Remove or exactly bind DEF-5

- [ ] **Step 1 (RED/signal):** Rebuild only fresh properties/system declarations
  using the documented `build:ts` commands, pack them, and run attw without
  `--ignore-rules internal-resolution-error`. Capture every diagnostic tuple
  (package, entrypoint/profile, rule, path). This output is the DEF-2 resolving
  signal.
- [ ] **Step 2 (preferred GREEN):** If the diagnostics originate from authored
  extensionless declaration imports, update the owning TypeScript source/import
  form so emitted declarations resolve under the supported ESM profile. Rebuild
  and require attw to pass with no ignored rule.
- [ ] **Step 3 (bounded fallback):** If the current compiler necessarily emits
  the known failures, replace the rule-wide ignore with a validator that checks
  the complete attw diagnostic tuples against the exact captured DEF-5 set and
  fails on additions or removals. Do not use a count-only or rule-only
  baseline.
- [ ] **Step 4:** Run the packed type lint and `vp run verify:packed` when its
  upstream artifacts are fresh. Record which branch resolved DEF-2 for the
  orchestrator's design promotion.

## Task 03.3: Stop on whole-file hygiene deletion

- [ ] **Step 1 (RED):** Add presenter test `requires manual review after
  whole-file deletion`: a converged receipt stream containing one Layer D
  `verb=delete, kind=file` record must return a non-zero suggested exit and an
  explicit manual-review summary. Confirm existing export-only/converged tests
  remain expected. Run targeted test and observe failure.
- [ ] **Step 2 (GREEN):** Extend the presenter verdict with the smallest
  explicit risky-deletion state or boolean. Set `suggestedExitCode=1` whenever
  Layer D file volume is non-zero and no behavior-build proof exists. Keep the
  compile+lint envelope running before `run.sh` exits with that result.
- [ ] **Step 3:** Replace the existing informational file-deletion NOTE with the
  blocking message while retaining the export-volume informational nudge.
  Run all presenter and hygiene tests.
- [ ] **Step 4:** Leave row 04 lazy. Propose retirement unless the implementation
  unexpectedly produces a complete Change-Type Map ownership resolver signal.

## Guardrail gate

- [ ] G4: blanket suppression command — result:
- [ ] G5: cargo metadata ignored-list command — result:
- [ ] G6: `rg -n -- '--ignore-rules internal-resolution-error' scripts/verify/packed.sh` — result:
- [ ] G7: selected presenter test — result:

## Output contract

- [ ] RED/GREEN evidence and guardrail outputs recorded
- [ ] DEF-2 signal and chosen resolution branch recorded
- [ ] No broad baseline, deviation ledger, or config-restatement test added
- [ ] Row 04 disposition proposed with evidence

## Spec authorship checklist

- [ ] Envelope requirements remain sufficient
- [ ] DEF-2 promoted to a numbered decision
- [ ] Journal signal, objections, and reorientation appended
- [ ] Registry row ticked with reorientation timestamp
