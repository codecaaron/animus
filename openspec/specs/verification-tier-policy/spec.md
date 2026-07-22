# verification-tier-policy Specification

## Purpose

TBD - created by archiving change verification-tier-policy. Update Purpose after archive.
## Requirements
### Requirement: Tier Naming Convention

The repository's root diagnostic commands SHALL follow a colon-separated `verify:<concern>[:<scope>]` convention, while package-owned complete claims SHALL be named `verify` and addressed through `@package#verify` syntax.

The public repository composites MUST be `verify` for the fast gate and `verify:full` for the complete local/current-host claim. Diagnostic commands MAY retain scoped names when the scope identifies a distinct evidence primitive.

Every documented workspace filter MUST pass `--fail-if-no-match`. The mandatory owner-graph contract MUST discover the supported consumer set from workspace directories and MUST fail when any discovered owner lacks its complete `verify` claim.

#### Scenario: Atomic diagnostic invocation

- **WHEN** a developer runs `vp run verify:unit:rust`
- **THEN** only Rust unit tests execute
- **AND** no TypeScript or application build work executes

#### Scenario: Package claim invocation

- **WHEN** a developer runs `vp run @animus-ui/vinext-app#verify`
- **THEN** Vite+ resolves `verify` in the Vinext package
- **AND** output identifies the package-qualified task

#### Scenario: Public composite discovery

- **WHEN** a contributor reads the primary verification guide
- **THEN** `verify`, `verify:full`, and package-target `verify` appear as the ordinary workflows
- **AND** diagnostic phase commands appear separately from the ordinary workflows

#### Scenario: Mistyped filter fails closed

- **WHEN** a canonical dependent or directory filter selects zero packages
- **THEN** Vite+ exits non-zero due to `--fail-if-no-match`

#### Scenario: Partially missing owner fails the fast gate

- **WHEN** one supported consumer manifest loses its `verify` script while other selected owners retain it
- **THEN** the owner-graph contract fails in `verify:unit:ts` with the missing owner name

### Requirement: Atomic Tier Isolation

Every atomic diagnostic SHALL execute one concern in isolation and MUST NOT silently trigger an upstream build. A diagnostic with artifact prerequisites SHALL exit non-zero with a human-readable instruction naming the missing or stale artifact and the exact command that produces it.

Root atomic diagnostics include lint, compile, type-contract, TypeScript unit, Rust unit, Clippy, Rust dependency hygiene, NAPI canary, parity, integration, Worker contracts, and packed-consumer verification. Consumer packages expose build, built-output assertion, and Worker dry-run diagnostics alongside their complete `verify` claim.

#### Scenario: Assertion invoked without output

- **WHEN** a developer invokes a consumer's built-output assertion without its production output
- **THEN** the assertion exits non-zero and identifies the package-qualified build command
- **AND** it does not build the application

#### Scenario: Complete claim prepares output

- **WHEN** a developer invokes the same consumer's complete package-owned `verify`
- **THEN** the preflighted owner build runs before the assertion
- **AND** the complete claim continues to dry-run validation only after the assertion succeeds

### Requirement: Dist Freshness Precondition Pattern

Any atomic diagnostic whose precondition depends on a downstream package's `dist/` directory SHALL check both existence and freshness through the shared precondition helper. Existence SHALL be determined from the package's emitted entry artifacts, and freshness SHALL compare TypeScript sources under the package's `src/` directory against the first emitted entry found in the canonical probe order.

The key dist artifact SHALL be resolved by probing `dist/index.mjs`, `dist/index.cjs`, and `dist/index.js` in that order and taking the first file that exists. If none exists, the dist SHALL be reported as missing. Freshness SHALL compare `*.ts` and `*.tsx` sources under the package's `src/` directory against that artifact.

The package-dist remediation command SHALL be `bun run --filter '<actual package name>' build:ts`, where the actual package name is read from that workspace's `package.json`. The NAPI remediation command SHALL be `vp run build:extract-v2`.

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
- **AND** `packages/system/dist/` does not exist or none of `packages/system/dist/index.mjs`, `packages/system/dist/index.cjs`, and `packages/system/dist/index.js` is present
- **THEN** the check exits 1 with message "ERROR: packages/system/dist/ missing. Run: bun run --filter '@animus-ui/system' build:ts"

