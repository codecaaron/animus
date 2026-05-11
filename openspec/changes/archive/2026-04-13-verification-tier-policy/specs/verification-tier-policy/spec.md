## ADDED Requirements

### Requirement: Tier Naming Convention

The repository's verification commands SHALL follow a colon-separated naming convention of the form `verify:<tier>[:<scope>]`, where `<tier>` names the verification stage (e.g., `lint`, `compile`, `types`, `unit`, `canary`, `integration`, `build`, `assert`) and `<scope>` optionally disambiguates multi-scope tiers (e.g., `rust`, `ts`, `next`, `showcase`).

Composite orchestrators SHALL use bare names without a scope (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`) and MUST compose atomic tiers in dependency order.

#### Scenario: Atomic tier invocation

- **WHEN** a developer runs `bun run verify:unit:rust`
- **THEN** only the Rust unit tests execute; no TS work runs
- **AND** the script exits with a non-zero status if any required upstream artifact is absent

#### Scenario: Composite orchestrator invocation

- **WHEN** a developer runs `bun run verify`
- **THEN** the fast-gate atomic tiers execute in dependency order (`verify:lint`, `verify:compile`, `verify:types`, `verify:unit:ts`, `verify:unit:rust`, `verify:canary`)
- **AND** execution stops at the first failing tier with the failing tier's name visible in output

#### Scenario: Glob-targeted tier family

- **WHEN** an agent is instructed to "run all `verify:assert:*` tiers"
- **THEN** the naming convention enables enumerating `verify:assert:next` and `verify:assert:showcase` via `package.json` script listing without ambiguity

### Requirement: Atomic Tier Isolation

Every atomic tier SHALL execute its single concern in isolation. An atomic tier MUST NOT silently trigger upstream builds. An atomic tier MUST begin with a shell precondition block that exits with a non-zero status and a human-readable instruction identifying the missing upstream artifact and the exact command to produce it.

The atomic tiers defined by this policy are: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`.

Atomic tier preconditions SHALL be derived from the actual script each tier invokes (what the tier reads at runtime), not from generic "TS built" assumptions. In particular:

- `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust` have **no upstream artifact preconditions** — they operate on source.
- `verify:unit:ts` operates on source via `bun test`'s on-the-fly transpilation — no `dist/` precondition.
- `verify:canary` requires only a fresh NAPI binary; it does NOT require `packages/extract/dist/` or any other package's `dist/`.
- `verify:integration` requires a fresh NAPI binary AND `packages/extract/dist/index.mjs` (because it imports `@animus-ui/extract/pipeline` at runtime).
- `verify:build:next` and `verify:build:showcase` require `bun install` resolution and `packages/extract/*.node` (bundler invokes the plugin at build time).
- `verify:assert:next` requires `e2e/next-app/.next/` (post-migration path) build output.
- `verify:assert:showcase` requires `packages/showcase/dist/` build output.

#### Scenario: Missing NAPI binary surfaces as precondition failure

- **WHEN** a developer runs `verify:canary` with no `packages/extract/*.node` file present
- **THEN** the script exits 1
- **AND** stderr includes the exact message "ERROR: NAPI binary missing. Run: bun run build:extract" (or equivalent identifying the required upstream command)

#### Scenario: Stale NAPI binary surfaces as precondition failure

- **WHEN** a developer runs `verify:canary` with a `.node` file older than the newest `packages/extract/src/**/*.rs` source file
- **THEN** the script exits 1
- **AND** stderr identifies the binary as stale and includes the command `bun run build:extract`

#### Scenario: Present upstream artifact allows tier to run

- **WHEN** the fresh NAPI binary is present
- **AND** the developer runs `verify:canary`
- **THEN** the canary tests execute without any build step being re-run by the tier itself

#### Scenario: Tier does not rebuild upstream silently

- **WHEN** `verify:integration` is invoked with `packages/extract/dist/` missing
- **THEN** the tier exits with a precondition failure identifying `bun run build:ts` (or `bun run --filter '@animus-ui/extract' build:ts`) as the required upstream
- **AND** the tier does NOT invoke the build itself

#### Scenario: Source-reading tier has no artifact precondition

- **WHEN** `verify:compile` or `verify:types` or `verify:unit:ts` runs
- **THEN** the tier does NOT fail on missing `dist/` artifacts (because it reads source, not `dist/`)
- **AND** any precondition the script emits is limited to actual runtime inputs (e.g., `bun install` has been run)

### Requirement: Composite Orchestrators

The repository SHALL provide five composite orchestrators: `verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`.

- `verify` is the inner-loop fast gate and MUST compose: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:ts`, `verify:unit:rust`, `verify:canary`. It MUST NOT include integration, build, or assert tiers that require full fixture builds or package-dist artifacts.
- `verify:full` MUST compose `verify` plus `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`. It runs everything a local developer can run on one machine.
- `verify:ci` MUST simulate the CI job set and ordering (lint, test-rust, build-extract, verify-equivalent including integration + showcase assert) as closely as practical locally. It MUST invoke `bun run build:extract` and `bun run build:ts` inline (since CI materializes the binary and dist artifacts before verify). It is a best-effort mirror; byte-identical runner reproduction is a non-goal.
- `verify:next` MUST chain `verify:build:next && verify:assert:next`.
- `verify:showcase` MUST chain `verify:build:showcase && verify:assert:showcase`.

#### Scenario: verify is the fast gate

- **WHEN** a developer runs `bun run verify`
- **THEN** only the fast-gate tiers execute
- **AND** no showcase or next-app build is triggered
- **AND** no integration tests run (they belong to `verify:full`)

#### Scenario: verify:full includes integration + build + assert tiers

- **WHEN** a developer runs `bun run verify:full`
- **THEN** the fast-gate tiers execute first
- **AND** `verify:integration`, build tiers, and assert tiers execute after in dependency order

#### Scenario: verify:ci mirrors CI ordering and coverage

- **WHEN** a developer runs `bun run verify:ci`
- **THEN** the local execution order matches CI: `verify:lint` → `verify:unit:rust` → `bun run build:extract` → `bun run build:ts` → `verify:compile` → `verify:types` → `verify:unit:ts` → `verify:canary` → `verify:integration` → `verify:build:showcase` → `verify:assert:showcase`
- **AND** integration tests run (mirroring CI's `bun test` coverage)
- **AND** showcase build + assert runs (mirroring CI's `bun run test:showcase` step)
- **AND** release-gated steps are skipped

#### Scenario: verify:next and verify:showcase chain build + assert

- **WHEN** a developer runs `bun run verify:next`
- **THEN** `verify:build:next` runs first
- **AND** on success, `verify:assert:next` runs against the produced output
- **AND** on first-tier failure, the second tier does not run

### Requirement: Shell-Based Fail-Loud Preconditions

Every atomic tier script SHALL use shell (`bash`) preconditions at the top of the script to validate upstream artifacts before running its primary work. Preconditions MUST print a clear message to stderr on failure that names the missing or stale artifact and the exact command to produce/refresh it. Preconditions MUST exit with a non-zero status on failure. Preconditions MUST NOT attempt to produce the upstream artifact themselves.

When a tier has multiple upstream preconditions, the script SHALL check each precondition in turn and SHALL short-circuit at the first failure. The failure message SHALL name the first missing/stale artifact and its fix command. (A future Tier-3 amendment may require printing all violations; for now, short-circuit is acceptable.)

#### Scenario: Precondition message is actionable

- **WHEN** a precondition fails
- **THEN** stderr contains a line matching the shape "ERROR: <what's missing or stale>. Run: <exact command>"

#### Scenario: Precondition is the first executable line

- **WHEN** a maintainer inspects any atomic tier script
- **THEN** the precondition block appears before any command that does the tier's primary work

#### Scenario: NAPI precondition checks mtime freshness

- **WHEN** a tier's precondition checks for the NAPI binary
- **THEN** the check includes both file existence AND mtime comparison against `packages/extract/src/**/*.rs` newest source
- **AND** a stale binary surfaces the same error shape as a missing binary

### Requirement: Root CLAUDE.md Verification Tier Table

The root `CLAUDE.md` SHALL contain a single authoritative Verification Tier Table under a `## Verification Tiers` (or equivalent) heading. The table SHALL include, for every atomic tier and every composite orchestrator, the following columns: `Command`, `What it covers`, `Upstream requires`, `Fails loud when`, `Typical runtime`.

Per-package `CLAUDE.md` files (including but not limited to `packages/system/CLAUDE.md`, `packages/extract/CLAUDE.md`, `packages/vite-plugin/CLAUDE.md`, `packages/showcase/CLAUDE.md`) SHALL NOT duplicate the Verification Tier Table. They MUST link back to the root table for verification commands.

The root `CLAUDE.md` SHALL include a forward-pointer stating that per-package CLAUDE.md files contain domain-specific guidance that is NOT duplicated at root, encouraging agents to drill into the relevant `packages/<name>/CLAUDE.md` after consulting the root tier table.

#### Scenario: Agent looks up a tier

- **WHEN** an agent loads root `CLAUDE.md`
- **THEN** the Verification Tier Table lists every atomic tier and composite orchestrator
- **AND** for each entry, the agent can read its upstream dependency and fail-loud trigger without following external links

#### Scenario: Per-package file links back

- **WHEN** an agent reads `packages/system/CLAUDE.md`
- **THEN** any mention of verification commands links to the root table rather than listing duplicated commands

#### Scenario: Root file points forward

- **WHEN** an agent reads the root `CLAUDE.md`
- **THEN** a note directs the agent to per-package `CLAUDE.md` files for domain detail that is not at the root

### Requirement: Change-Type Map

The root `CLAUDE.md` SHALL contain a Change-Type Map: a table with the columns `You changed` (an edit-surface description, e.g., a path glob or behavior) and `Run` (the minimum verification-tier set to run for that change). The map MUST contain 11 canonical rows covering the primary edit surfaces of the repository, plus a sidebar note covering non-verify edit surfaces.

Rows SHALL be added when a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture) is introduced.

