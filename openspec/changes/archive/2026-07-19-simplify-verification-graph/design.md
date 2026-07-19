## Context

Animus currently defines 57 root Vite Task entries, including repeated
build/assert/dry-run families for five consumers, private before/after-build
stages, and separate `verify:full` and `verify:ci` projections. The repository
already declares the workspace dependency edges needed for Vite+ to select and
order packages, but root orchestration bypasses those edges with concrete
package commands. Contributors must also reconstruct the graph from AGENTS.md,
shell preconditions, and CI.

The evidence breadth is legitimate: Animus ships TypeScript packages, two Rust
NAPI engines, framework adapters, Worker consumers, and exact npm artifacts.
The design changes ownership and invocation without weakening those proofs. It
must coexist with the dirty, in-progress `harden-verification-truth` change,
whose exact-tarball and behavior-first requirements remain authoritative.

Stakeholders are contributors choosing a local proof, package maintainers
diagnosing failures, and CI/release owners maintaining one honest graph.

## Goals / Non-Goals

**Goals:**

- Give each supported consumer one complete package-owned `verify` claim.
- Use Vite+ workspace package selection and dependency ordering instead of
  target-specific root composite arrays.
- Present only root fast, root full, owner target, and dependent-filter claims
  as ordinary contributor workflows; keep phase diagnostics secondary.
- Keep `verify` as the fast root gate and make `verify:full` the sole complete
  local/current-host proof.
- Remove the public local-CI simulation claim.
- Retain directly runnable atomic diagnostics with fail-loud preconditions.
- Reduce root task definitions, consumer wrapper scripts, and contributor
  routing combinations while preserving every evidence primitive.

**Non-Goals:**

- Removing or weakening verification evidence.
- Reproducing GitHub runner, architecture, or release-byte matrices locally.
- Enabling cache for native, environment-sensitive, or release tasks without a
  separate calibrated cache proof.
- Replacing host-framework production build commands.
- Migrating every publishable package to `vp pack`.
- Completing unrelated truth-hardening increments inside this change.

## Decisions

### D1: Consumers own a conventional `verify` script
- **Choice**: `packages/showcase` and each `e2e/*` consumer expose a package
  `verify` script. A supported Worker consumer composes a fail-loud dependency
  preflight and production build, output assertion, and Wrangler dry-run; Next
  composes its preflight/build and output assertion. The root fast gate owns
  the cross-consumer Worker contract suite once. Owner preflights derive the
  transitive dist-bearing workspace closure from package manifests and report
  all missing/stale artifacts with one preparation recipe.
- **Rationale**: The package is the stable owner of framework-specific commands
  and output paths. `vp run @package#verify` is understandable without root
  task-name archaeology and remains artifact-honest in CI jobs that download
  prebuilt native outputs instead of rebuilding Rust.
- **Alternatives considered**: Keep root target composites (rejected: preserves
  duplicated ownership); generate every target-phase root task from a registry
  (rejected: compresses code but retains the wrong public abstraction).

### D2: Public composites select package claims through Vite+
- **Choice**: Root `verify` remains the fast source/current-host gate.
  `verify:full` materializes shared native/TypeScript prerequisites once,
  invokes the root gate, package-owned consumer claims through workspace
  filters, and the parity/integration/packed evidence that remains repository-
  owned. Package maintainers use package targets and dependent filters for
  focused proof; every canonical filter uses `--fail-if-no-match`, and a
  mandatory owner-discovery contract detects partially missing owner scripts.
  Atomic owner builds retain fail-loud upstream preconditions.
- **Rationale**: Vite+ already resolves package targets and filtered dependent
  sets from workspace manifests. This makes adding a consumer an ownership
  operation rather than a root graph rewrite, while fail-loud preflights avoid
  rebuilding Rust in CI jobs that download native artifacts.
- **Alternatives considered**: A custom changed-file router (rejected: creates a
  second dependency model); full recursive verification of every package
  (rejected for this increment: source gates already aggregate package checks
  and would be duplicated while caching remains disabled).

### D3: Atomic diagnostics stay explicit but leave the primary interface
- **Choice**: Build, assertion, dry-run, canary, parity, integration, and packed
  diagnostics remain independently runnable. Consumer phase diagnostics move
  to package scripts where they are naturally owned; obsolete root aliases and
  one-command shell wrappers are removed after reference-census tests pass.
  An alias named by another active change remains as a narrow compatibility
  bridge until that consumer is rebased; it is not documented as an ordinary
  workflow.
