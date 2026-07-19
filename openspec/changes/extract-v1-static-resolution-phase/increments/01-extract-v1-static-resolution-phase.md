# Increment 01: extract V1 static-resolution phase

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/project_analyzer.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 and the current Phase 2a/2b block is safe to isolate without
> resolving a deferred decision.

## Context Capsule

- **Objective**: Shorten V1's 1,198-line `analyze()` brain method by moving the
  complete existing Phase 2a/2b static-value enrichment block into one private
  in-file helper named `resolve_project_static_values`. Preserve exact data
  insertion order, Phase 2 timing ownership, black-box extraction behavior,
  NAPI/manifest/cache shape, and every pre-existing dirty increment.
- **Verified queue disposition**: RepoWise health evidence is valid (score 1.4,
  99% hotspot, CCN 217, bus factor 1). Its "no governing decision" wording is
  false against repository evidence: `packages/extract/CLAUDE.md` §Project
  Analyzer, canonical `openspec/specs/semantic-const-resolution/spec.md`,
  archived `2026-04-11-oxide-extraction-pass`, and keyframe-binding integration
  tests already govern the phase.
- **Current phase shape**: locate the `Phase 2: Build binding map` comment in
  `project_analyzer.rs`. After `resolve_bindings`, inline Phase 2a builds a
  keyframe registry from `{ exportName: { keyName: { name, frames } } }` into
  `{ exportName: { keyName: name } }`. Phase 2b clones each file's local
  statics, inserts imported exported statics through `binding_map`, then inserts
  imported and same-file keyframe collections. `process_chain` later consumes
  `resolved_static_values`.
- **Existing behavior contracts**:
  - `openspec/specs/semantic-const-resolution/spec.md` §Cross-file imported const
    resolution requires imported numeric/object consts, re-exports, aliases,
    and non-project misses.
  - `packages/_integration/__tests__/keyframes-binding-substitution.test.ts`
    covers imported and same-file keyframe member resolution plus unknown-key
    graceful skip.
  - `openspec/changes/extract-v1-static-resolution-phase/specs/arch-extract-v1-phase-seams/spec.md`
    requires one private in-file seam and unchanged public/timing boundaries.
- **Relevant resolved decisions**:
  - D1: one private helper owns the complete Phase 2a/2b block.
  - D2: preserve local → imported static → imported keyframe → same-file
    keyframe insertion order and the existing timing envelope.
  - D3: add a direct unit test before the helper exists and observe RED.
  - D4: keep the seam private to V1 and in this file.
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS1 byte-equivalent behavior; NS2 named
  phase orchestration; NS3 V1 independence; NS4 timing/cache/manifest/NAPI and
  verification stability; NS5 in-file seam.
- **Prohibitions**: no mutative version-control commands; read-only Git
  inspection required by guardrails is allowed. Do not write outside the
  declared footprint plus this increment file. Never write `design.md`,
  `tasks.md`, `journal.md`, or `specs/`. Do not touch v2, shared loader,
  `lib.rs`, integration tests, Cargo manifests, or dependencies. Treat any
  skill-generated commit point as a logical checkpoint only.

### In-scope guardrails

- **G1 (STOP)**: SHALL NOT alter public analyzer/NAPI/manifest/cache/counter
  surfaces.

  ```bash
  git diff -- packages/extract/src/project_analyzer.rs | rg '^[+][^+].*(pub (fn|struct|enum)|UniverseManifest|CachedFileResult|PipelineTiming|ANALYZE_PARSE_COUNT)|^[-][^-].*(pub (fn|struct|enum)|UniverseManifest|CachedFileResult|PipelineTiming|ANALYZE_PARSE_COUNT)' || true
  ```

  Expected: empty output.

- **G2 (STOP)**: SHALL NOT move Phase 2 timing boundaries.

  ```bash
  git diff -- packages/extract/src/project_analyzer.rs | rg '^[+][^+].*(phase2_start|import_resolution_ms)|^[-][^-].*(phase2_start|import_resolution_ms)' || true
  ```

  Expected: empty output.

