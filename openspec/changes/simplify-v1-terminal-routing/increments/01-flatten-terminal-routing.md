# Increment 01: flatten V1 terminal routing

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/extract/src/chain_walker.rs` and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1 through DEF-4 remain externally
  signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 after the next clean Rust hotspot exposed a bounded exhaustive
> match refactor with no active-change overlap.

## Context Capsule

- **Objective**: Replace V1 `extract_terminal_arg()`'s outer catch-all plus
  inner terminal match with one exhaustive flat match. Add a three-terminal
  characterization first. Preserve every valid descriptor, invalid-input
  fallback, caller default, chain/bail rule, runtime output, and dirty increment.
- **Verified finding disposition**: RepoWise's nested-complexity lead is valid.
  Its `unreachable!()` is not reachable because the outer `AsClass` arm already
  excludes it, but the panic-shaped branch is removable. V1/V2 duplication is
  not a shared-code target. `theme_resolver.rs` was skipped because an active
  OODA change protects it.
- **Live call path**: `try_walk_chain()` maps `asElement`/`asComponent`/
  `asClass` to `TerminalKind`, calls this private function once, then preserves
  `None` as an empty tag with `unwrap_or_default()`. Do not edit that caller.
- **Current mapping**: `AsClass` returns empty without reading arguments;
  `AsElement` returns a string literal or `None`; `AsComponent` returns an
  identifier, `"unknown"` for another supplied expression, or `None` when
  absent. Preserve all branches exactly.
- **Existing contracts**: canonical `rust-extraction-pipeline`,
  `builder-chain`, `dynamic-prop-fallback`, and `extension-system`; V1 chain
  walker units; canary `asComponent`/`asClass`; parity corpus/baselines.
- **Decisions**: D1 exhaustive flat match; D2 characterization-first GREEN;
  D3 caller/fallback unchanged; D4 V1-only with V2 hash protection.
- **North Star**: NS1 descriptor equivalence; NS2 exhaustive/no panic; NS3 one
  local matrix; NS4 runtime boundaries stable; NS5 V2 independent.
- **Prohibitions**: no mutative Git. Read-only Git inspection is required.
  Do not write outside the declared footprint plus this packet's completion
  fields. Never edit design/tasks/journal/specs, V2, Cargo manifests, callers,
  constants, public types, dependencies, or integration fixtures.

### In-scope guardrails

- **G1 (STOP)**: public/caller/walker boundary diff stays empty.

  ```bash
  git diff -- packages/extract/src/chain_walker.rs | rg '^[+][^+].*(pub enum TerminalKind|pub struct ChainDescriptor|CHAIN_METHODS|BAIL_METHODS|fn try_walk_chain|fn walk_chain_backwards)|^[-][^-].*(pub enum TerminalKind|pub struct ChainDescriptor|CHAIN_METHODS|BAIL_METHODS|fn try_walk_chain|fn walk_chain_backwards)' || true
  ```

- **G2 (STOP)**: one private router, no unreachable arm.

  ```bash
  test "$(rg -c '^fn extract_terminal_arg\(' packages/extract/src/chain_walker.rs)" = 1
  rg -n 'unreachable!\(\)' packages/extract/src/chain_walker.rs || true
  ```

- **G3 (STOP)**: characterization passes.

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml chain_walker::tests::terminal_argument_shapes_preserve_tags --lib
  ```

- **G4 (STOP)**: V2 remains byte-stable.

  ```bash
  shasum -a 256 packages/extract/crates/extract-v2/src/chain_walk.rs
  ```

  Expected: `8fa318e940337dda89e901f29cd44f0e9e83f95b6c13bb5149a71548af6b5930  packages/extract/crates/extract-v2/src/chain_walk.rs`.

- **G5 (STOP)**: every pre-existing tracked increment stays byte-stable.

  ```bash
  git diff -- . ':(exclude)packages/extract/src/chain_walker.rs' | shasum -a 256
  ```

  Expected: `1a6e96144a0c792983de234742b2243a444b1f9da8b7c8be57f777249c17d841  -`.

- **G6 (STOP)**: mapped V1 verification passes.

  ```bash
  repowise distill vp run verify:clippy
  repowise distill vp run verify:unit:rust
  repowise distill vp run verify:canary
  repowise distill vp run verify:integration
  ```

  Apply only exact fail-loud prerequisite remediation, then rerun the affected
  diagnostic. Expand `[repowise#<ref>]` instead of rerunning to recover output.

## Plan

## Task 01.1: Characterize current terminal shapes first

- [x] **Step 1:** Run the existing V1 chain-walker unit baseline:

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml chain_walker::tests --lib
  ```

- [x] **Step 2:** In the existing tests module, immediately after
  `extracts_as_component_on_primary_chain`, add:

  ```rust
  #[test]
  fn terminal_argument_shapes_preserve_tags() {
      let chains = parse_chains(
          r#"
          const Element = animus.styles({}).asElement('section');
          const Component = animus.styles({}).asComponent(Link);
          const Class = animus.styles({}).asClass();
          "#,
      );

      let expected = [
          ("Element", TerminalKind::AsElement, "section"),
          ("Component", TerminalKind::AsComponent, "Link"),
          ("Class", TerminalKind::AsClass, ""),
      ];

      assert_eq!(chains.len(), expected.len());
      for (binding, terminal, tag) in expected {
          let chain = chains
              .iter()
              .find(|chain| chain.binding == binding)
              .expect("terminal fixture should be recognized");
          assert_eq!(chain.terminal, terminal);
          assert_eq!(chain.tag, tag);
          assert!(chain.extractable);
      }
  }
  ```

- [x] **Step 3:** Run the focused test before production editing and record the
  honest pure-refactor baseline: GREEN against the nested implementation.

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml chain_walker::tests::terminal_argument_shapes_preserve_tags --lib
  ```