### Requirement: Shared Precondition Helper Library

A shared shell helper SHALL exist at `scripts/verify/_preconditions.sh` as the authoritative implementation of retained verification precondition checks. Precondition-bearing diagnostics and consumer helpers SHALL source it and invoke named helper functions rather than duplicating inline freshness or existence logic.

The helper SHALL export at minimum these composable shell functions:

- `require_bun_install` — checks the canonical type-check binary selected by the `typescript-toolchain` capability and emits an actionable `bun install` remediation when it is missing.
- `require_fresh_napi_v2` — checks the v2 NAPI binary's existence and freshness against the v2 extractor and shared system-loader inputs and emits `vp run build:extract-v2` as the remediation.
- `require_fresh_package_dist <pkg-or-path>` — resolves the workspace manifest, reads its actual package name, probes `index.mjs`, `index.cjs`, then `index.js`, and emits `bun run --filter '<actual package name>' build:ts` when the dist is missing or stale.
- `require_dir <path> <fix-command>` — checks that `<path>` exists and emits the supplied remediation when it is missing.

All helper functions SHALL emit errors to stderr and return exit code 1 on failure. The helper SHALL be sourced so callers inherit its exit semantics, and it SHALL remain compatible with callers using `set -euo pipefail`.

The retained root diagnostics `scripts/verify/canary.sh`, `scripts/verify/integration.sh`, `scripts/verify/compile.sh`, and `scripts/verify/types.sh` MUST source the shared helper for their preconditions. The generic consumer helpers `scripts/verify/build-consumer.sh` and `scripts/verify/assert-consumer.sh` MUST source the same helper for owner preflight and assertion-output checks. Deleted per-target build and assertion wrappers SHALL NOT be part of the required helper-consumer inventory.

#### Scenario: Precondition-bearing scripts source the helper

- **WHEN** a maintainer inspects `canary.sh`, `integration.sh`, `compile.sh`, `types.sh`, `build-consumer.sh`, and `assert-consumer.sh`
- **THEN** each script sources `scripts/verify/_preconditions.sh`
- **AND** its shared precondition logic is expressed through `require_*` function calls
- **AND** no duplicated NAPI or package-dist freshness probe appears inline in those scripts

#### Scenario: Helper is the one authoritative implementation

- **WHEN** a maintainer greps `scripts/verify/*.sh` for inline `find -newer` patterns
- **THEN** matches appear only within `scripts/verify/_preconditions.sh`, never in an individual diagnostic or consumer helper
- **AND** editing the shared staleness-check logic requires updating exactly one file

#### Scenario: Helper function emits actionable error message

- **WHEN** `require_fresh_package_dist system` is called and `packages/system/dist/` is stale
- **THEN** stderr contains a line matching `ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts`
- **AND** the calling script exits with status 1

#### Scenario: Helper handles NAPI package specialization

- **WHEN** `require_fresh_napi_v2` is invoked and the v2 NAPI binary is stale relative to its Rust inputs
- **THEN** the emitted error message uses `vp run build:extract-v2` rather than a TypeScript package-build command
- **AND** the script exits with status 1

#### Scenario: require_bun_install probes the canonical type-check binary

- **WHEN** `require_bun_install` is invoked
- **THEN** the probe target is the canonical type-check implementation binary designated by the `typescript-toolchain` capability, not hard-coded to `tsc`
- **AND** if the canonical type-check implementation changes, the helper's single probe target updates in lockstep
- **AND** the error message names the actual missing binary

### Requirement: Composite Orchestrators

The repository SHALL provide `verify` as the fast gate and `verify:full` as the complete local/current-host proof, while supported consumers provide package-owned `verify` claims.

- Root `verify` MUST compose lint, compile, type-contract, TypeScript unit, Rust unit, Clippy, NAPI canary, and Worker-contract evidence without building consumer applications.
- Root `verify:full` MUST execute the fast gate, all supported consumer package claims, parity, integration, Rust dependency hygiene, and packed-consumer verification.
- Root `verify:full` MUST state that it excludes GitHub runner/architecture matrices and release-byte publication proof.

