# orchestration-architecture Specification

## Purpose

Designate the single root orchestrator that owns the monorepo's workspace task DAG, content-addressed task caching, library packing, application bundling, unified lint/format/typecheck, and unified test runner. This capability establishes the singularity invariant (exactly one orchestrator owns these concerns), names Vite+ (`vp` CLI) as the chosen orchestrator instance, defines the migration trigger criteria for cutover from the current bun-based binding, and pins the invariants that any orchestrator binding SHALL preserve (loud-fail atomic-tier preconditions, Change-Type Map authoritativeness, dependency-derived build ordering, dist-staleness check pattern, atomic-tier isolation, Rust-pipeline exclusion, `.tool-versions` bun pin, follow-on policy decomposition).

## Requirements

### Requirement: Single Orchestrator Surface

The animus monorepo SHALL designate exactly one root orchestrator that owns the following concerns: workspace task DAG, content-addressed task caching, library packing, application bundling, unified lint/format/typecheck, unified test runner. The orchestrator's CLI surface SHALL be the single canonical entry point for task invocation at the repository root, accessible identically to humans, agents, and CI.

The orchestrator's identity and CLI surface SHALL be specified in a separate per-binding policy change (e.g., `migrate-orchestrator-to-vp-run`). This requirement establishes the singularity invariant — multiple orchestrators competing for ownership of the same concern SHALL NOT exist.

#### Scenario: Single orchestrator owns task dispatch

- **WHEN** a developer or CI agent invokes any verification, build, test, lint, or pack task at the repository root
- **THEN** the invocation goes through the single designated orchestrator binary (or its equivalent shell entry point during transition)
- **AND** no parallel orchestrator binary owns the same concern

### Requirement: Designated Orchestrator