The initial 11 rows:

| You changed | Run |
|---|---|
| `packages/system/src/**` | `verify:compile && verify:types && verify:unit:ts` |
| `packages/extract/src/**/*.rs` | `verify:unit:rust && verify:canary && verify:integration` |
| `packages/extract/src/**/*.ts` (NAPI TS binding / pipeline) | `verify:canary && verify:integration` |
| `packages/vite-plugin/src/**` | `verify:compile && verify:integration && verify:showcase` |
| `packages/next-plugin/src/**` | `verify:compile && verify:next` |
| `packages/showcase/src/**` (code; MDX content excluded — see sidebar) | `verify:showcase` |
| `packages/properties/src/**` | `verify:compile && verify:unit:ts` |
| `packages/_integration/__tests__/**` | `verify:integration` |
| `packages/test-ds/src/**` | `verify:unit:ts && verify:next && verify:showcase` |
| `.github/workflows/ci.yaml`, `scripts/**`, `.tool-versions` | `verify:ci` |
| Broad refactor across multiple surfaces | `verify:full` |

Sidebar — **no verify tier required**: `openspec/**` (run `openspec validate` instead), MDX content under `packages/showcase/src/content/**`, root markdown (`CLAUDE.md`, `README.md`, `docs/**`).

The Change-Type Map SHALL be the authoritative instructability surface for agents selecting minimum verification for a narrow change.