- **G3 (STOP)**: helper remains private and no second source file appears.

  ```bash
  rg -n '^pub.*resolve_project_static_values' packages/extract/src/project_analyzer.rs || true
  test ! -e packages/extract/src/static_resolution.rs
  ```

  Expected: empty output and exit zero.

- **G4 (STOP)**: all four static-enrichment paths remain covered.

  ```bash
  repowise distill cargo test --manifest-path packages/extract/Cargo.toml project_analyzer::tests::resolves_project_static_values_across_phase_two --lib
  repowise distill bunx vp test run packages/_integration/__tests__/keyframes-binding-substitution.test.ts
  ```

- **G5 (STOP)**: existing dirty increments remain byte-stable.

  ```bash
  git diff -- . ':(exclude)packages/extract/src/project_analyzer.rs' | shasum -a 256
  ```

  Expected:
  `95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514  -`.

- **G6 (STOP)**: mapped V1 verification remains green.

  ```bash
  repowise distill vp run verify:clippy
  repowise distill vp run verify:unit:rust
  repowise distill vp run verify:canary
  repowise distill vp run verify:integration
  ```

  Atomic diagnostics fail loud. If canary/integration prints a `PREPARE:` or
  `ERROR: ... Run:` prerequisite, run exactly that remediation, then rerun the
  diagnostic. Expand any `[repowise#<ref>]` marker instead of rerunning merely
  to recover omitted output.

## Plan

## Task 01.1: Characterize the seam (RED)

- [x] **Step 1:** Run the existing black-box baseline before editing:

  ```bash
  repowise distill bunx vp test run packages/_integration/__tests__/keyframes-binding-substitution.test.ts
  ```

  Record the current count and exit code. If prerequisites fail loud, perform
  only the exact printed remediation and rerun.

- [x] **Step 2:** In the existing `#[cfg(test)] mod tests` at the bottom of
  `packages/extract/src/project_analyzer.rs`, add imports for
  `serde_json::json` and `crate::import_resolver::{ExportInfo, ImportInfo,
  ResolvedBinding}`. Add this test, using the real map and resolver types with
  no mocks or source-text assertions:

  ```rust
  #[test]
  fn resolves_project_static_values_across_phase_two() {
      let mut file_modules = FxHashMap::default();
      file_modules.insert(
          "tokens.ts".to_string(),
          FileModuleInfo {
              imports: Vec::new(),
              exports: vec![ExportInfo {
                  exported_name: "GAP".to_string(),
                  local_name: Some("GAP".to_string()),
                  source: None,
                  is_default: false,
              }],
          },
      );
      file_modules.insert(
          "motion.ts".to_string(),
          FileModuleInfo {
              imports: Vec::new(),
              exports: vec![ExportInfo {
                  exported_name: "motion".to_string(),
                  local_name: Some("motion".to_string()),
                  source: None,
                  is_default: false,
              }],
          },
      );
      file_modules.insert(
          "component.tsx".to_string(),
          FileModuleInfo {
              imports: vec![
                  ImportInfo {
                      local_name: "spacing".to_string(),
                      imported_name: "GAP".to_string(),
                      source: "./tokens".to_string(),
                      is_default: false,
                  },
                  ImportInfo {
                      local_name: "animation".to_string(),
                      imported_name: "motion".to_string(),
                      source: "./motion".to_string(),
                      is_default: false,
                  },
              ],
              exports: Vec::new(),
          },
      );

      let mut binding_map = FxHashMap::default();
      binding_map.insert(
          ("component.tsx".to_string(), "spacing".to_string()),
          ResolvedBinding {
              file: "tokens.ts".to_string(),
              export_name: "GAP".to_string(),
          },
      );
      binding_map.insert(
          ("component.tsx".to_string(), "animation".to_string()),
          ResolvedBinding {
              file: "motion.ts".to_string(),
              export_name: "motion".to_string(),
          },
      );

      let mut static_values_by_file = FxHashMap::default();
      static_values_by_file.insert(
          "component.tsx".to_string(),
          FxHashMap::from_iter([("LOCAL".to_string(), json!("kept"))]),
      );

      let mut static_exports_by_file = FxHashMap::default();
      static_exports_by_file.insert(
          "tokens.ts".to_string(),
          FxHashMap::from_iter([("GAP".to_string(), json!(8))]),
      );

      let keyframes_blocks = json!({
          "motion": {
              "ember": {
                  "name": "animus-kf-ember",
                  "frames": { "0%": { "opacity": 0 } }
              }
          }
      });

  let resolved = resolve_project_static_values(
      &file_modules,
      &binding_map,
      &static_values_by_file,
      &static_exports_by_file,
      Some(&keyframes_blocks),
  );

      assert_eq!(resolved["component.tsx"]["LOCAL"], json!("kept"));
      assert_eq!(resolved["component.tsx"]["spacing"], json!(8));
      assert_eq!(
          resolved["component.tsx"]["animation"]["ember"],
          json!("animus-kf-ember")
      );
      assert_eq!(
          resolved["motion.ts"]["motion"]["ember"],
          json!("animus-kf-ember")
      );
  }
  ```

