# Brainstorm: simplify V1 terminal routing

Exploration evidence captured 2026-07-19 from the current checkout using
RepoWise `get_health`, `get_risk`, `get_context`, `get_symbol`, and `get_why`,
then verified against live callers, tests, canonical specs, archived decisions,
active OODA footprints, and read-only Git state.

## What the queue lead actually means

- RepoWise identifies `packages/extract/src/chain_walker.rs` as a 96% hotspot
  with health 4.83, bus factor 1, and `extract_terminal_arg()` as the file's
  primary nested-complexity reason.
- The reported `unreachable!()` is a reachability false positive: the outer
  match already handles `AsClass`, so the inner `AsClass` arm cannot execute.
  It is still removable process debt because an exhaustive flat match expresses
  the same state space without a panic-shaped branch.
- The reported V1/V2 duplication is not a shared-code mandate. V1 is the
  behavioral oracle, V2 owns its own phase shape, and no co-change signal
  requires coupling the engines. V2 stays untouched.
- The next higher-impact `theme_resolver::resolve_value` suggestion is skipped:
  active change `harden-embedded-transform-integration` fingerprints that file
  as unchanged. Editing it now would invalidate existing OODA evidence.
- No active non-archive OODA change owns `chain_walker.rs`.

## Approaches considered

1. **Recommended: replace the nested terminal match with one exhaustive flat
   match and add a characterization matrix first.** Each terminal arm owns its
   argument shape directly; `AsClass` remains argument-free, `AsElement`
   accepts a string literal, and `AsComponent` accepts an identifier while
   retaining its existing fallback. This removes the unreachable arm without
   a helper or public change.
2. **Add one helper per terminal kind.** Rejected: three tiny one-use helpers
   add names and indirection without creating an ownership seam.
3. **Share the implementation with V2.** Rejected: cross-engine textual
   duplication is intentional here, V1 is the compatibility oracle, and the
   engines have no demonstrated shared ownership need.

## KNOWN-NOW

- `try_walk_chain()` is the sole production caller. It maps the public terminal
  method name to `TerminalKind`, calls `extract_terminal_arg()`, and preserves
  `None` as an empty tag through `unwrap_or_default()`.
- Valid terminal shapes are already distributed across unit, canary, parity,
  and canonical spec evidence, but V1 unit coverage has no single matrix that
  includes `.asClass()` alongside `.asElement()` and `.asComponent()`.
- A pure refactor does not need an invented failing behavior. The direct matrix
  is added and observed GREEN against the existing implementation first, then
  must remain GREEN after the exhaustive-match rewrite.
- Canonical `rust-extraction-pipeline`, `builder-chain`,
  `dynamic-prop-fallback`, and `extension-system` specifications govern the
  terminal shapes and downstream recognition behavior.
- No `TerminalKind`, `ChainDescriptor`, caller, bail policy, ABI, or V2 change
  is licensed.

## DEFERRED

- **DEF-1 — diagnostics for invalid terminal arguments.** Resolve only when a
  JavaScript consumer fixture demonstrates an invalid terminal call that needs
  a user-facing diagnostic (`test:invalid-terminal-argument`).
- **DEF-2 — apply the same source refactor to V2.** Resolve only on a V2-local
  health plan or a demonstrated co-change requirement
  (`repowise:v2-terminal-routing-plan`).
- **DEF-3 — centralize terminal-name parsing.** Resolve only when a second
  V1-local consumer needs the method-name → `TerminalKind` mapping
  (`external:second-v1-terminal-consumer`).
- **DEF-4 — replace backward-walk mutable parameters with a state object.**
  Resolve only when a new state field or caller makes the current boundary
  harder to maintain (`external:next-chain-walk-state`).

## Candidate North Star

- **NS1:** Valid V1 terminal descriptors remain byte-equivalent for identical
  source.
- **NS2:** Terminal argument routing is one exhaustive match with no
  panic-shaped impossible arm.
- **NS3:** One focused unit matrix makes all three public terminal shapes
  legible to a new owner.
- **NS4:** Caller, descriptor, bail, NAPI, canary, and integration boundaries
  stay unchanged.
- **NS5 (provisional):** V2 remains independently implemented; revisit only on
  `repowise:v2-terminal-routing-plan`.

## Candidate Guardrails

- Do not modify public terminal/descriptor types, chain-method constants, the
  caller, or backward walker.
- Keep one private `extract_terminal_arg()` and remove the file's sole
  `unreachable!()`.
- Characterize `.asElement()`, `.asComponent()`, and `.asClass()` before the
  refactor and keep that matrix green afterward.
- Keep the V2 chain walker byte-stable.
- Preserve every existing dirty increment with a calibrated protected hash.
- Run the exact V1 Rust change-map verification.

## Decision chain

1. Skip `theme_resolver.rs` because an active OODA guardrail protects it.
2. Select the next clean Rust hotspot and inspect its primary finding before
   reading the whole file.
3. Reject the panic as reachable behavior and reject cross-engine duplication
   as a shared-code target.
4. Retain the actionable residue: the terminal router is needlessly nested and
   lacks one compact three-terminal characterization.
5. Choose the smallest exhaustive rewrite within one existing private
   function, with no helper/module/API expansion.
