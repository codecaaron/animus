<!--
brainstorm.md is the immutable strategic exploration record once design.md
exists. design.md supersedes it on conflict.
-->

# Simplify the Verification Graph

## Exploration evidence

This capture distills the approved 2026-07-18 verification-DX discussion,
primary-source comparisons with Vite+, BlockNote, Vinext, Nx, Turborepo,
moon, and Bazel, and three cold read-only reviews from new-contributor,
package-maintainer, and CI/release perspectives. The user approved the
perspective rotation: Animus has necessary evidence breadth but has encoded
scope, phase, environment, and prerequisite state as a verbose root command
cross-product.

## Decision chain

1. Animus has real proof obligations that ordinary web applications do not:
   Rust and NAPI boundaries, two extraction engines, semantic parity, multiple
   host frameworks, Worker upload validation, packed consumers, and exact
   release bytes.
2. Those obligations do not require one root task name per consumer and phase.
   Vite+ already derives ordering and selection from workspace dependencies and
   supports recursive, transitive, package-target, and dependent filtering.
3. Animus already declares the relevant workspace edges from fixtures to
   libraries, but root `vite.config.ts` manually selects packages with concrete
   commands and repeats build/assert/dry-run families.
4. The same intended graph is then restated in root tasks, AGENTS.md, shell
   preconditions, CI, release code, and OpenSpec policy. The copies have
   demonstrably drifted: names overstate claims, local `verify:ci` omits a CI
   lane, and change routing can omit owned tests.
5. Therefore the simplification target is ownership and invocation, not proof
   deletion: packages and fixtures own complete `verify` claims; root commands
   aggregate those claims through the workspace graph; atomic commands remain
   directly callable diagnostics.

## Known now

- `verify` remains the fast repository gate and must state its exclusions.
- `verify:full` remains the complete local/current-host proof.
- A package or fixture `verify` claim must be complete for that owner. A Worker
  fixture claim includes its contracts, production build, output assertion,
  and credential-free upload dry-run.
- Atomic evidence primitives remain independently runnable and fail loud when
  their required artifact is absent or stale.
- Root orchestration must stop enumerating consumer phase cross-products.
- CI owns runner/platform matrices. A local command must not claim exact CI
  parity, so public `verify:ci` is removed or reduced to a compatibility alias
  whose documented claim is no stronger than `verify:full`.
- Exact release-bundle verification remains release-owned and publishes the
  bytes it verifies; this change must preserve the guardrails of the active
  `harden-verification-truth` change.
- The durable contributor contract is AGENTS.md. Atomic commands may be
  documented as a diagnostic reference, but the primary path presents intent-
  level commands and package-target examples.

## Deferred variables

- **Vite Task cache enablement.** Deferred until each candidate task passes a
  two-run cache probe and platform/env-sensitive tasks have explicit tracking.
  Simplification does not depend on caching.
- **Automatic SCM-affected selection.** Deferred until Vite+ provides or the
  repository proves a fail-closed changed-file selector. Workspace dependent
  filters are sufficient for this increment.
- **Migration removal date for old atomic aliases.** Deferred until repository
  search and CI prove no external automation invokes them. Diagnostic atomic
  names may remain indefinitely without being primary entrypoints.
- **Whether `verify:ci` is deleted or aliases `verify:full`.** Resolve during
  implementation from an executable reference census. The invariant is that it
  must not claim to reproduce the GitHub matrix.
- **Whether every publishable package adopts `vp pack`.** Deferred to a package-
  output parity spike; this change reorganizes verification without changing
  published bundle semantics.

## Candidate North Star

- A contributor chooses a verification command from the claim they need, not
  from knowledge of artifact-production phases.
- Every supported owner has exactly one complete verification claim.
- Workspace dependency edges select upstream/downstream scope; adding a
  consumer does not require editing multiple root composite arrays.
- Each green command states what it certifies and what it excludes.
- Diagnostic leaves remain narrow, deterministic, and actionable.
- Provisional: repeated local work should become cacheable where safe; revisit
  after the explicit cache probes above.

## Candidate guardrails

- **G1 — No evidence deletion.** The change SHALL NOT remove a currently
  required lint, type, unit, parity, integration, consumer, Worker, packed, or
  release proof. Executable check: compare the pre/post proof inventory and
  assert every proof is reachable from an owner or repository composite.
- **G2 — No weakened atomic truth.** Atomic assertions and dry-runs SHALL NOT
  silently build missing prerequisites. Executable check: contract tests invoke
  representative leaves without outputs and assert the existing fail-loud
  remediation shape.
- **G3 — Complete owner claims.** A supported Worker fixture `verify` SHALL
  reach contracts, build, assertion, and dry-run. Executable check: structural
  graph tests enumerate every supported fixture and compare its reachable set.
- **G4 — No local CI overclaim.** No local task SHALL claim runner, architecture,
  or release-byte parity it cannot provide. Executable check: task/docs contract
  rejects the old `verify:ci` description and requires explicit exclusions.
- **G5 — Preserve exact release bytes.** Packed verification SHALL NOT add
  workspace overrides or publish repacked artifacts. Executable check: retain
  the packed-graph and release-bundle contracts owned by
  `harden-verification-truth`.
- **G6 — One executable consumer registry.** Supported Worker consumers SHALL
  be enumerated once for task generation/validation and reused by CI-facing
  checks. Executable check: adding a synthetic registry entry expands every
  required owner phase in the graph contract without editing parallel arrays.
- **G7 — No destructive cleanup in verification.** Verification composites
  SHALL NOT call cleanup or hygiene fix modes. Executable check: task-graph
  contracts reject clean/hygiene mutation dependencies.
