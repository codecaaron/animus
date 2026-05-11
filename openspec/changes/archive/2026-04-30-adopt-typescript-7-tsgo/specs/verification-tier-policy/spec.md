## MODIFIED Requirements

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
