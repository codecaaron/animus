## Context

RepoWise scores `packages/extract/src/chain_walker.rs` at 4.83 and places it in
the 96th hotspot percentile. Its primary reason is nested complexity in
`extract_terminal_arg()`. The function has one production caller and three
terminal variants, yet an outer catch-all plus inner match produces a fifth
nesting level and an impossible `unreachable!()` arm.

The panic report is not a reachable defect: the outer `AsClass` arm excludes
the inner `AsClass` case. The maintainability finding remains actionable
because an exhaustive flat match expresses the same contract more directly.
V1 remains the behavioral oracle for V2; source sharing or synchronized engine
edits are out of scope.

## Goals / Non-Goals

**Goals:**

- Make each terminal kind's argument contract visible in one exhaustive match.
- Add one compact characterization covering all valid public terminal shapes.
- Remove the panic-shaped impossible arm without changing fallbacks.
- Preserve engine locality and every runtime boundary.

**Non-Goals:**

- Change invalid terminal diagnostics or extraction fallbacks.
- Edit V2, share terminal code, or add a module/helper.
- Change terminal names, descriptor fields, chain recognition, or bail policy.
- Refactor the larger backward walker or its parameter list.

## Decisions

### D1: Flatten the terminal match exhaustively

- **Choice**: Match directly on `TerminalKind::AsClass`, `AsElement`, and
  `AsComponent`; each argument-taking arm fetches its own first argument.
- **Rationale**: The enum is closed and small. Exhaustive matching removes the
  catch-all nesting and makes the compiler prove every variant is covered.
- **Alternatives considered**: per-terminal helpers add indirection; retaining
  the outer catch-all preserves the smell.

### D2: Characterize before refactoring

- **Choice**: Add `terminal_argument_shapes_preserve_tags` first and run it
  against the existing implementation. It covers the valid element literal,
  component identifier, and argument-free class terminals in one source file.
- **Rationale**: This is a pure refactor, so the honest test-first signal is a
  GREEN characterization baseline rather than an invented failing behavior.
- **Alternatives considered**: source-text tests would couple behavior to
  syntax; relying only on distributed canary/parity cases leaves the local
  ownership seam implicit.

### D3: Preserve the caller and fallback semantics

- **Choice**: Leave `try_walk_chain()` and its `unwrap_or_default()` unchanged;
  preserve the current `AsElement` and `AsComponent` match fallbacks exactly.
- **Rationale**: Invalid JavaScript inputs are not being redesigned in this
  health increment, and caller behavior is part of the V1 oracle.
- **Alternatives considered**: new diagnostics or `Result` propagation would
  be a behavior/API change requiring separate evidence.

### D4: Keep V1 and V2 independent

- **Choice**: Edit only V1 `chain_walker.rs`; protect the V2 chain walker by
  content hash.
- **Rationale**: Textual duplication has no demonstrated co-change requirement,
  and V1 is the compatibility oracle rather than a shared-code target.
- **Alternatives considered**: a shared terminal module would couple different
  engine ownership and verification paths.

## North Star

**Adversarial cadence K**: 1

- **NS1**: V1 terminal descriptors remain byte-equivalent for identical valid
  source.
- **NS2**: Terminal routing is one exhaustive private match with no panic arm.
- **NS3**: One local executable matrix documents all three public terminal
  shapes.
- **NS4**: Caller, descriptor, chain recognition, bail, NAPI, canary, and
  integration boundaries remain stable.
- **NS5**: V2 remains independent — provisional — revisit on
  `repowise:v2-terminal-routing-plan`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Add invalid-terminal argument diagnostics | deferred | external:invalid-terminal-argument | test:invalid-terminal-argument | 3 reorientations \| 2026-08-19 |
| DEF-2 | Apply the source refactor to V2 | deferred | external:v2-terminal-routing-plan | repowise:v2-terminal-routing-plan | 3 reorientations \| 2026-08-19 |
| DEF-3 | Centralize terminal-name parsing | deferred | external:second-v1-terminal-consumer | external:second-v1-terminal-consumer | 3 reorientations \| 2026-08-19 |
| DEF-4 | Introduce backward-walk state object | deferred | external:next-chain-walk-state | external:next-chain-walk-state | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter terminal/descriptor public types, chain constants, caller, or backward walker | footprint:packages/extract/src/chain_walker.rs | STOP | active (inc 01 final: empty) |
| G2 | The router SHALL remain one private function with no `unreachable!()` in V1 | footprint:packages/extract/src/chain_walker.rs | STOP | active (inc 01 final: one private definition; no unreachable match) |
| G3 | All three valid terminal tag shapes SHALL remain characterized | footprint:packages/extract/src/chain_walker.rs | STOP | active (inc 01 final: focused 1/1) |
| G4 | The V2 chain walker SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/chain_walk.rs | STOP | active (inc 01 final: `8fa318e940337dda89e901f29cd44f0e9e83f95b6c13bb5149a71548af6b5930`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `1a6e96144a0c792983de234742b2243a444b1f9da8b7c8be57f777249c17d841  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust units 274 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff -- packages/extract/src/chain_walker.rs | rg '^[+][^+].*(pub enum TerminalKind|pub struct ChainDescriptor|CHAIN_METHODS|BAIL_METHODS|fn try_walk_chain|fn walk_chain_backwards)|^[-][^-].*(pub enum TerminalKind|pub struct ChainDescriptor|CHAIN_METHODS|BAIL_METHODS|fn try_walk_chain|fn walk_chain_backwards)' || true
```

**G2** — expected: one definition, no unreachable match

```bash
test "$(rg -c '^fn extract_terminal_arg\(' packages/extract/src/chain_walker.rs)" = 1
rg -n 'unreachable!\(\)' packages/extract/src/chain_walker.rs || true
```

**G3** — expected: focused characterization passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml chain_walker::tests::terminal_argument_shapes_preserve_tags --lib
```

**G4** — expected:
`8fa318e940337dda89e901f29cd44f0e9e83f95b6c13bb5149a71548af6b5930  packages/extract/crates/extract-v2/src/chain_walk.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/chain_walk.rs
```

**G5** — expected:
`1a6e96144a0c792983de234742b2243a444b1f9da8b7c8be57f777249c17d841  -`

```bash
git diff -- . ':(exclude)packages/extract/src/chain_walker.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Moving `first()` into each match arm changes missing-argument behavior
  -> Mitigation: preserve the same `?` in each argument-taking arm and leave
  caller defaulting untouched.
- [Risk] Valid terminal shapes drift -> Mitigation: one three-terminal matrix
  plus existing canary/integration gates.
- [Risk] Cross-engine source divergence grows -> Mitigation: V2 is hash-protected
  and intentionally independent; DEF-2 names the only reopening signal.
- [Trade-off] This does not address the larger backward-walk parameter smell ->
  accepted; DEF-4 keeps that larger design contingent on a real new state need.

## Migration Plan

N/A — private V1 refactor with no rollout. Acceptance requires a GREEN
characterization baseline, GREEN after the rewrite, G1-G6, strict OODA
validation, and independent two-phase review.