## Task 01.2: Flatten the exhaustive match

- [x] **Step 1:** Replace only `extract_terminal_arg()` with this equivalent
  exhaustive shape:

  ```rust
  fn extract_terminal_arg(call: &CallExpression<'_>, terminal: &TerminalKind) -> Option<String> {
      match terminal {
          TerminalKind::AsClass => Some(String::new()),
          TerminalKind::AsElement => match call.arguments.first()? {
              Argument::StringLiteral(lit) => Some(lit.value.to_string()),
              _ => None,
          },
          TerminalKind::AsComponent => match call.arguments.first()? {
              Argument::Identifier(id) => Some(id.name.to_string()),
              _ => Some("unknown".to_string()),
          },
      }
  }
  ```

  Do not change the signature, caller, enum, constants, comments outside the
  function, or any V2 code.

- [x] **Step 2:** Rerun the focused characterization and the full local
  chain-walker unit module.

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml chain_walker::tests::terminal_argument_shapes_preserve_tags --lib
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml chain_walker::tests --lib
  ```

## Task 01.3: Format, verify, and self-review

- [x] **Step 1:** Run manifest-wide formatting read-only. If it reports the
  known ambient drift, verify that no rustfmt hunk begins in the changed
  function/test ranges and do not format unrelated files.

  ```bash
  RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo fmt --manifest-path packages/extract/Cargo.toml -- --check
  ```

- [x] **Step 2:** Run G1-G5. Any STOP trip halts the increment.
- [x] **Step 3:** Run G6 in order, applying only exact printed prerequisites.
- [x] **Step 4:** Run `git diff --check`; inspect only the target diff; confirm
  the change is the characterization plus flat exhaustive match.
- [x] **Step 5:** Update only this packet's completion fields with exact
  evidence, proposed journal entries, and surfaced variables. Do not edit
  `tasks.md`.

## Guardrail gate

- [x] G1: public/caller/backward-walker boundary — result: PASS; exit 0 with
      empty output
- [x] G2: one private exhaustive router, no unreachable — result: PASS; router
      count is 1 and `unreachable!()` search output is empty
- [x] G3: terminal characterization — result: PASS; 1 passed / 273 filtered
- [x] G4: V2 chain walker hash — result: PASS;
      `8fa318e940337dda89e901f29cd44f0e9e83f95b6c13bb5149a71548af6b5930  packages/extract/crates/extract-v2/src/chain_walk.rs`
- [x] G5: protected dirty-diff hash — result: PASS;
      `1a6e96144a0c792983de234742b2243a444b1f9da8b7c8be57f777249c17d841  -`
- [x] G6: Clippy/Rust units/NAPI canary/integration — result: PASS; Clippy exit
      0; Rust units 274 passed, 8 passed / 1 ignored, and 348 passed; canary
      200 passed; integration 11 files / 157 tests passed

## Output contract (delegate mode)

- [x] Plan checkboxes above reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail results include exact command evidence
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates) recorded below

### Execution evidence

- Status: `DONE_WITH_CONCERNS` because manifest-wide formatting remains
  externally red on ambient Rust drift; every STOP guardrail and mapped
  verification command passes.
- Baseline: the pre-edit chain-walker module exited 0 with 20 passed / 253
  filtered.
- Characterization-first GREEN: before production editing, the three-terminal
  test exited 0 with 1 passed / 273 filtered against the nested router.
- Post-refactor: the focused test remained 1 passed / 273 filtered and the
  complete chain-walker module reported 21 passed / 253 filtered.
- Format: manifest-wide `cargo fmt --check` exited 1 on ambient drift. The
  changed function/test begin at lines 297 and 432; rustfmt hunk headers begin
  elsewhere, so no formatting write was performed.
- Prerequisite: canary's stale-NAPI diagnostic was remediated with exactly
  `vp run build:extract`, after which all 200 canary tests passed.
- Self-review: `git diff --check` exited 0; the target diff contains only the
  characterization and the flat exhaustive match.

### Proposed journal entries

- `signal` — the three-terminal characterization stayed green before and after
  flattening, while the private router now exhaustively names every terminal
  without a panic-shaped branch.
- `friction` — manifest-wide rustfmt remains red on ambient files and unchanged
  ranges of `chain_walker.rs`; the increment correctly avoided formatting
  those surfaces.
- `surprise` — none; caller fallbacks, V2 hash, canary snapshots, and integration
  behavior remained stable.

### Surfaced variables (spawn candidates)

- V1: manifest-wide Rust formatting has unrelated/pre-existing drift; candidate
  for a separately owned formatting-baseline increment.

## Spec authorship checklist (orchestrator)

- [x] Confirmed §arch-extract-v1-terminal-routing/Exhaustive private terminal routing remains authored and leakage-clean
- [x] Confirmed no Decision Ledger row resolves in this increment
- [x] Appended accepted journal entries attributed via inc 01 subagent
- [x] Reorientation entry written with the full three-stance pass (K=1)
- [x] Ticked registry row 01 with the reorientation timestamp
