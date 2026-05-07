# verification-tier-policy Specification

## Purpose

TBD - created by archiving change verification-tier-policy. Update Purpose after archive.
## Requirements
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

The atomic tiers defined by this policy are: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`, `verify:hygiene:rust`.

Atomic tier preconditions SHALL be derived from the actual script each tier invokes (what the tier reads at runtime), not from generic "TS built" assumptions. In particular:

- `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:hygiene:rust` have **no upstream artifact preconditions** — they operate on source. `verify:hygiene:rust` additionally requires the `cargo-machete` binary to be installed on PATH; this is a tool precondition, not an artifact precondition, and fails loud via `require_cargo_machete`.
- `verify:unit:ts` operates on source via `bun test`'s on-the-fly transpilation — no `dist/` precondition.
- `verify:canary` requires only a fresh NAPI binary; it does NOT require `packages/extract/dist/` or any other package's `dist/`.
- `verify:integration` requires a fresh NAPI binary AND a fresh `packages/extract/dist/index.mjs` (mtime newer than `packages/extract/src/**`) AND a fresh `packages/system/dist/` (mtime newer than `packages/system/src/**`) — `@animus-ui/extract/pipeline` and `@animus-ui/system` are both resolved via dist at test time.
- `verify:build:next` requires a fresh NAPI binary AND fresh `packages/extract/dist/` AND fresh `packages/system/dist/` AND fresh `packages/next-plugin/dist/` (each mtime newer than its own package's `src/**`). The bundler invokes the Next plugin at build time and consumer code resolves `@animus-ui/system` through dist.
- `verify:build:showcase` requires a fresh NAPI binary AND fresh `packages/extract/dist/` AND fresh `packages/system/dist/` AND fresh `packages/vite-plugin/dist/` AND fresh `packages/properties/dist/` (each mtime newer than its own package's `src/**`). The showcase resolves all four packages through dist.
- `verify:assert:next` requires `e2e/next-app/.next/` build output.
- `verify:assert:showcase` requires `packages/showcase/dist/` build output.

For any tier that consumes a package's `dist/` at runtime, the precondition SHALL check BOTH existence AND freshness (mtime comparison against that package's `src/**`). An existence-only check that accepts a stale dist SHALL be treated as incorrect — it will silently pass tiers against outdated types or code.

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

#### Scenario: Stale consumer-facing package dist surfaces as precondition failure

- **WHEN** a developer runs `verify:build:next` with `packages/system/dist/index.d.ts` older than `packages/system/src/**` source files
- **THEN** the script exits 1
- **AND** stderr identifies `packages/system/dist/` as stale and includes the command `bun run --filter '@animus-ui/system' build:ts`
- **AND** the Next build does NOT run against the stale dist

#### Scenario: Multi-dependency staleness check short-circuits on first failure

- **WHEN** a developer runs `verify:build:showcase` with BOTH `packages/system/dist/` and `packages/vite-plugin/dist/` stale
- **THEN** the script exits 1 at the first stale-dist check it encounters
- **AND** stderr identifies the first-detected stale package (either one, but only one)
- **AND** the showcase build does NOT run

#### Scenario: Missing cargo-machete binary surfaces as tool precondition failure

- **WHEN** a developer runs `verify:hygiene:rust` with no `cargo-machete` binary on PATH
- **THEN** the script exits 1
- **AND** stderr includes the exact message "ERROR: cargo-machete missing. Run: cargo install cargo-machete"

#### Scenario: Hygiene tier does not require any built artifact

- **WHEN** a developer runs `verify:hygiene:rust` with no NAPI binary and no package `dist/` directories present
- **AND** `cargo-machete` is installed
- **THEN** the tier runs to completion (source + Cargo.toml is all it reads)
- **AND** no build of any kind is triggered

### Requirement: Dist Freshness Precondition Pattern

Any atomic tier whose precondition depends on a downstream package's `dist/` directory SHALL check BOTH existence AND freshness using the same shell pattern established by the NAPI binary check: `ls` (or equivalent) for existence, and `find <src-dir> -newer <key-dist-artifact> -print -quit` for freshness. If either check fails, the precondition SHALL emit an `ERROR: <dist> missing/stale. Run: <fix-command>` message to stderr and exit non-zero.

The `<key-dist-artifact>` for each TS package SHALL be resolved by probing `packages/<pkg>/dist/index.mjs` then `packages/<pkg>/dist/index.js` in order, taking the first file that exists. Both are valid published ESM entries — tsdown emits `.mjs` for some workspace packages (e.g., extract, vite-plugin, next-plugin) and `.js` for packages whose `package.json` declares `"type": "module"` (e.g., system, properties). If neither file exists, the dist SHALL be reported as missing. The `<src-dir>` for a TS package SHALL be `packages/<pkg>/src/**` matched against TypeScript source files (`*.ts`, `*.tsx`). For `packages/extract`, `<src-dir>` additionally covers `*.rs` files for the NAPI binary check.

The `<fix-command>` SHALL be the canonical rebuild command for that package. For the NAPI binary: `bun run build:extract`. For a TS package `<pkg>`: `bun run --filter '@animus-ui/<pkg>' build:ts`.

#### Scenario: Fresh-dist check fires on stale consumer dist

- **WHEN** a tier precondition invokes the fresh-dist check for `packages/system`
- **AND** `packages/system/src/types/config.ts` mtime is newer than the resolved key artifact (`packages/system/dist/index.js` per `system`'s current emission)
- **THEN** the check exits 1 with message "ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts"

#### Scenario: Fresh-dist check passes when dist is fresh

- **WHEN** a tier precondition invokes the fresh-dist check for `packages/system`
- **AND** the resolved key artifact (`packages/system/dist/index.js` per `system`'s current emission) mtime is newer than every file under `packages/system/src/**`
- **THEN** the check returns success and the tier's primary work proceeds

#### Scenario: Fresh-dist check fires on missing dist

- **WHEN** a tier precondition invokes the fresh-dist check for `packages/system`
- **AND** `packages/system/dist/` does not exist (or neither `packages/system/dist/index.mjs` nor `packages/system/dist/index.js` is present)
- **THEN** the check exits 1 with message "ERROR: packages/system/dist/ missing. Run: bun run --filter '@animus-ui/system' build:ts"

### Requirement: Shared Precondition Helper Library

A shared shell helper SHALL exist at `scripts/verify/_preconditions.sh` and SHALL be the single authoritative implementation of all atomic-tier precondition checks. Every atomic tier script SHALL source this helper and invoke named helper functions rather than inline precondition logic. Duplication of precondition logic across atomic tier scripts SHALL NOT exist once this helper is in place.

The helper SHALL export at minimum these composable shell functions:

- `require_bun_install` — checks that the canonical type-check implementation binary exists at `node_modules/.bin/<binary>`, where `<binary>` is the binary designated by the `typescript-toolchain` capability's "Type-Check Implementation Selection" requirement; on failure emits `ERROR: <binary> not found at node_modules/.bin/<binary>. Run: bun install` and exits 1. The helper SHALL NOT hard-code a specific binary name; the probe target SHALL be derived from a single source-of-truth (a shell variable defined at the top of the helper, sourced from `package.json` introspection, or equivalent).
- `require_fresh_napi` — checks `packages/extract/*.node` existence AND mtime newer than every `packages/extract/src/**/*.rs` source file; on failure emits the appropriate missing/stale message with fix command `bun run build:extract`.
- `require_fresh_package_dist <pkg>` — checks the key dist artifact existence AND mtime freshness for the named workspace package; on failure emits the appropriate missing/stale message with fix command `bun run --filter '@animus-ui/<pkg>' build:ts`.
- `require_dir <path> <fix_command>` — checks that `<path>` exists; on failure emits `ERROR: <path> missing. Run: <fix_command>` and exits 1.

All helper functions SHALL emit errors to stderr and return exit code 1 on failure. The helper SHALL be sourced (not spawned as a subprocess) so the calling tier script inherits exit semantics. The helper SHALL have `set -euo pipefail`-compatible behavior — i.e., not rely on side effects that the caller's strict-mode settings would prevent.

When this Requirement is implemented, the following existing tier scripts MUST be rewritten to call helper functions instead of containing inline precondition logic: `scripts/verify/canary.sh`, `scripts/verify/integration.sh`, `scripts/verify/build-next.sh`, `scripts/verify/build-showcase.sh`, `scripts/verify/assert-next.sh`, `scripts/verify/assert-showcase.sh`, `scripts/verify/compile.sh`, `scripts/verify/types.sh`. Source-only tier scripts (`verify:lint`, `verify:unit:rust`, `verify:unit:ts`) MAY source the helper for consistency even if they currently require no precondition calls.

#### Scenario: Tier script sources the helper

- **WHEN** a maintainer inspects any atomic tier script under `scripts/verify/`
- **THEN** the script includes `source "$ROOT/scripts/verify/_preconditions.sh"` near the top
- **AND** all precondition logic is expressed as `require_*` function calls
- **AND** no inline `ls packages/extract/*.node` / `find -newer` patterns appear in the tier script itself

#### Scenario: Helper is the one authoritative implementation

- **WHEN** a maintainer greps `scripts/verify/*.sh` for inline `find -newer` patterns
- **THEN** matches appear only within `scripts/verify/_preconditions.sh` — never in an individual tier script
- **AND** editing the staleness-check logic requires updating exactly one file

#### Scenario: Helper function emits actionable error message

- **WHEN** `require_fresh_package_dist system` is called and `packages/system/dist/` is stale
- **THEN** stderr contains a line matching `ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts`
- **AND** the calling script exits with status 1

#### Scenario: Helper handles NAPI package specialization

- **WHEN** `require_fresh_napi` is invoked and the NAPI binary is stale relative to Rust source
- **THEN** the emitted error message uses the command `bun run build:extract` (not `bun run --filter '@animus-ui/extract' build:ts`)
- **AND** the script exits with status 1

#### Scenario: require_bun_install probes the canonical type-check binary

- **WHEN** `require_bun_install` is invoked
- **THEN** the probe target is the canonical type-check implementation binary designated by the `typescript-toolchain` capability — not hard-coded to `tsc`
- **AND** if the canonical type-check implementation changes, the helper's probe target updates in lockstep with the `typescript-toolchain` capability change
- **AND** the error message names the actual binary missing (e.g., `tsgo` when `tsgo` is canonical), not a stale prior name

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

The root `CLAUDE.md` SHALL contain a Change-Type Map: a table with the columns `You changed` (an edit-surface description, e.g., a path glob or behavior) and `Run` (the minimum verification-tier set to run for that change). The map MUST contain 12 canonical rows covering the primary edit surfaces of the repository, plus a sidebar note covering non-verify edit surfaces.

Rows SHALL be added when a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture) is introduced.

The canonical rows:

| You changed                                                           | Run                                                       |
| --------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/system/src/**`                                              | `verify:compile && verify:types && verify:unit:ts`        |
| `packages/extract/src/**/*.rs`                                        | `verify:unit:rust && verify:canary && verify:integration` |
| `packages/extract/src/**/*.ts` (NAPI TS binding / pipeline)           | `verify:canary && verify:integration`                     |
| `packages/extract/Cargo.toml`                                         | `verify:hygiene:rust`                                     |
| `packages/vite-plugin/src/**`                                         | `verify:compile && verify:integration && verify:showcase` |
| `packages/next-plugin/src/**`                                         | `verify:compile && verify:next`                           |
| `packages/showcase/src/**` (code; MDX content excluded — see sidebar) | `verify:showcase`                                         |
| `packages/properties/src/**`                                          | `verify:compile && verify:unit:ts`                        |
| `packages/_integration/__tests__/**`                                  | `verify:integration`                                      |
| `packages/test-ds/src/**`                                             | `verify:unit:ts && verify:next && verify:showcase`        |
| `.github/workflows/ci.yaml`, `scripts/**`, `.tool-versions`           | `verify:ci`                                               |
| Broad refactor across multiple surfaces                               | `verify:full`                                             |

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

#### Scenario: Cargo.toml edit triggers hygiene tier

- **WHEN** an agent modifies only `packages/extract/Cargo.toml`
- **AND** reads the Change-Type Map
- **THEN** the agent runs `verify:hygiene:rust`
- **AND** does not need to run other tiers unless `.rs` sources also changed

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

`verify:ci` SHALL reproduce the CI workflow's job set and execution order locally on a best-effort basis. It MUST run the same command sequence as CI jobs `lint`, `test-rust`, `hygiene-rust`, `build-extract`, and `verify` (in that order). It MUST invoke `bun run build:extract` and `bun run build:ts` inline (CI materializes these artifacts before verify). It MUST include `verify:integration` and `verify:build:showcase` + `verify:assert:showcase` (CI runs both).

It MUST NOT attempt runner-OS parity, matrix-target multiplicity (CI builds 3 platform binaries; local builds 1), or release-gated steps.

If CI workflow ordering or coverage changes, `verify:ci` MUST be updated in the same change that modifies `ci.yaml`.

#### Scenario: CI ordering matches locally

- **WHEN** a developer runs `verify:ci`
- **THEN** lint runs first, then Rust unit tests, then Rust hygiene, then `bun run build:extract`, then `bun run build:ts`, then the verify-equivalent tiers including integration and showcase assert

#### Scenario: CI workflow edit keeps verify:ci in sync

- **WHEN** a change modifies `.github/workflows/ci.yaml` job ordering or commands
- **THEN** the same change modifies the `verify:ci` script to match

#### Scenario: hygiene-rust parallel in CI maps to sequential locally

- **WHEN** a developer runs `verify:ci`
- **THEN** `verify:hygiene:rust` executes sequentially (local parallelism is not a requirement)
- **AND** a machete failure surfaces before the build-extract step runs

### Requirement: Rust Dependency Hygiene Capability

The `verify:hygiene:rust` atomic tier SHALL invoke `cargo-machete` against `packages/extract` and SHALL exit with a non-zero status if `cargo-machete` reports any unused dependency. The tier SHALL invoke the detection pass only; `cargo machete --fix` SHALL NOT be invoked by any `verify:*` tier or composite orchestrator.

The tier SHALL expose `cargo-machete`'s native suppression surface — the `[package.metadata.cargo-machete]` section in `packages/extract/Cargo.toml` with its `ignored = [...]` list — as the mechanism available for declaring false-positive suppressions. The specific contents of `ignored` (which crates are listed, what annotations accompany them) SHALL be determined by a separate policy change and are NOT specified by this capability.

CI SHALL expose the tier as a standalone job parallel with the existing Rust jobs. The specific install mechanism for `cargo-machete` in CI (prebuilt-binary action, compile-from-source, cache warmup) is an implementation detail.

#### Scenario: Unused dependency fails the tier

- **WHEN** a contributor adds `foo = "1.0"` to `[dependencies]` in `packages/extract/Cargo.toml`
- **AND** no `use foo` or equivalent reference appears in `packages/extract/src/**`
- **AND** `verify:hygiene:rust` runs
- **THEN** the tier exits with status 1
- **AND** stderr identifies `foo` as unused

#### Scenario: Legitimately used dependency passes the tier

- **WHEN** every dependency in `[dependencies]` and `[build-dependencies]` is referenced in source (directly or via a `[package.metadata.cargo-machete].ignored` entry)
- **AND** `verify:hygiene:rust` runs
- **THEN** the tier exits with status 0
- **AND** no output indicates any issue

#### Scenario: Suppression mechanism is available

- **WHEN** a maintainer needs to suppress a false-positive finding on a specific crate
- **THEN** they add the crate name to the `[package.metadata.cargo-machete].ignored` list in `packages/extract/Cargo.toml`
- **AND** the tier re-run ceases to flag that crate

#### Scenario: CI job runs in parallel with test-rust

- **WHEN** a PR triggers the CI workflow
- **THEN** the `hygiene-rust` job runs in parallel with the `test-rust` job
- **AND** both share the `dtolnay/rust-toolchain@stable` + `Swatinem/rust-cache@v2` setup pattern
- **AND** `cargo-machete` is available on the job's PATH before the tier is invoked (e.g., via `taiki-e/install-action@v2` with a pinned tool version, or equivalent)

#### Scenario: Auto-fix is not invoked by any verify tier

- **WHEN** any composite orchestrator (`verify`, `verify:full`, `verify:ci`) runs
- **THEN** the hygiene tier runs without `--fix`
- **AND** no Cargo.toml edit occurs as a side effect of verification

### Requirement: Binding to orchestration-architecture

The atomic-tier contract, composite orchestrators, shared precondition helper, Change-Type Map, and CI-simulation semantics defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun run` to invoke `bash scripts/verify/<tier>.sh` per atomic tier. A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve every behavioral requirement in this spec — atomic-tier isolation, loud-fail precondition shape, the `_preconditions.sh` semantics, the Change-Type Map's authoritativeness, the dist-staleness check pattern — while updating only the invocation surface.

The shell helper at `scripts/verify/_preconditions.sh` SHALL remain in place under any orchestrator binding until and unless an orchestrator-native hook demonstrably preserves every check defined therein with identical semantics. If no native equivalent exists, the orchestrator's task body for any precondition-bearing tier SHALL invoke the existing shell script (e.g., `bash scripts/verify/canary.sh`).

#### Scenario: Atomic-tier loud-fail contract survives orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **AND** an atomic tier (e.g., `verify:canary`) is invoked under the new binding
- **AND** an upstream artifact (e.g., the NAPI binary) is missing or stale
- **THEN** the binding emits a stderr line matching `ERROR: <what's missing or stale>. Run: <exact command>`
- **AND** exits non-zero
- **AND** does NOT trigger an upstream rebuild

#### Scenario: Change-Type Map remains authoritative after rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **THEN** the Change-Type Map in root `CLAUDE.md` is updated in the SAME change to reflect the new invocation surface
- **AND** the map continues to be the authoritative agent-facing instructability surface for selecting minimum-tier sets

### Requirement: Linter and Formatter Decoupled from Type-Checker

The `verify:lint`, `verify:compile`, and `verify:types` atomic tiers SHALL remain invokable as separate, independently isolatable units. Unified CLI commands that conflate linting, formatting, and type-checking into a single invocation (for example, a single `check` command that runs all three) SHALL NOT replace the granular atomic tiers.

When a tool's CLI offers both unified and granular subcommands, the granular subcommands SHALL be used so each tier preserves its own loud-fail isolation contract per the `Atomic Tier Isolation` requirement. The `verify:lint` tier body SHALL invoke only the linter and formatter — typecheck logic SHALL NOT execute as part of `verify:lint`. The `verify:compile` and `verify:types` tier bodies SHALL each invoke their own dedicated entry points without sharing a unified-command surface with `verify:lint`.

This invariant exists because the `Atomic Tier Isolation` requirement mandates that each tier's failure surface is distinct. Bundling lint + fmt + typecheck into one command would force a tier failure to be reported at the unified-command level, losing the precise tier identification that the Change-Type Map and CI logs depend on. Maintainers consulting CI failure logs SHALL be able to identify the failing tier by name (`verify:lint`, `verify:compile`, or `verify:types`) without parsing the output of a unified command.

This invariant is orchestrator-agnostic. It applies regardless of whether the underlying linter is biome, oxlint, or a future tool; regardless of whether the orchestrator is bun, Vite+, or a future binding. Any tool's unified-CLI surface (e.g., Vite+'s `vp check` which combines `vp lint`, `vp fmt --check`, and a typecheck pass into one invocation) SHALL be rejected as a tier binding in favor of the tool's granular subcommands.

#### Scenario: Linter is invoked as its own tier

- **WHEN** the canonical linter binding offers both a unified command (e.g., `vp check`) and granular subcommands (e.g., `vp lint`, `vp fmt`)
- **AND** `verify:lint` is invoked
- **THEN** the tier body invokes only the linter and formatter subcommands — not the typecheck pass
- **AND** `verify:compile` and `verify:types` are NOT invoked as a side effect

#### Scenario: Tier failure is identifiable from CI logs

- **WHEN** a linter rule violation surfaces in CI
- **AND** the developer or agent inspects CI logs to identify the failing tier
- **THEN** the failing job step is named `verify:lint` (or its canonical alias under the active orchestrator)
- **AND** the failure is NOT attributed to a unified command name (e.g., `vp check`) that would mask which underlying tier failed

#### Scenario: Linter failure does not block typecheck reporting

- **WHEN** `verify:lint` fails because of a lint rule violation
- **AND** `verify:compile` is subsequently invoked (independently or as part of a composite orchestrator)
- **THEN** `verify:compile` runs and reports its own pass/fail status against the typecheck implementation
- **AND** the typecheck failure surface (if any) is reported separately from the lint failure surface

#### Scenario: Formatter check failure is independent of linter pass

- **WHEN** `verify:lint` task body invokes a linter subcommand followed by a formatter check subcommand (e.g., `vp lint && vp fmt --check`)
- **AND** the linter subcommand passes but the formatter check subcommand fails
- **THEN** the tier exits non-zero with the formatter's failure message visible
- **AND** the failure is attributable to the formatter, not the linter

### Requirement: Orchestrator Binding via Vite+ vp run

The atomic tiers, composite orchestrators, shared precondition helper, Change-Type Map, and CI-simulation semantics defined in this spec are dispatched through Vite+ (`vp` CLI). The canonical orchestrator-dispatch surface SHALL be `vp run <tier>` for every atomic tier and composite orchestrator. Migrated tier names SHALL be defined ONLY in `vite.config.ts` `run.tasks` and SHALL NOT have a corresponding `package.json` `scripts` entry — `vp run X` is the only invocation path for migrated tasks; `bun run <migrated-name>` returns "script not found" by design (hard cutover).

Composite orchestrators SHALL declare their atomic dependencies via `dependsOn` arrays in their `vite.config.ts` task definitions; vp executes upstream tasks before the requested composite per its documented `dependsOn` semantics. Atomic tasks SHALL NOT use `dependsOn` — they declare a `command` of `bash scripts/verify/<tier>.sh` and rely on the shell script's `_preconditions.sh` `require_*` calls to fail loud on missing/stale upstream artifacts. This split preserves the "atomic tier never silently rebuilds" invariant: vp's `dependsOn` auto-execution is intentionally NOT used where it would conflict with the fail-loud contract.

The shell helper at `scripts/verify/_preconditions.sh` SHALL remain the single authoritative implementation of every atomic-tier precondition. Vite+ task definitions in `vite.config.ts` SHALL invoke `bash scripts/verify/<tier>.sh` as the task body for every precondition-bearing tier — the precondition logic is NOT reimplemented in vp-native config. The loud-fail message shape (`ERROR: <missing or stale>. Run: <command>`), non-zero exit semantics, and atomic-tier isolation contracts (no silent upstream rebuilds) are preserved verbatim under the new dispatch surface.

A future rebind to a different orchestrator SHALL preserve every behavioral requirement in this spec while updating only the invocation surface — the same constraint that applies to the `bun run` → `vp run` rebind documented here.

#### Scenario: vp run dispatches atomic tier via shell script body

- **WHEN** a developer runs `vp run verify:canary` at the repository root
- **THEN** vp invokes `bash scripts/verify/canary.sh` as the task body
- **AND** the script's stderr and exit code are propagated unchanged to vp's stderr and exit code

#### Scenario: bun run for migrated name fails after cutover

- **WHEN** a developer runs `bun run verify` at the repository root post-migration
- **AND** `verify` is defined ONLY in `vite.config.ts` `run.tasks` (not in `package.json` `scripts`)
- **THEN** bun emits its standard "script not found" error and exits non-zero
- **AND** the canonical invocation path remains `vp run verify`

#### Scenario: bun run for unmigrated name keeps working

- **WHEN** a developer runs `bun run check` (or any unmigrated entry such as `clean:light`, `dev:showcase`, `test`, `release`)
- **THEN** bun executes the corresponding `package.json` `scripts` entry normally
- **AND** the unmigrated invocation surface is unchanged by this migration

#### Scenario: Loud-fail message shape survives vp dispatch

- **WHEN** a developer runs `vp run verify:canary` with no `packages/extract/*.node` file present
- **THEN** the wrapped `bash scripts/verify/canary.sh` invokes `require_fresh_napi`
- **AND** vp's stderr contains the exact line `ERROR: NAPI binary missing. Run: vp run build:extract`
- **AND** vp exits with status 1
- **AND** vp does NOT trigger any rebuild

#### Scenario: Atomic-tier isolation survives vp dispatch

- **WHEN** a developer runs `vp run verify:integration` with `packages/extract/dist/` missing
- **THEN** vp's wrapped tier script exits with the precondition failure naming `bun run --filter '@animus-ui/extract' build:ts`
- **AND** vp does NOT invoke the upstream build
- **AND** the integration test does NOT run

#### Scenario: \_preconditions.sh remains the authoritative implementation

- **WHEN** a maintainer greps `vite.config.ts` for inline precondition logic (mtime checks, dist freshness probes, helper-function definitions)
- **THEN** no such logic appears in `vite.config.ts`
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