#### Scenario: Fast gate remains fast

- **WHEN** a developer runs `vp run verify`
- **THEN** source and current-host fast-gate evidence executes
- **AND** no showcase, Next, Vite, Vinext, or React Router application build executes

#### Scenario: Complete local verification

- **WHEN** a developer runs `vp run verify:full`
- **THEN** the fast gate and every supported package-owned consumer claim execute
- **AND** parity, integration, Rust dependency hygiene, and packed-consumer evidence execute
- **AND** no output claims GitHub platform-matrix or published-byte certification

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

### Requirement: Root AGENTS.md Verification Interface

The root `AGENTS.md` SHALL present one authoritative verification interface with ordinary workflows, claim boundaries, and a separate diagnostic reference.

Per-package guidance MUST link to the root policy for repository-wide claims and MAY document package-specific failure recovery without duplicating the entire root reference. The root guide MUST NOT direct contributors to absent package guidance files.

#### Scenario: Contributor discovers ordinary verification

- **WHEN** a contributor reads root `AGENTS.md`
- **THEN** the guide presents the fast root gate, complete local gate, package-target verification, and dependent-filter verification before diagnostic leaves
- **AND** every shown command is copy-paste runnable

#### Scenario: Diagnostic recovery remains discoverable

- **WHEN** an atomic diagnostic fails with a missing or stale artifact
- **THEN** root guidance explains that direct diagnostics fail loud
- **AND** the failure message supplies the exact preparation command

### Requirement: Change-Type Map

The root `AGENTS.md` SHALL map edit surfaces to claim-oriented, copy-pasteable Vite+ commands rather than bare combinations of production phases.

The map MUST cover active publishable packages, extraction crates and pipeline code, consumer fixtures, Worker orchestration, packed/release surfaces, broad refactors, and the no-verification exceptions. A new top-level package or consumer MUST add or inherit an owner claim in the same change.

The map MUST preserve source-owned diagnostics in addition to downstream owner claims. In particular, a Vite plugin implementation change SHALL run compile and integration evidence before the fail-closed dependent-owner filter; a Next plugin implementation change SHALL run compile before the Next owner claim; and a test-ds implementation change SHALL run TypeScript unit evidence before its fail-closed dependent-owner filter.

#### Scenario: Package-local change

- **WHEN** a contributor changes only an owner package's direct implementation
- **THEN** the map provides one package-qualified verification command
- **AND** the contributor does not manually assemble build and assertion phases

#### Scenario: Shared plugin change

- **WHEN** a contributor changes `packages/vite-plugin/src/**`
- **THEN** the map provides a dependent-filter command rooted at `@animus-ui/vite-plugin`
- **AND** supported dependent consumers are selected from workspace relationships
- **AND** compile and integration diagnostics execute in addition to the downstream claims

#### Scenario: Policy-only edit

- **WHEN** a contributor changes only files under `openspec/**`
- **THEN** the map directs them to OpenSpec validation
- **AND** no runtime verification command is required

#### Scenario: MDX content edit does not trigger verify

- **WHEN** an agent modifies only MDX files under `packages/showcase/src/content/**`
- **AND** reads the Change-Type Map sidebar
- **THEN** no `verify:*` tier is required

#### Scenario: New edit surface requires a map row

- **WHEN** a change introduces a new publishable package or a new top-level edit surface
- **THEN** the same change MUST add a corresponding row to the Change-Type Map

### Requirement: Per-Package Script Policy

Per-package `package.json` scripts SHALL own framework-specific build, assertion, dry-run, and complete verification commands, while repository-wide evidence remains in root tasks.

Vite+ package targets and workspace filters MUST be the canonical invocation surface for package-owned claims. Root orchestration MUST NOT duplicate a consumer's framework command or output path in a parallel target-phase family.

#### Scenario: Root orchestrator delegates to per-package script

- **WHEN** `verify:integration` runs
- **THEN** it invokes the per-package test script in `packages/_integration` via the workspace
- **AND** the implementation lives in `packages/_integration/package.json`, not duplicated at root

