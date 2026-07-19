# Increment 01: flatten V1 consumed-import filtering

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/transform_emitter.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after RepoWise risk/context evidence exposed a bounded nested
> decision in a clean Rust file with no active-change overlap.

## Context Capsule

- **Objective**: Move fully-consumed named-import recognition into one flat
  private predicate. Add a conservative line matrix first. Preserve parser,
  newline, public/caller/runtime, V2, and dirty-tree boundaries.
- **Verified finding disposition**: the five-level nesting lead is valid. AST
  parsing, partial-specifier pruning, alias redesign, and V1/V2 sharing are not
  licensed by this behavior-preserving increment.
- **Live call path**: `apply_replacements()` conditionally calls the private
  stripper; the stripper calls `parse_named_import()` for candidate lines.
- **Current mapping**: fully extracted named import from consumed source → drop;
  partial binding set, non-target source, parse failure, or ordinary line → keep.
  Original final-newline presence is restored after the loop.
- **Existing contracts**: canonical `rust-extraction-pipeline/Source
  replacement`; two direct Rust tests; NAPI canary and integration; independent
  V2 compatibility assembly.
- **Decisions**: D1 flat guard helper; D2 characterization-first GREEN; D3
  parser/source-shape ownership unchanged; D4 V1-only with V2 hash protection.
- **North Star**: NS1 conservative matrix; NS2 one flat policy; NS3 source shape;
  NS4 runtime boundaries; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Read-only Git inspection is required. Do
  not write outside the declared footprint plus this packet's completion
  fields. Never edit design/tasks/journal/specs, V2, callers, manifests, public
  APIs, dependencies, or integration fixtures.

## Plan

### Task 01.1: Characterize the conservative line matrix first

- [x] Run the existing transform-emitter unit baseline:

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml transform_emitter::tests --lib
  ```

- [x] Add `consumed_import_filter_preserves_line_matrix` after
  `preserves_import_when_partial_bindings`. Use one no-final-newline source with,
  in order: a fully consumed target import, a partial target import, a fully
  extracted non-target import, and a `const` string containing import-looking
  text. Call `strip_consumed_imports()` directly with consumed core source and
  extracted `animus`; assert exact output removes only the first line and
  preserves the remaining three lines byte-for-byte without adding a final LF.
- [x] Run the focused test before production editing and record honest GREEN
  against the nested implementation.

### Task 01.2: Extract the flat decision helper

- [x] Add private `should_strip_consumed_import(line, consumed_sources,
  extracted_bindings)` immediately before `strip_consumed_imports()`. Preserve
  the exact quick shape check; return false on parse failure; otherwise return
  the existing consumed-source AND all-bindings-extracted decision.
- [x] Replace only the nested decision tree inside the line loop with:

  ```rust
  if should_strip_consumed_import(line, consumed_sources, extracted_bindings) {
      continue;
  }
  ```

  Do not change parsing, append order, trailing-newline restoration, comments
  outside the decision block, signature, caller, or V2.
- [x] Rerun the focused characterization and full transform-emitter module.

### Task 01.3: Format, verify, and self-review

- [x] Run manifest-wide formatting read-only. If known ambient drift remains,
  verify no hunk begins in changed ranges and do not format unrelated files.
- [x] Run G1-G5. Any STOP trip halts the increment.
- [x] Run G6 in order with exact fail-loud remediation only.
- [x] Run `git diff --check`; inspect only the target diff; confirm it contains
  the matrix, one private helper, and one call-site flattening.
- [x] Update only this packet's completion fields with exact evidence, proposed
  journal entries, and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public emitter/caller boundary — result: verbatim diff/`rg` check
  exited 0 with empty output.
- [x] G2: one private predicate/one call/no old nesting — result: verbatim
  checks found definition count 1, total occurrence count 2, and no old
  three-deep decision shape.
- [x] G3: conservative line matrix — result: focused test passed, 1 passed,
  0 failed, 275 filtered out.
- [x] G4: V2 assembly hash — result:
  `8f6e419b67d647563cd954b534593a34a596ea90a87443e07bb33eea8f948bd1`.
- [x] G5: protected dirty-diff hash — result:
  `4df2a79c93f5864b709eba9e615835879feb9e8ce5dc4d32f9baec4132ff4fd0  -`.
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: Clippy exited 0;
  Rust units passed 276 + 8 + 348 with 1 ignored; canary initially failed loud
  on the expected stale NAPI binary, `vp run build:extract` exited 0, and the
  rerun passed 200/200; integration passed 157/157 across 11 files.

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: DONE_WITH_CONCERNS. Baseline transform-emitter module was GREEN at
  23/23. The named characterization was GREEN before production editing and
  after the rewrite; the final module was GREEN at 24/24. The target diff is
  limited to the conservative matrix, one private guard-clause helper, and one
  flattened call site; `git diff --check` exits 0.
- Phase 2 accepted reviewer finding: made the helper documentation
  decision-oriented and restored the removal contract on
  `strip_consumed_imports()`. The focused matrix, G1-G5, and `git diff --check`
  passed again. G6 was not repeated because this follow-up changes comments
  only and the prior mapped G6 evidence remains behaviorally applicable.

### Proposed journal entries

- Friction: manifest-wide `cargo fmt -- --check` still reports known ambient
  Rust drift. No read-only formatter hunk begins in the changed helper/test
  ranges; unrelated files were not written.
- Surprise: none. The conservative line matrix stayed GREEN before and after
  flattening the existing decision tree.

### Surfaced variables (spawn candidates)

- `ambient-rustfmt-drift`: candidate for a separately authorized cleanup
  increment; intentionally unchanged here.

## Spec authorship checklist (orchestrator)

- [x] Confirmed §arch-extract-v1-consumed-import-filter/Flat private consumed-import decision remains authored and leakage-clean
- [x] Confirmed no Decision Ledger row resolves in this increment
- [x] Appended accepted journal entries attributed via inc 01 subagent
- [x] Reorientation entry written with the full three-stance pass (K=1)
- [x] Ticked registry row 01 with the reorientation timestamp