- **Rationale**: Maintainers need narrow failure isolation, but contributors do
  not need every diagnostic presented as an ordinary workflow.
- **Alternatives considered**: Hide all leaves behind one opaque verify command
  (rejected: degrades recovery); retain every alias indefinitely (rejected:
  preserves ambiguity and maintenance load).

### D4: Public `verify:ci` is retired
- **Choice**: Remove `verify:ci` and its private stages from executable and
  durable current-policy surfaces. CI continues to invoke owner and atomic
  claims directly. Historical change artifacts are not rewritten.
- **Rationale**: A single-host local command cannot reproduce GitHub's runner,
  architecture, artifact-transfer, or release topology, and the current copy
  has already drifted from CI.
- **Alternatives considered**: Alias it to `verify:full` (rejected: leaves an
  attractive misleading name); continuously synchronize it with CI (rejected:
  maintains a second graph with a knowingly weaker claim).

### D5: CI keeps job ownership while invoking owner claims
- **Choice**: Existing CI job boundaries and release dependencies remain. Jobs
  whose evidence boundary is build+assert invoke package-owned phase
  diagnostics; the all-Worker job invokes complete Worker owner claims after
  the global Worker contract once. Exact release-bundle verification remains
  release-owned and is protected by a parsed CI topology contract.
- **Rationale**: CI job topology carries platform, artifact, receipt, and
  release semantics that do not belong in local task names. Reusing package
  claims removes phase duplication without conflating environments.
- **Alternatives considered**: Replace the workflow with one monolithic local
  full command (rejected: loses CI-specific artifacts and parallelism); add a
  new generated workflow system (rejected: beyond the needed simplification).

### D6: Structural contracts protect reachability, not source strings alone
- **Choice**: A behavior-oriented task-graph contract resolves package scripts,
  verifies supported owner reachability, and inventories retained proof
  primitives before obsolete aliases are deleted. It discovers supported
  owners from the workspace directory rule, derives their manifest dependency
  closure, runs in the mandatory TypeScript unit tier, and fails on missing
  owners or fail-open filters.
- **Rationale**: The active hardening design already rejects ceremonial source
  checks. The simplification needs an executable claim map, not another prose
  list.
- **Alternatives considered**: Snapshot `vite.config.ts` text (rejected: easy to
  satisfy while behavior drifts); documentation review alone (rejected:
  previously failed to keep composites aligned).

## North Star

**Adversarial cadence K**: 1

- **NS1**: Contributors select a claim, not a production phase.
- **NS2**: Every supported owner has one complete verification command.
- **NS3**: Workspace dependencies determine package scope and ordering.
- **NS4**: Each green command states both its evidence and exclusions.
- **NS5**: Diagnostic leaves remain narrow and actionable.
- **NS6**: Safe cache reuse is desirable but provisional — revisit only after
  two-run cache probes and explicit platform/environment tracking pass.

## Decision Ledger