#### Scenario: Consumer owns its claim

- **WHEN** a maintainer inspects a consumer package manifest
- **THEN** its production build, built-output assertion, optional Worker dry-run, and complete `verify` claim are discoverable together

#### Scenario: Root full delegates by package

- **WHEN** `verify:full` reaches consumer verification
- **THEN** it invokes package-owned `verify` claims through a workspace filter
- **AND** it does not enumerate separate root build/assert/dry-run tasks for each consumer

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

### Requirement: Strict Rust Lint Capability

The `verify:clippy` atomic tier SHALL run `cargo clippy --workspace --all-targets --all-features -- -D warnings` from each active Rust crate root and SHALL fail on every Rust or Clippy warning without invoking a fix mode.

The root `verify` and `verify:full` graphs MUST include `verify:clippy`. CI SHALL expose a standalone blocking Clippy job, and release SHALL remain blocked on that job.

#### Scenario: Warning fails strict Clippy

- **WHEN** active Rust source produces a compiler or Clippy warning
- **AND** a developer runs `vp run verify:clippy`
- **THEN** the tier exits non-zero with the crate, file, line, and lint visible

#### Scenario: Complete local and CI coverage

- **WHEN** root complete verification or CI runs
- **THEN** the shared system loader and v2 extraction receive strict Clippy coverage
- **AND** archived code under `legacy/**` is excluded

#### Scenario: CI and release block on Clippy

- **WHEN** a PR or release workflow runs
- **THEN** the standalone `clippy` job executes with the pinned Rust toolchain
- **AND** a release cannot start unless the `clippy` job succeeds

### Requirement: Rust Dependency Hygiene Capability

The `verify:hygiene:rust` diagnostic SHALL remain directly runnable and SHALL remain included in `verify:full`. Root `verify` and every package-owned `verify` claim SHALL exclude mutating hygiene and auto-fix operations.

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

#### Scenario: Complete proof includes dependency hygiene

- **WHEN** a developer runs `vp run verify:full`
- **THEN** Rust dependency hygiene executes without any auto-fix operation

#### Scenario: Ordinary focused claims do not mutate

- **WHEN** a developer runs root `verify` or a package-owned `verify`
- **THEN** no clean, hygiene-fix, formatter-fix, or linter-fix command executes

### Requirement: Binding to orchestration-architecture

The verification interface SHALL preserve atomic isolation, package-owned claims, workspace selection, shared fail-loud preconditions, claim-oriented change routing, and CI-specific environment ownership under the active orchestrator binding.

The shell helper at `scripts/verify/_preconditions.sh` MUST remain authoritative for retained root diagnostics until an executable replacement preserves every check. Consumer package assertions MUST retain equivalent missing-output and freshness behavior when their obsolete root wrappers are removed.

#### Scenario: Atomic loud-fail survives simplification

- **WHEN** a retained diagnostic runs with a missing or stale prerequisite
- **THEN** stderr identifies the prerequisite and exact preparation command
- **AND** the diagnostic exits non-zero without producing the prerequisite

#### Scenario: Owner routing survives package addition

- **WHEN** a supported consumer with a package-owned `verify` command and workspace dependencies is added
- **THEN** workspace-filtered complete verification reaches that consumer without adding a root target-phase family

#### Scenario: Change-Type Map remains authoritative after rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **THEN** the Change-Type Map in root `AGENTS.md` is updated in the SAME change to reflect the new invocation surface
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

Root diagnostics and composites SHALL be dispatched with `vp run <task>`, and package-owned claims SHALL be dispatched with `vp run @package#verify` or Vite+ workspace filters.

Root diagnostic tasks MUST remain defined in `vite.config.ts` when they need task dependencies, caching controls, or root-owned command bodies. Package-specific commands MUST remain in the owning package manifest when framework commands or output paths differ by application. Nested `vp run` commands MUST preserve flat task output and dependency ordering.

Atomic diagnostics MUST NOT declare build dependencies that would silently satisfy their own preconditions. Complete owner claims MAY invoke an owner build after shared prerequisites pass their fail-loud checks.

