## MODIFIED Requirements

### Requirement: Atomic Tier Isolation

Every atomic tier SHALL execute its single concern in isolation. An atomic tier MUST NOT silently trigger upstream builds. An atomic tier MUST begin with a shell precondition block that exits with a non-zero status and a human-readable instruction identifying the missing upstream artifact and the exact command to produce it.

The atomic tiers defined by this policy are: `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust`, `verify:unit:ts`, `verify:canary`, `verify:integration`, `verify:build:next`, `verify:build:showcase`, `verify:assert:next`, `verify:assert:showcase`.

Atomic tier preconditions SHALL be derived from the actual script each tier invokes (what the tier reads at runtime), not from generic "TS built" assumptions. In particular:

- `verify:lint`, `verify:compile`, `verify:types`, `verify:unit:rust` have **no upstream artifact preconditions** — they operate on source.
- `verify:unit:ts` operates on source via `bun test`'s on-the-fly transpilation — no `dist/` precondition.
- `verify:canary` requires only a fresh NAPI binary; it does NOT require `packages/extract/dist/` or any other package's `dist/`.
- `verify:integration` requires a fresh NAPI binary AND a fresh `packages/extract/dist/index.mjs` (mtime newer than `packages/extract/src/**`) AND a fresh `packages/system/dist/` (mtime newer than `packages/system/src/**`) — `@animus-ui/extract/pipeline` and `@animus-ui/system` are both resolved via dist at test time.
- `verify:build:next` requires a fresh NAPI binary AND fresh `packages/extract/dist/` AND fresh `packages/system/dist/` AND fresh `packages/next-plugin/dist/` (each mtime newer than its own package's `src/**`). The bundler invokes the Next plugin at build time and consumer code resolves `@animus-ui/system` through dist.
- `verify:build:showcase` requires a fresh NAPI binary AND fresh `packages/extract/dist/` AND fresh `packages/system/dist/` AND fresh `packages/vite-plugin/dist/` AND fresh `packages/properties/dist/` (each mtime newer than its own package's `src/**`). The showcase resolves all four packages through dist.
- `verify:assert:next` requires `packages/next-test-app/.next/` (post-migration path: `e2e/next-app/.next/`) build output.
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

## ADDED Requirements

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

- `require_bun_install` — checks that `node_modules/.bin/tsc` exists; on failure emits "ERROR: tsc binary not found at node_modules/.bin/tsc. Run: bun install" and exits 1.
- `require_fresh_napi` — checks `packages/extract/*.node` existence AND mtime newer than every `packages/extract/src/**/*.rs` source file; on failure emits the appropriate missing/stale message with fix command `bun run build:extract`.
- `require_fresh_package_dist <pkg>` — checks the key dist artifact existence AND mtime freshness for the named workspace package; on failure emits the appropriate missing/stale message with fix command `bun run --filter '@animus-ui/<pkg>' build:ts`.
- `require_dir <path> <fix_command>` — checks that `<path>` exists; on failure emits "ERROR: <path> missing. Run: <fix_command>" and exits 1.

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
- **THEN** stderr contains a line matching "ERROR: packages/system/dist/ is stale (src newer than dist). Run: bun run --filter '@animus-ui/system' build:ts"
- **AND** the calling script exits with status 1

#### Scenario: Helper handles NAPI package specialization
- **WHEN** `require_fresh_napi` is invoked and the NAPI binary is stale relative to Rust source
- **THEN** the emitted error message uses the command `bun run build:extract` (not `bun run --filter '@animus-ui/extract' build:ts`)
- **AND** the script exits with status 1
