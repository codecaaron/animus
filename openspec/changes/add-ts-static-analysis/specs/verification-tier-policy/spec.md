## MODIFIED Requirements

### Requirement: Atomic Tier Isolation

Every atomic tier SHALL execute its single concern in isolation. An atomic tier MUST NOT silently trigger upstream builds. An atomic tier MUST begin with a shell precondition block that exits with a non-zero status and a human-readable instruction identifying the missing upstream artifact and the exact command to produce it.

The atomic tiers defined by this policy are: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`, `verify:hygiene:rust`, `verify:hygiene:ts`.

Atomic tier preconditions SHALL be derived from the actual script each tier invokes (what the tier reads at runtime), not from generic "TS built" assumptions. In particular:

- `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:hygiene:rust`, `verify:hygiene:ts` have **no upstream artifact preconditions** — they operate on source. `verify:hygiene:rust` additionally requires the `cargo-machete` binary to be installed; `verify:hygiene:ts` additionally requires the `fallow` binary to be installed. These are tool preconditions, not artifact preconditions, and fail loud via `require_cargo_machete` / `require_fallow_binary`.
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

#### Scenario: Missing fallow binary surfaces as tool precondition failure

- **WHEN** a developer runs `verify:hygiene:ts` with no `fallow` binary on PATH
- **THEN** the script exits 1
- **AND** stderr includes an exact message matching "ERROR: fallow missing. Run: <install-command>" where the install command is the canonical global install (`bun install -g fallow` or `npm install -g fallow`)

#### Scenario: TS hygiene tier does not require any built artifact

- **WHEN** a developer runs `verify:hygiene:ts` with no NAPI binary and no package `dist/` directories present
- **AND** `fallow` is installed
- **AND** `.fallowrc.json` and `.fallow/*-baseline.json` files exist
- **THEN** the tier runs to completion (source + config + baselines is all it reads)
- **AND** no build of any kind is triggered

### Requirement: Shared Precondition Helper Library

A shared shell helper SHALL exist at `scripts/verify/_preconditions.sh` and SHALL be the single authoritative implementation of all atomic-tier precondition checks. Every atomic tier script SHALL source this helper and invoke named helper functions rather than inline precondition logic. Duplication of precondition logic across atomic tier scripts SHALL NOT exist once this helper is in place.

The helper SHALL export at minimum these composable shell functions:

- `require_bun_install` — checks that `node_modules/.bin/tsc` exists; on failure emits "ERROR: tsc binary not found at node_modules/.bin/tsc. Run: bun install" and exits 1.
- `require_fresh_napi` — checks `packages/extract/*.node` existence AND mtime newer than every `packages/extract/src/**/*.rs` source file; on failure emits the appropriate missing/stale message with fix command `bun run build:extract`.
- `require_fresh_package_dist <pkg>` — checks the key dist artifact existence AND mtime freshness for the named workspace package; on failure emits the appropriate missing/stale message with fix command `bun run --filter '@animus-ui/<pkg>' build:ts`.
- `require_dir <path> <fix_command>` — checks that `<path>` exists; on failure emits "ERROR: <path> missing. Run: <fix_command>" and exits 1.
- `require_cargo_machete` — checks that the `cargo-machete` binary is available on PATH; on failure emits "ERROR: cargo-machete missing. Run: cargo install cargo-machete" and exits 1.
- `require_fallow_binary` — checks that the `fallow` binary is available on PATH (e.g., via `command -v fallow`); on failure emits "ERROR: fallow missing. Run: bun install -g fallow" (or the canonical install command chosen at implementation time) and exits 1.

All helper functions SHALL emit errors to stderr and return exit code 1 on failure. The helper SHALL be sourced (not spawned as a subprocess) so the calling tier script inherits exit semantics. The helper SHALL have `set -euo pipefail`-compatible behavior — i.e., not rely on side effects that the caller's strict-mode settings would prevent.

When this Requirement is implemented, the following existing tier scripts MUST be rewritten to call helper functions instead of containing inline precondition logic: `scripts/verify/canary.sh`, `scripts/verify/integration.sh`, `scripts/verify/build-next.sh`, `scripts/verify/build-showcase.sh`, `scripts/verify/assert-next.sh`, `scripts/verify/assert-showcase.sh`, `scripts/verify/compile.sh`, `scripts/verify/types.sh`. Source-only tier scripts (`verify:lint`, `verify:unit:rust`, `verify:unit:ts`, `verify:hygiene:rust`, `verify:hygiene:ts`) MAY source the helper for consistency even if they currently require no precondition calls. `scripts/verify/hygiene-rust.sh` MUST source the helper and invoke `require_cargo_machete`. `scripts/verify/hygiene-ts.sh` MUST source the helper and invoke `require_fallow_binary`.

#### Scenario: Tier script sources the helper

- **WHEN** a maintainer inspects any atomic tier script under `scripts/verify/`
- **THEN** the script includes `source "$ROOT/scripts/verify/_preconditions.sh"` near the top
- **AND** all precondition logic is expressed as `require_*` function calls
- **AND** no inline `ls packages/extract/*.node` / `find -newer` patterns appear in the tier script itself

#### Scenario: Helper is the one authoritative implementation

- **WHEN** a maintainer greps `scripts/verify/*.sh` for inline `find -newer` patterns
- **THEN** matches appear only within `scripts/verify/_preconditions.sh` — never in an individual tier script

#### Scenario: Helper function emits actionable error message

- **WHEN** `require_fresh_package_dist system` is called and `packages/system/dist/` is stale
- **THEN** stderr contains a line matching "ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts"
- **AND** the calling script exits with status 1

#### Scenario: Helper handles NAPI package specialization

- **WHEN** `require_fresh_napi` is invoked and the NAPI binary is stale relative to Rust source
- **THEN** the emitted error message uses the command `bun run build:extract` (not `bun run --filter '@animus-ui/extract' build:ts`)
- **AND** the script exits with status 1

#### Scenario: Helper detects missing cargo-machete binary

- **WHEN** `require_cargo_machete` is invoked and `command -v cargo-machete` returns non-zero
- **THEN** stderr contains the line "ERROR: cargo-machete missing. Run: cargo install cargo-machete"
- **AND** the calling script exits with status 1

#### Scenario: Helper detects missing fallow binary

- **WHEN** `require_fallow_binary` is invoked and `command -v fallow` returns non-zero
- **THEN** stderr contains a line matching "ERROR: fallow missing. Run: <install-command>"
- **AND** the calling script exits with status 1

### Requirement: Change-Type Map

The root `CLAUDE.md` SHALL contain a Change-Type Map: a table with the columns `You changed` (an edit-surface description, e.g., a path glob or behavior) and `Run` (the minimum verification-tier set to run for that change). The map MUST contain 13 canonical rows covering the primary edit surfaces of the repository, plus a sidebar note covering non-verify edit surfaces.

Rows SHALL be added when a new top-level edit surface (e.g., a new publishable package, a new `e2e/*` fixture, a new top-level config file) is introduced.

The canonical rows:

| You changed | Run |
|---|---|
| `packages/system/src/**` | `verify:compile && verify:types && verify:unit:ts` |
| `packages/extract/src/**/*.rs` | `verify:unit:rust && verify:canary && verify:integration` |
| `packages/extract/src/**/*.ts` (NAPI TS binding / pipeline) | `verify:canary && verify:integration` |
| `packages/extract/Cargo.toml` | `verify:hygiene:rust` |
| `packages/vite-plugin/src/**` | `verify:compile && verify:integration && verify:showcase` |
| `packages/next-plugin/src/**` | `verify:compile && verify:next` |
| `packages/showcase/src/**` (code; MDX content excluded — see sidebar) | `verify:showcase` |
| `packages/properties/src/**` | `verify:compile && verify:unit:ts` |
| `packages/_integration/__tests__/**` | `verify:integration` |
| `packages/test-ds/src/**` | `verify:unit:ts && verify:next && verify:showcase` |
| `.fallowrc.json`, `.fallow/**` | `verify:hygiene:ts` |
| `.github/workflows/ci.yaml`, `scripts/**`, `.tool-versions` | `verify:ci` |
| Broad refactor across multiple surfaces | `verify:full` |

Whether `verify:hygiene:ts` is added to existing TS-source rows (e.g., `packages/system/src/**`) is a policy decision set by a separate change, not by this capability install.

Sidebar — **no verify tier required**: `openspec/**` (run `openspec validate` instead), MDX content under `packages/showcase/src/content/**`, root markdown (`CLAUDE.md`, `README.md`, `docs/**`).

The Change-Type Map SHALL be the authoritative instructability surface for agents selecting minimum verification for a narrow change.

#### Scenario: Agent selects verification set from the map

- **WHEN** an agent modifies only files under a mapped edit surface
- **AND** reads the Change-Type Map in root `CLAUDE.md`
- **THEN** the agent runs the exact tier set listed against that surface
- **AND** does not run unrelated tiers

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

- **WHEN** an agent modifies only `packages/extract/Cargo.toml` (for example, adding or removing a `[dependencies]` entry)
- **AND** reads the Change-Type Map
- **THEN** the agent runs `verify:hygiene:rust && verify:unit:rust`
- **AND** does not need to run `verify:canary` or `verify:integration` unless `.rs` sources also changed

#### Scenario: Fallow config edit triggers TS hygiene tier

- **WHEN** an agent modifies only `.fallowrc.json` or any file under `.fallow/**`
- **AND** reads the Change-Type Map
- **THEN** the agent runs `verify:hygiene:ts`

#### Scenario: New edit surface requires a map row

- **WHEN** a change introduces a new publishable package or a new top-level edit surface
- **THEN** the same change MUST add a corresponding row to the Change-Type Map

### Requirement: verify:ci CI-Simulation Semantics

`verify:ci` SHALL reproduce the CI workflow's job set and execution order locally on a best-effort basis. It MUST run the same command sequence as CI jobs `lint`, `test-rust`, `hygiene-rust`, `hygiene-ts`, `build-extract`, and `verify` (in that order). It MUST invoke `bun run build:extract` and `bun run build:ts` inline (CI materializes these artifacts before verify). It MUST include `verify:integration` and `verify:build:showcase` + `verify:assert:showcase` (CI runs both).

It MUST NOT attempt runner-OS parity, matrix-target multiplicity (CI builds 3 platform binaries; local builds 1), or release-gated steps.

If CI workflow ordering or coverage changes, `verify:ci` MUST be updated in the same change that modifies `ci.yaml`.

#### Scenario: CI ordering matches locally

- **WHEN** a developer runs `verify:ci`
- **THEN** lint runs first, then Rust unit tests, then Rust hygiene, then TS hygiene, then `bun run build:extract`, then `bun run build:ts`, then the verify-equivalent tiers including integration and showcase assert

#### Scenario: CI workflow edit keeps verify:ci in sync

- **WHEN** a change modifies `.github/workflows/ci.yaml` job ordering or commands
- **THEN** the same change modifies the `verify:ci` script to match

#### Scenario: hygiene jobs parallel in CI map to sequential locally

- **WHEN** a developer runs `verify:ci`
- **THEN** `verify:hygiene:rust` and `verify:hygiene:ts` execute sequentially (local parallelism is not a requirement)
- **AND** a machete or fallow failure surfaces before the build-extract step runs