#### Scenario: Root diagnostic dispatch

- **WHEN** a developer runs `vp run verify:canary`
- **THEN** Vite+ invokes the root canary task and propagates its stderr and exit code

#### Scenario: Package claim dispatch

- **WHEN** a developer runs `vp run @animus-ui/react-router-app#verify`
- **THEN** Vite+ executes the package manifest's `verify` script
- **AND** nested tasks remain package-qualified in execution output

#### Scenario: Missing atomic prerequisite

- **WHEN** a developer invokes an assertion diagnostic without its output
- **THEN** Vite+ does not schedule the consumer build
- **AND** the assertion exits with its remediation command

#### Scenario: Active-change compatibility alias

- **WHEN** another active OpenSpec change still names a root diagnostic alias
- **THEN** simplification retains a narrow delegating alias until that change is rebased
- **AND** contributor guidance does not present the alias as an ordinary workflow

#### Scenario: bun run for migrated name fails after cutover

- **WHEN** a developer runs `bun run verify` at the repository root post-migration
- **AND** `verify` is defined ONLY in `vite.config.ts` `run.tasks` (not in `package.json` `scripts`)
- **THEN** bun emits its standard "script not found" error and exits non-zero
- **AND** the canonical invocation path remains `vp run verify`

#### Scenario: bun run for unmigrated name keeps working

- **WHEN** a developer runs `bun run check` (or any unmigrated entry such as `clean:light`, `dev:showcase`, `test`, `release`)
- **THEN** bun executes the corresponding `package.json` `scripts` entry normally
- **AND** the unmigrated invocation surface is unchanged by this migration

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

### Requirement: Parity Tier

The task graph SHALL provide a `verify:parity` atomic tier that runs fresh-process and thread-count v2 self-checks, the v2 seam battery, and committed production/development baseline comparison. It SHALL fail loud with a remediation message when the v2 binary, its Rust inputs, fixture corpus, or committed baselines are missing or stale, and ordinary execution SHALL exit non-zero on any baseline drift.

#### Scenario: Parity tier runs the committed oracle

- **WHEN** `vp run verify:parity` executes with a fresh v2 binary, fixtures, and both committed mode baselines present
- **THEN** the v2 self-checks, seam battery, and baseline comparisons run and the tier's exit code equals their combined verdict

#### Scenario: Missing or stale upstream fails loud

- **WHEN** `vp run verify:parity` executes and a required v2 artifact is missing or older than a Rust source or crate metadata input
- **THEN** the tier exits non-zero with a message naming the stale or missing artifact and the command that builds it, without rebuilding it silently

### Requirement: Parity Tier Change-Type Coverage

The root Change-Type Map SHALL map v2 engine and shared loader changes to tier sets that include `verify:parity`, and CI SHALL exercise the same standing parity tier after the v2 artifact is available.

#### Scenario: Map and CI cover the standing oracle

- **WHEN** the v2 engine or shared loader source changes
- **THEN** the authoritative minimum tier set includes `verify:parity` and CI runs the committed v2 oracle

### Requirement: Packed Consumer Tier

The repository SHALL provide `vp run verify:packed` as an atomic tier that packs the publishable packages, lints the tarballs, installs them into an isolated non-workspace consumer, and runs that consumer's loading, type-check, build, and assertion checks. Its upstream preconditions are a fresh v2 NAPI binary, fresh `dist/` for all five publishable packages, and fresh `_assertions/dist/`; a missing precondition SHALL fail loud with an `ERROR: X missing. Run: Y` message and SHALL NOT trigger a rebuild.

#### Scenario: Missing upstream dist

- **WHEN** `vp run verify:packed` runs while a publishable package's `dist/` is absent or stale
- **THEN** the tier exits non-zero with an `ERROR: X missing. Run: Y` message naming the remediation command
- **AND** no upstream build is invoked

#### Scenario: Fresh upstream artifacts

- **WHEN** `vp run verify:packed` runs with all preconditions satisfied
- **THEN** the pack, lint, install, load, type-check, build, and assertion stages execute in order

### Requirement: Packed Tier Composite Membership