- [x] **Step 3:** Run the focused Rust test before adding production code:

  ```bash
  repowise distill cargo test --manifest-path packages/extract/Cargo.toml project_analyzer::tests::resolves_project_static_values_across_phase_two --lib
  ```

  Record RED: compilation must fail specifically because
  `resolve_project_static_values` is absent. A syntax/type error in the fixture
  is not acceptable RED; correct the fixture until the only missing item is the
  new function.

## Task 01.2: Extract the complete phase (GREEN)

- [x] **Step 1:** Extend the existing `crate::import_resolver` import in
  `project_analyzer.rs` to include `ResolvedBinding`. Immediately before the
  main analysis entry-point section, add this private signature:

  ```rust
  fn resolve_project_static_values(
      file_modules: &FxHashMap<String, FileModuleInfo>,
      binding_map: &FxHashMap<(String, String), ResolvedBinding>,
      static_values_by_file: &FxHashMap<String, FxHashMap<String, Value>>,
      static_exports_by_file: &FxHashMap<String, FxHashMap<String, Value>>,
      keyframes_blocks: Option<&Value>,
  ) -> FxHashMap<String, FxHashMap<String, Value>>
  ```

  Move the current Phase 2a keyframe-registry construction and Phase 2b
  per-file loop into this function without changing condition order, key
  construction, clone/insert behavior, or default handling. Return the final
  `resolved_static_values` map. Keep concise comments inside the helper that
  preserve the current registry-shape and insertion-order knowledge.

- [x] **Step 2:** In `analyze()`, retain `phase2_start`, the resolver closure,
  and `resolve_bindings` exactly where they are. Replace only the inline Phase
  2a/2b block with:

  ```rust
  let resolved_static_values = resolve_project_static_values(
      &file_modules,
      &binding_map,
      &static_values_by_file,
      &static_exports_by_file,
      keyframes_blocks,
  );
  ```

  Retain `let import_resolution_ms = phase2_start.elapsed()...` immediately
  after this call. Do not alter any downstream consumer.

- [x] **Step 3:** Rerun the focused Rust test and confirm GREEN:

  ```bash
  repowise distill cargo test --manifest-path packages/extract/Cargo.toml project_analyzer::tests::resolves_project_static_values_across_phase_two --lib
  ```

- [x] **Step 4:** Rerun the black-box keyframe contract:

  ```bash
  repowise distill bunx vp test run packages/_integration/__tests__/keyframes-binding-substitution.test.ts
  ```

## Task 01.3: Format, verify, and self-review

- [x] **Step 1:** Check Rust formatting without writing:

  ```bash
  repowise distill cargo fmt --manifest-path packages/extract/Cargo.toml -- --check
  ```

  If only `project_analyzer.rs` is reported, run `cargo fmt` scoped through the
  same manifest, confirm no other tracked Rust diff moved with read-only Git,
  and rerun the check. Stop rather than formatting unrelated dirty Rust files.

- [x] **Step 2:** Run G1-G5 and record exact outcomes. Any STOP trip halts the
  increment and is returned to the orchestrator; do not repair outside scope.

- [x] **Step 3:** Run mapped verification in G6 order. Apply only exact
  fail-loud prerequisite remediation, then rerun the affected diagnostic.

