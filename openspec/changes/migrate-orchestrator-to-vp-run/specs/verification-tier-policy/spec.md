## ADDED Requirements

### Requirement: Orchestrator Binding via Vite+ vp run

The atomic tiers, composite orchestrators, shared precondition helper, Change-Type Map, and CI-simulation semantics defined in this spec are dispatched through Vite+ (`vp` CLI). The canonical orchestrator-dispatch surface SHALL be `vp run <tier>` for every atomic tier and composite orchestrator. The `bun run <tier>` invocation surface SHALL continue to work as a transparent alias — `package.json` `scripts` entries route through `vp run`, so `bun run verify` invokes the same task graph as `vp run verify`.

The shell helper at `scripts/verify/_preconditions.sh` SHALL remain the single authoritative implementation of every atomic-tier precondition. Vite+ task definitions in `vp.config.ts` SHALL invoke `bash scripts/verify/<tier>.sh` as the task body for every precondition-bearing tier — the precondition logic is NOT reimplemented in vp-native config. The loud-fail message shape (`ERROR: <missing or stale>. Run: <command>`), non-zero exit semantics, and atomic-tier isolation contracts (no silent upstream rebuilds) are preserved verbatim under the new dispatch surface.

A future rebind to a different orchestrator SHALL preserve every behavioral requirement in this spec while updating only the invocation surface — the same constraint that applies to the `bun run` → `vp run` rebind documented here.

#### Scenario: vp run dispatches atomic tier via shell script body

- **WHEN** a developer runs `vp run verify:canary` at the repository root
- **THEN** vp invokes `bash scripts/verify/canary.sh` as the task body
- **AND** the script's stderr and exit code are propagated unchanged to vp's stderr and exit code

#### Scenario: bun run X works as transparent alias

- **WHEN** a developer runs `bun run verify` at the repository root
- **AND** `package.json` `scripts.verify` is `"vp run verify"`
- **THEN** the invocation routes through vp's task graph
- **AND** the resulting tier execution is identical to `vp run verify` invoked directly

#### Scenario: Loud-fail message shape survives vp dispatch

- **WHEN** a developer runs `vp run verify:canary` with no `packages/extract/*.node` file present
- **THEN** the wrapped `bash scripts/verify/canary.sh` invokes `require_fresh_napi`
- **AND** vp's stderr contains the exact line `ERROR: NAPI binary missing. Run: bun run build:extract`
- **AND** vp exits with status 1
- **AND** vp does NOT trigger any rebuild

#### Scenario: Atomic-tier isolation survives vp dispatch

- **WHEN** a developer runs `vp run verify:integration` with `packages/extract/dist/` missing
- **THEN** vp's wrapped tier script exits with the precondition failure naming `bun run --filter '@animus-ui/extract' build:ts`
- **AND** vp does NOT invoke the upstream build
- **AND** the integration test does NOT run

#### Scenario: _preconditions.sh remains the authoritative implementation

- **WHEN** a maintainer greps `vp.config.ts` for inline precondition logic (mtime checks, dist freshness probes, helper-function definitions)
- **THEN** no such logic appears in `vp.config.ts`
- **AND** every precondition-bearing task body is `bash scripts/verify/<tier>.sh`
- **AND** `_preconditions.sh` continues to be sourced by every tier script as before

### Requirement: vite-plus is a Pinned Root devDependency

The root `package.json` `devDependencies` SHALL include `vite-plus` at a pinned version (no `^`-range, no `~`-range, no `latest` resolution). The pinned version SHALL be a specific Vite+ alpha release identifier. The same pinned version SHALL be installed in CI by the workflow's vite-plus install step.

#### Scenario: Pinned version in package.json

- **WHEN** a maintainer reads root `package.json` `devDependencies`
- **THEN** `vite-plus` appears with a fully-qualified version string (e.g., `"vite-plus": "0.x.y"`)
- **AND** no range modifier (`^`, `~`, `*`, `latest`) appears

#### Scenario: CI installs the same pinned version

- **WHEN** a CI workflow step installs vite-plus
- **THEN** the install step references the same version string as `package.json` `devDependencies.vite-plus`
- **AND** no version drift can occur between local and CI installs