The `verify:full` composite SHALL include packed-consumer verification after required package and native artifacts are materialized.

#### Scenario: Complete local pipeline includes packed verification

- **WHEN** a developer runs `vp run verify:full`
- **THEN** `verify:packed` executes after its upstream artifact-producing claims

### Requirement: Packed Tier Change-Type Coverage

The root `AGENTS.md` Change-Type Map SHALL map packed-consumer fixture changes, packed-lane scripts, publishable manifests, and release-bundle orchestration to commands that include `verify:packed` or the complete local proof.

#### Scenario: Packed consumer fixture edited

- **WHEN** a contributor changes `e2e/packed-app/**`
- **THEN** the map directs them to run `vp run verify:packed`

#### Scenario: Publishable dependency edge edited

- **WHEN** a contributor changes an internal dependency or peer range in a publishable manifest
- **THEN** the map directs them to verification that includes the packed-consumer lane

### Requirement: Vinext focused verification

The Vinext package SHALL provide one complete focused `verify` claim plus independently runnable build, assertion, and credential-free Worker dry-run diagnostics.

#### Scenario: Run focused Vinext verification

- **WHEN** a developer runs `vp run @animus-ui/vinext-app#verify`
- **THEN** the preflighted production build runs before structural output assertions
- **AND** the Worker dry-run executes after assertions succeed

### Requirement: React Router focused verification

The React Router package SHALL provide one complete focused `verify` claim plus independently runnable build, assertion, and credential-free Worker dry-run diagnostics.

#### Scenario: Run focused React Router verification

- **WHEN** a developer runs `vp run @animus-ui/react-router-app#verify`
- **THEN** the preflighted production build runs before structural output assertions
- **AND** the Worker dry-run executes after assertions succeed

### Requirement: Worker deployment dry-run diagnostics

Showcase, Vite, Vinext, and React Router packages SHALL expose credential-free deployment dry-run diagnostics within their owner command surface.

#### Scenario: Run owner dry-run diagnostic

- **WHEN** a developer invokes one package's Worker dry-run after its production build
- **THEN** Wrangler validates that package's configured bundle and assets
- **AND** no remote state changes

### Requirement: Complete verification includes Worker canaries

The complete local verification graph SHALL reach showcase, Vite, Vinext, and React Router owner claims, including their Worker dry-runs, while the fast root graph remains free of application builds.

#### Scenario: Run complete verification

- **WHEN** a developer invokes `vp run verify:full`
- **THEN** all supported Worker consumer claims execute

#### Scenario: Run the fast gate

- **WHEN** a developer invokes `vp run verify`
- **THEN** no supported consumer application build executes

### Requirement: Package-owned consumer verification

Each supported consumer package SHALL expose one `verify` command addressable through Vite+ package-target syntax.

#### Scenario: Target one consumer

- **WHEN** a developer runs `vp run @animus-ui/vite-app#verify`
- **THEN** the Vite consumer's complete verification claim executes
- **AND** no other consumer application is built

#### Scenario: Verify plugin dependents

- **WHEN** a developer runs verification with a Vite+ dependent filter rooted at `@animus-ui/vite-plugin`
- **THEN** every supported workspace consumer that declares the plugin dependency executes its package-owned verification claim
- **AND** a consumer is included through its workspace dependency edge rather than a target list in the root composite

### Requirement: Complete consumer claims

A supported Worker consumer's package-owned `verify` command SHALL execute a fail-loud dependency preflight and production build, built-output assertions, and credential-free upload validation; the Next consumer SHALL execute its preflight/build and built-output assertions. Cross-consumer Worker contracts SHALL execute once in the root fast gate rather than once per owner claim.

The owner preflight MUST derive the consumer's transitive dist-bearing workspace dependency closure from package manifests. It MUST NOT accept or maintain an owner-specific dependency list. It SHALL report every missing or stale prerequisite found in one pass and end with one exact preparation recipe.

#### Scenario: Worker consumer verification

- **WHEN** a developer runs a supported Worker consumer's package-owned `verify`
- **THEN** missing or stale workspace dependencies fail with exact preparation commands before the consumer build
- **AND** output assertions run only after the production build succeeds
- **AND** Wrangler validates the produced upload without changing remote state