#### Scenario: Agent selects verification set from the map

- **WHEN** an agent modifies only `packages/system/src/**`
- **AND** reads the Change-Type Map in root `CLAUDE.md`
- **THEN** the agent runs `verify:compile && verify:types && verify:unit:ts`
- **AND** does not run unrelated tiers such as `verify:build:next`

#### Scenario: OpenSpec edit does not trigger verify

- **WHEN** an agent modifies only files under `openspec/`
- **AND** reads the Change-Type Map sidebar
- **THEN** the agent runs `openspec validate` only
- **AND** does not invoke any `verify:*` tier

#### Scenario: MDX content edit does not trigger verify

- **WHEN** an agent modifies only MDX files under `packages/showcase/src/content/**`
- **AND** reads the Change-Type Map sidebar
- **THEN** no `verify:*` tier is required

#### Scenario: New edit surface requires a map row

- **WHEN** a change introduces a new publishable package or a new top-level edit surface
- **THEN** the same change MUST add a corresponding row to the Change-Type Map

### Requirement: Per-Package Script Policy

Per-package `package.json` scripts SHALL remain as the implementation invoked by root orchestrators. Root orchestrators MAY invoke per-package scripts via `bun run --filter` or equivalent workspace dispatch. Per-package scripts MUST NOT be duplicated into the root as the primary interface — the Verification Tier Table is the primary interface.