The repository SHALL designate **Vite+** (`vp` CLI, https://viteplus.dev) as the chosen orchestrator instance. Once any cutover follow-on lands, the designation SHALL be recorded in root `CLAUDE.md` documenting: the version constraint (initially Vite+ alpha or later), the rationale (in-ecosystem with Vite/Vitest/Rolldown/tsdown; bun support shipped; MIT licensed), and the swap-out criteria.

Any orchestrator satisfying every requirement in this capability spec MAY replace Vite+ via a separate rebind change. The designation is one valid choice, not an immutable identity.

#### Scenario: Orchestrator designation is documented

- **WHEN** a developer or agent reads root `CLAUDE.md` after the first cutover follow-on lands
- **THEN** the orchestrator's name, version-floor, rationale, and swap-out criteria are documented in a single section

### Requirement: Migration Trigger Criteria

Cutover from the current bun-based binding to Vite+ SHALL be gated on either of two criteria:

- **Criterion A**: Vite+ reaching general availability (GA) per the official VoidZero release channel.
- **Criterion B**: Per-slice maintainer-signed risk-acceptance documented in the corresponding follow-on `proposal.md`. The risk-acceptance MUST surface a written exposure assessment covering the alpha-status risk for that specific cutover slice.

A cutover follow-on that does not satisfy at least one criterion SHALL NOT be merged.

#### Scenario: Pre-GA cutover requires risk-acceptance

- **WHEN** a follow-on cutover change is proposed before Vite+ reaches GA
- **THEN** its `proposal.md` SHALL include a `## Risk Acceptance` section signed by the repo maintainer
- **AND** the section SHALL document the specific alpha-status exposure for the cutover slice

#### Scenario: Post-GA cutover does not require risk-acceptance

- **WHEN** a follow-on cutover change is proposed after Vite+ reaches GA
- **THEN** the risk-acceptance section is OPTIONAL
- **AND** the GA status SHALL be referenced in the proposal

### Requirement: Loud-Fail Atomic-Tier Preconditions Survive Orchestrator Swap

Any orchestrator binding SHALL preserve the atomic-tier loud-fail precondition contract defined in the `verification-tier-policy` spec. The contract requires: (a) precondition checks fire BEFORE the tier's primary work; (b) failure emits a stderr line of the shape `ERROR: <what's missing or stale>. Run: <exact command>`; (c) failure exits with non-zero status; (d) preconditions MUST NOT trigger upstream rebuilds.

The shared precondition helper at `scripts/verify/_preconditions.sh` (or its successor under any orchestrator binding) SHALL remain the single authoritative implementation of these checks. If an orchestrator-native equivalent emerges (e.g., a Vite Task hook), it MAY replace the shell helper provided every check is preserved with identical semantics. Until a native equivalent demonstrably preserves all checks, the orchestrator SHALL invoke the existing shell scripts as task bodies.

#### Scenario: Orchestrator binding preserves loud-fail shape

- **WHEN** any orchestrator binding implements an atomic tier (e.g., `verify:canary`)
- **AND** the upstream NAPI binary is missing
- **THEN** the binding emits a stderr line matching `ERROR: NAPI binary missing. Run: <command-to-build-NAPI>`
- **AND** exits with a non-zero status
- **AND** does NOT trigger a NAPI rebuild

#### Scenario: Shell helper survives until orchestrator-native equivalent ships

- **WHEN** an orchestrator binding is proposed
- **AND** the orchestrator does not provide a native hook that preserves every `_preconditions.sh` check
- **THEN** the binding SHALL invoke `bash scripts/verify/<tier>.sh` as the task body for tiers that require preconditions
- **AND** the shell helper remains in the repository unchanged

### Requirement: Change-Type Map Survives Orchestrator Swap

The Change-Type Map in root `CLAUDE.md` (mandated by `verification-tier-policy`) SHALL be preserved through any orchestrator binding swap. Each cutover follow-on that changes a tier invocation SHALL update the Change-Type Map's `Run` column in the SAME change that lands the cutover, keeping the map as the authoritative agent-facing instructability surface.

#### Scenario: Cutover updates Change-Type Map atomically

- **WHEN** a cutover follow-on lands (e.g., `migrate-lint-to-vp-check`)
- **AND** the follow-on changes the invocation surface for `verify:lint`
- **THEN** the same follow-on edits the Change-Type Map in root `CLAUDE.md`
- **AND** the map's `Run` column reflects the new invocation

### Requirement: Dependency-Derived Build Ordering Survives Orchestrator Swap

The dependency-derived build ordering invariant defined in `workspace-build-ordering` SHALL be preserved through any orchestrator binding swap. Adding a new package to the workspace with appropriate `package.json` dependencies SHALL NOT require editing root orchestrator scripts or task definitions to position it correctly in the build graph.

#### Scenario: New package builds in correct position without orchestrator config edit

- **WHEN** a new package is added with appropriate `dependencies` in its `package.json`
- **AND** the orchestrator's full-build task is invoked
- **THEN** the package builds in its correct topological position
- **AND** no root orchestrator script or task config required edits

### Requirement: Dist-Staleness Check Pattern Survives Orchestrator Swap

The dist-staleness check pattern (existence AND mtime-vs-src) defined in `verification-tier-policy` SHALL be preserved through any orchestrator binding swap. Tiers that consume a package's `dist/` at runtime SHALL check both that the dist exists AND that its key artifact's mtime is newer than the package's `src/**`. A stale dist SHALL surface as a precondition failure with the same loud-fail message shape.

#### Scenario: Stale dist surfaces as precondition failure under any binding

- **WHEN** a tier requires a fresh `packages/<pkg>/dist/`
- **AND** the dist exists but the key artifact's mtime is older than `packages/<pkg>/src/**`
- **THEN** the tier exits non-zero
- **AND** stderr identifies the dist as stale and includes the rebuild command for that package

### Requirement: Atomic-Tier Isolation Survives Orchestrator Swap

The atomic-tier isolation contract defined in `verification-tier-policy` SHALL be preserved through any orchestrator binding swap. An atomic tier MUST NOT silently rebuild upstream artifacts. If upstream artifacts are missing or stale, the tier SHALL fail with the loud-fail message identifying the upstream rebuild command rather than invoking it.

#### Scenario: Tier does not silently rebuild upstream

- **WHEN** an atomic tier is invoked
- **AND** an upstream artifact is missing or stale
- **THEN** the tier exits non-zero with the loud-fail message
- **AND** the tier does NOT invoke the upstream build

### Requirement: Rust Pipeline Excluded from Orchestrator Scope

The Rust NAPI build for `packages/extract` SHALL remain owned by `cargo` + `@napi-rs/cli` regardless of which orchestrator is bound. Rust unit tests SHALL remain owned by `cargo test`. The orchestrator's task graph MAY include Rust-pipeline tiers as orchestrated invocations of the cargo-based commands, but the orchestrator SHALL NOT replace the underlying Rust toolchain.

This exclusion is a permanent boundary, not a deferral. Specs covering the Rust pipeline (`rust-extraction-pipeline`, `ci-napi-binary-verification`, etc.) SHALL NOT be modified by any orchestrator binding change.

#### Scenario: Rust NAPI build invocation goes through cargo

- **WHEN** the orchestrator's full-build task includes the Rust NAPI build
- **THEN** the build invokes `napi build --platform --release` (or its `cargo`-equivalent surface)
- **AND** the orchestrator does NOT attempt to compile Rust source itself

#### Scenario: Rust unit tests go through cargo

- **WHEN** the orchestrator's test task includes Rust unit tests
- **THEN** the tests invoke `cargo test --lib` (or equivalent)
- **AND** the orchestrator does NOT attempt to discover or run Rust tests through its TS test runner

### Requirement: Bun Version Pin Survives Orchestrator Swap

The `.tool-versions` file SHALL remain the authoritative bun version pin per `verification-tier-policy`'s "Bun Version Pin" requirement. Any orchestrator binding that introduces its own runtime/package-manager selection mechanism SHALL respect or layer cleanly over `.tool-versions`. If the orchestrator's runtime-selection mechanism conflicts with `.tool-versions`, the conflict SHALL be resolved in favor of `.tool-versions` and the resolution documented in the binding follow-on.

#### Scenario: Orchestrator runtime selection respects .tool-versions

- **WHEN** an orchestrator binding's runtime/PM selection mechanism is invoked at the repository root
- **THEN** the active bun version matches the content of `.tool-versions`
- **AND** no manual override is required

### Requirement: Follow-On Policy Decomposition

Cutover from the current bun-based binding to Vite+ SHALL be decomposed into per-slice follow-on policy changes. A single mega-change covering all subcommand cutovers SHALL NOT be merged. The decomposition exists to enable per-slice review, per-slice risk-acceptance, and per-slice rollback.

The follow-on slices SHALL include at minimum:

- A change rebinding the task-graph orchestrator
- A change rebinding the linter / formatter / typechecker surface
- A change rebinding the library bundler
- A change rebinding the test runner
- A change rebinding (or explicitly preserving shell) the cleaning surface

Each follow-on SHALL satisfy the migration trigger criteria and the invariants defined in this spec before merge.

#### Scenario: Per-slice follow-on lands independently

- **WHEN** a single cutover slice (e.g., the test-runner rebind) is ready to merge
- **AND** other slices are not yet ready
- **THEN** the ready slice MAY merge independently
- **AND** the unmerged slices remain blocked on their own readiness criteria