#### Scenario: Cross-consumer contracts are not duplicated

- **WHEN** root complete verification selects every package-owned consumer claim
- **THEN** the root fast gate executes the cross-consumer Worker contract suite once
- **AND** no individual consumer claim invokes that global suite again

#### Scenario: Manifest closure drives preflight

- **WHEN** a workspace dependency such as `@animus-ui/test-ds` is added to a supported consumer manifest
- **THEN** the owner preflight includes that package and its transitive dist-bearing workspace dependencies without editing a second registry
- **AND** a missing or stale dist is reported before the framework build starts

#### Scenario: Clean-checkout recovery is aggregated

- **WHEN** both native engines and multiple workspace dists are missing or stale
- **THEN** the owner preflight reports all detected prerequisites in one run
- **AND** stderr ends with one copy-pasteable ordered preparation recipe

#### Scenario: Next consumer verification

- **WHEN** a developer runs `vp run @animus-ui/next-app#verify`
- **THEN** missing or stale workspace dependencies fail before the Next production build
- **AND** the Next production application builds when prerequisites are fresh
- **AND** positional assertions execute against the resulting `.next` output
- **AND** no Worker upload validation executes

### Requirement: Verification proof inventory

The complete verification graph SHALL keep lint, compile, type-contract, TypeScript unit, Rust unit, Clippy, Rust dependency hygiene, NAPI canary, parity, integration, consumer build/assertion, Worker contract/dry-run, packed-consumer, and exact release-bundle evidence reachable.

#### Scenario: Structural inventory check

- **WHEN** the verification graph contract test inventories repository and owner claims
- **THEN** every required proof category has at least one executable reachable owner
- **AND** an omitted category fails the test with the missing category name

### Requirement: Active TypeScript test discovery

The TypeScript unit tier SHALL execute every active unit test under its owned package roots, including colocated system runtime tests and non-canary extractor tests.

#### Scenario: Colocated system test fails

- **WHEN** a test under `packages/system/src/` fails
- **THEN** `verify:unit:ts` and every composite containing it exit non-zero

#### Scenario: Non-canary extractor test fails

- **WHEN** a test under `packages/extract/tests/` other than the native canary fails
- **THEN** `verify:unit:ts` and every composite containing it exit non-zero

### Requirement: Host-native NAPI freshness

The NAPI freshness precondition SHALL compare Rust inputs against the exact binary selected for the current platform, architecture, and Linux libc.

#### Scenario: Foreign binary is fresh and host binary is stale

- **WHEN** a foreign-target binary is newer than Rust inputs and the current host binary is older
- **THEN** the freshness precondition exits non-zero and identifies the stale host binary

#### Scenario: Host binary is fresh

- **WHEN** the current host binary exists and is newer than every owned Rust input
- **THEN** the freshness precondition succeeds regardless of foreign binary timestamps

### Requirement: Rust lint suppression policy

The strict Clippy tier SHALL reject authored active Rust source containing crate-wide or module-wide `allow(warnings)` or `allow(clippy::all)` suppression.

#### Scenario: Blanket suppression is introduced

- **WHEN** an active Rust source contains blanket warning or Clippy suppression
- **THEN** `verify:clippy` exits non-zero and reports the source location

#### Scenario: Narrow justified suppression remains

- **WHEN** an active Rust source contains an allow for a named lint other than the blanket groups
- **THEN** the suppression policy does not fail that source before Clippy evaluates it

### Requirement: Rust dependency ignore policy

The Rust dependency hygiene tier SHALL reject a non-empty cargo-machete ignore list before running the unused-dependency detector.

#### Scenario: Ignored dependency is added

- **WHEN** parsed Cargo metadata exposes one or more cargo-machete ignored dependencies
- **THEN** `verify:hygiene:rust` exits non-zero and lists the package and ignored dependency names

#### Scenario: Ignore lists are empty

- **WHEN** parsed Cargo metadata contains no ignored dependency
- **THEN** `verify:hygiene:rust` proceeds to cargo-machete detection