Developers MAY invoke per-package scripts directly (`cd packages/X && bun run <script>`) when working inside a single package.

#### Scenario: Root orchestrator delegates to per-package script

- **WHEN** `verify:integration` runs
- **THEN** it invokes the per-package test script in `packages/_integration` via the workspace
- **AND** the implementation lives in `packages/_integration/package.json`, not duplicated at root

### Requirement: Bun Version Pin

A `.tool-versions` file SHALL exist at the repository root declaring the pinned bun version. The `.github/workflows/ci.yaml` file SHALL use `bun-version-file: .tool-versions` on every `oven-sh/setup-bun@v2` step. Bun version upgrades are explicit single-file edits to `.tool-versions`.

If other tooling configuration pins a bun version (for example, `netlify.toml` `BUN_VERSION`), that configuration SHALL be updated in the same change that edits `.tool-versions`, keeping all pin surfaces in sync.

#### Scenario: CI consumes pinned bun version

- **WHEN** a CI workflow step uses `oven-sh/setup-bun@v2`
- **THEN** it specifies `bun-version-file: .tool-versions`
- **AND** the installed bun version matches the content of `.tool-versions`

#### Scenario: Local bun version manager respects pin

- **WHEN** a developer uses `asdf`, `mise`, `proto`, or another `.tool-versions`-aware version manager
- **AND** runs a command inside the repository
- **THEN** the active bun version matches the content of `.tool-versions`

#### Scenario: Version upgrade is a scoped edit

- **WHEN** a developer upgrades bun
- **THEN** the change edits `.tool-versions` AND any other pin surface (e.g., `netlify.toml` `BUN_VERSION`) atomically
- **AND** no CI workflow modifications are required

### Requirement: verify:ci CI-Simulation Semantics

`verify:ci` SHALL reproduce the CI workflow's job set and execution order locally on a best-effort basis. It MUST run the same command sequence as CI jobs `lint`, `test-rust`, `build-extract`, and `verify` (in that order). It MUST invoke `bun run build:extract` and `bun run build:ts` inline (CI materializes these artifacts before verify). It MUST include `verify:integration` and `verify:build:showcase` + `verify:assert:showcase` (CI runs both).

It MUST NOT attempt runner-OS parity, matrix-target multiplicity (CI builds 3 platform binaries; local builds 1), or release-gated steps.

If CI workflow ordering or coverage changes, `verify:ci` MUST be updated in the same change that modifies `ci.yaml`.

#### Scenario: CI ordering matches locally

- **WHEN** a developer runs `verify:ci`
- **THEN** lint runs first, then Rust unit tests, then `bun run build:extract`, then `bun run build:ts`, then the verify-equivalent tiers including integration and showcase assert

#### Scenario: CI workflow edit keeps verify:ci in sync

- **WHEN** a change modifies `.github/workflows/ci.yaml` job ordering or commands
- **THEN** the same change modifies the `verify:ci` script to match