- [x] **Step 4:** Run `git diff --check` and inspect only
  `packages/extract/src/project_analyzer.rs` with read-only `git diff`. Confirm
  the helper is private, the timing lines are untouched, the Phase 2 block was
  moved rather than rewritten, the four-field unit contract is present, and no
  unrelated source changed.

- [x] **Step 5:** Update this packet's checkboxes, Guardrail gate, and Output
  contract with exact RED/GREEN/verification evidence. Return proposed journal
  entries and surfaced variables. Do not edit `tasks.md`.

## Guardrail gate

- [x] G1: public/NAPI/manifest/cache/counter scoped diff — result: PASS; exit 0
      with empty output
- [x] G2: Phase 2 timing scoped diff — result: PASS; exit 0 with empty output
- [x] G3: private in-file helper — result: PASS; public-helper search was empty
      and `packages/extract/src/static_resolution.rs` does not exist
- [x] G4: focused unit + keyframe integration — result: PASS; Rust unit 1
      passed / 272 filtered, keyframe integration 3 passed
- [x] G5: protected diff hash — result: PASS;
      `95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514  -`
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: PASS; Clippy exit
      0; Rust units 273 passed, 8 passed / 1 ignored, and 348 passed; canary
      200 passed; integration 11 files / 157 tests passed

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail gate results recorded above, with command output excerpts
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates): recorded below

### Execution evidence

- Status: `DONE_WITH_CONCERNS` because the manifest-wide formatting baseline is
  externally red outside this increment's behavioral footprint; all STOP
  guardrails and mapped verification pass.
- Baseline: keyframe integration exited 0 with 1 file / 3 tests passed.
- RED: the root command first stopped before compilation because default Rust
  1.94.0 cannot build dependencies requiring 1.95.0. With the crate-pinned
  `RUSTUP_TOOLCHAIN=1.97.0`, compilation exited 101 only on `E0425`: missing
  `resolve_project_static_values` at the new unit-test call.
- GREEN: the focused Rust test exited 0 with 1 passed / 272 filtered; the
  black-box keyframe contract remained 3 passed.
- Format: manifest-wide `cargo fmt --check` exited 1 and reported unrelated
  Rust files plus pre-existing regions of `project_analyzer.rs`; no formatting
  was run. A scoped rustfmt query found no diff headers in the new helper or
  test ranges.
- Prerequisites: canary's stale-NAPI diagnostic was remediated with exactly
  `vp run build:extract`; integration's stale-system-dist diagnostic was
  remediated with exactly `bun run --filter '@animus-ui/system' build:ts`.
- Self-review: `git diff --check` exited 0; the helper is private, timing lines
  remain at the same boundary, the Phase 2 block is represented by one helper
  call, and the direct test asserts all four enrichment paths.

### Proposed journal entries

- `signal` — the direct unit contract observed the intended missing-seam RED
  and now covers local, imported static, imported keyframe, and same-file
  keyframe enrichment through one private helper.
- `friction` — root-level Cargo commands select Rust 1.94.0 instead of the
  crate's nested 1.97.0 pin; manifest-wide rustfmt also sees unrelated existing
  drift, so execution required a toolchain override and no formatting write.
- `surprise` — none in behavior; the move preserved the 3-test keyframe
  contract and all mapped V1 verification after fail-loud rebuilds.

### Surfaced variables (spawn candidates)

- V1: root verification entrypoints do not automatically honor
  `packages/extract/rust-toolchain.toml`; candidate for verification-command
  ownership so contributors do not receive a false dependency failure.
- V2: manifest-wide Rust formatting is red across unrelated/pre-existing
  surfaces; candidate for a separately owned formatting-baseline increment.

## Spec authorship checklist (orchestrator)

- [x] Confirmed §arch-extract-v1-phase-seams/Private engine-local phase seam
      remains authored and leakage-clean
- [x] Confirmed no Decision Ledger row resolves in this increment
- [x] Appended accepted journal entries attributed via inc 01 subagent
- [x] Reorientation entry written with the full three-stance pass (K=1)
- [x] Ticked registry row 01 with the reorientation timestamp