| ID    | Decision | Status | Owner increment | Resolving signal | Review-by |
| ----- | -------- | ------ | --------------- | ---------------- | --------- |
| DEF-1 | Enable Vite Task caching for source and TypeScript build claims | deferred | external:vite-task-cache-proof | A two-run local probe restores exact outputs and invalidates on source, config, and relevant environment changes | 3 reorientations \| 2026-08-01 |
| DEF-2 | Add automatic SCM-affected verification selection | deferred | external:affected-selector-proof | A fail-closed selector proves changed-package and dependent closure against the workspace graph | 3 reorientations \| 2026-08-01 |
| DEF-3 | Migrate publishable package builds to `vp pack` | deferred | external:vite-pack-output-parity | Packed output, exports, declarations, and native payload parity is demonstrated for all publishable packages | 3 reorientations \| 2026-08-15 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| -- | --------- | ----- | ------- | ------ |
| G1 | The change SHALL NOT remove a required proof primitive from executable reachability; G3 covers owner closure and edit-surface routing | all | STOP | active (calibrated 2026-07-18: pass) |
| G2 | Atomic assertion and dry-run diagnostics SHALL NOT silently build missing prerequisites | footprint:scripts/verify/** | STOP | armed(inc 01) |
| G3 | Every discovered consumer owner claim SHALL reach its required build/assert phases, every Worker owner SHALL also reach dry-run, the root fast gate SHALL reach cross-consumer Worker contracts once, and manifest-derived preflight closure SHALL contain every transitive dist-bearing workspace dependency | inc:01,02 | STOP | armed(inc 01) |
| G4 | Current executable and contributor-doc surfaces SHALL NOT expose `verify:ci` as a local CI mirror; baseline specs remain overlaid by this active delta until archive, and historical change artifacts are outside scope | inc:02,03 | STOP | armed(inc 02) |
| G5 | Simplification SHALL NOT weaken exact packed-graph or immutable release-bundle pack→verify→publish wiring, publication order, or release gate dependencies | all | STOP | armed(inc 02) |
| G6 | Verification composites SHALL NOT invoke destructive clean or hygiene-fix operations | all | STOP | armed(inc 01) |

Checks — verbatim commands:

**G1** — expected: `proof-inventory=present`

```bash
for task in verify:lint verify:compile verify:types verify:unit:rust verify:clippy verify:unit:ts verify:workers:contracts verify:hygiene:rust verify:canary verify:parity verify:integration verify:packed; do rg -q "'$task'" vite.config.ts || exit 1; done; echo proof-inventory=present
```

**G2** — expected after increment 01: focused contract test passes

```bash
bunx vp test run scripts/verify/owner-graph.test.ts -t 'atomic diagnostics fail loud without building'
```

**G3** — expected after increment 01: focused contract test passes

```bash
bunx vp test run scripts/verify/owner-graph.test.ts -t 'consumer owner claims are complete'
```

**G4** — expected after increment 02: empty output

```bash
rg -n 'verify:ci' vite.config.ts AGENTS.md CLAUDE.md
```

**G5** — expected: packed graph and parsed CI release wiring tests pass

```bash
bunx vp test run scripts/verify/packed-graph.test.ts scripts/verify/ci-graph.test.ts
```

**G6** — expected after increment 01: focused contract test passes

```bash
bunx vp test run scripts/verify/owner-graph.test.ts -t 'verification claims exclude mutating cleanup'
```

## Risks / Trade-offs

- [Risk] Package `verify` scripts accidentally omit a phase -> Mitigation:
  owner-graph reachability contracts enumerate required phases before aliases
  are removed.
- [Risk] Vite+ nested task semantics differ from assumption -> Mitigation: the
  design was calibrated in an isolated workspace: root config tasks and child
  package `verify` scripts coexist, and recursive execution reaches both.
- [Risk] Active `harden-verification-truth` edits overlap task/docs/CI files ->
  Mitigation: apply patches against the dirty tree, preserve exact-tarball and
  Worker-gate changes, and run both changes' structural tests.
- [Risk] Removing aliases breaks unsearched automation -> Mitigation: perform a
  repository-wide reference census, author deltas for every affected active
  capability, and retain aliases with a named live active-change consumer.
- [Risk] Workspace filtering skips an owner missing `verify` -> Mitigation:
  fail-closed filters plus a mandatory discovery contract in `verify:unit:ts`.
- [Risk] A hard-coded artifact closure drifts from manifests -> Mitigation:
  derive the transitive closure and test it against every discovered owner.
- [Trade-off] Some atomic task names remain -> acceptable because they are a
  diagnostic API rather than the contributor-facing workflow.
- [Trade-off] Cache remains disabled -> acceptable because semantic ownership
  simplification is independent of performance optimization.

## Migration Plan

1. Add failing owner-graph contracts and package-owned consumer claims while
   old aliases still work.
2. Rewire `verify:full` and CI consumer steps to owner claims; repair nightly
   v1/v2 materialization, remove the false local-CI projection, and update
   current policy/docs.
3. Census and remove obsolete root aliases and wrapper scripts except named
   active-change compatibility bridges, then run proof
   inventory, owner reachability, packed-graph, Worker contracts, focused
   consumer builds/assertions/dry-runs, and OpenSpec validation.

Rollback is file-level restoration of removed aliases/wrappers; no production
deployment or persistent data migration is involved. Acceptance requires fewer
root tasks and wrappers, exactly four documented ordinary workflow shapes, all
guardrails green, and the same required evidence reachable through the new
owner commands and edit-surface routes.
