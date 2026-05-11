## ADDED Requirements

### Requirement: Type-Check Implementation Selection

The repository SHALL designate a single canonical TypeScript implementation for type-check workloads — the workloads invoked by `verify:compile`, `verify:types`, and any future tier whose primary work is `--noEmit` type checking. The chosen implementation MUST honor the standard TypeScript CLI surface: `<binary> --noEmit` and `<binary> -p <tsconfig.json>` invocation forms.

The canonical type-check implementation MAY differ from the canonical declaration-emit implementation. The two MAY be sourced from different npm packages.

#### Scenario: Type-check tier invokes the canonical type-check binary

- **WHEN** a developer runs `bun run verify:compile`
- **THEN** each per-package `compile` script invokes the canonical type-check binary with `--noEmit`
- **AND** no other TypeScript implementation is invoked for type checking by the tier

#### Scenario: Type-check binary supports tsconfig path projection

- **WHEN** `scripts/verify/types.sh` runs
- **THEN** it invokes the canonical type-check binary with `-p packages/system/__tests__/tsconfig.test-d.json --noEmit`
- **AND** type-contract assertions execute against that tsconfig

#### Scenario: Single canonical implementation per tier

- **WHEN** a maintainer reads the per-package `compile` script and `scripts/verify/types.sh`
- **THEN** both invoke the same type-check binary
- **AND** no fallback or implementation-switching logic is present in the canonical scripts (fallbacks live in named alternate scripts, not the canonical path)

### Requirement: Declaration Emit Implementation Selection

The repository SHALL designate a single canonical TypeScript implementation for declaration emit workloads — the workloads invoked by each active TS package's `build:ts` script via `<binary> -p tsconfig.build.json`. The chosen implementation MUST honor the standard TypeScript CLI surface, including `--outDir` override and `tsconfig.json` projection. The canonical declaration-emit implementation MUST emit `.d.ts` artifacts that are stable across re-builds. Emit divergence between this implementation and any prior canonical that breaks consumer type-check or alters published type SHAPES SHALL be treated as a release-blocking regression. Stylistic divergences (quote style, object-property ordering, generic alpha-renaming, type-alias eager expansion) that produce semantically identical types are NOT release-blocking.

The canonical declaration-emit implementation MAY differ from the canonical type-check implementation. The two MAY be sourced from different npm packages.

#### Scenario: Declaration emit invokes the canonical declaration-emit binary

- **WHEN** a developer runs `bun run --filter '@animus-ui/<pkg>' build:ts`
- **THEN** `tsdown` produces `.js`/`.mjs` artifacts first
- **AND** the canonical declaration-emit binary runs against `tsconfig.build.json` with `emitDeclarationOnly: true` to emit `.d.ts`
- **AND** the binary used resolves to the version pinned by the corresponding root `devDependency`

#### Scenario: Alternate emit implementation requires parity gate via dts-parity.sh

- **WHEN** a future change proposes swapping the canonical declaration-emit implementation
- **THEN** the change MUST run `bash scripts/verify/dts-parity.sh` and document the verdict in the change's design notes
- **AND** strict byte-equal parity OR a categorized allowlist of semantically-equivalent stylistic divergences (each justified) is required
- **AND** the change MUST update root `CLAUDE.md` Monorepo Build System TypeScript Implementations table to name the new canonical implementation

#### Scenario: dts-parity.sh is reusable

- **WHEN** a maintainer wants to verify declaration-emit equivalence between two installed TypeScript-CLI-compatible binaries
- **THEN** running `bash scripts/verify/dts-parity.sh` (with both binaries present at `node_modules/.bin/tsc` and `node_modules/.bin/tsgo`) emits to a scratch directory
- **AND** prints per-file divergences inline
- **AND** exits 0 on byte-equal parity, 1 on divergence, 2 on precondition failure
- **AND** is side-effect-free against the source `dist/` directories

### Requirement: Version Pinning Policy

The canonical TypeScript implementations — both type-check and declaration-emit — SHALL be pinned to exact versions at the root `package.json` `devDependencies`. Range specifiers (`^`, `~`, etc.) are NOT permitted for these dependencies. Floating dist-tags (`beta`, `next`, `latest`) are NOT permitted in version strings.

The pin policy applies to:
- `typescript`: the JavaScript reference compiler used for declaration emit.
- Any alternate type-check implementation package (e.g., `@typescript/native-preview` for `tsgo`) installed at the root.

#### Scenario: TypeScript version is exact-pinned

- **WHEN** a maintainer reads root `package.json`
- **THEN** `devDependencies.typescript` declares an exact version with no `^` or `~` prefix
- **AND** an upgrade requires an explicit edit to that exact version string

#### Scenario: Alternate type-check implementation is exact-pinned

- **WHEN** the canonical type-check implementation is sourced from a package other than `typescript` (e.g., `@typescript/native-preview`)
- **THEN** that package's version in root `devDependencies` is an exact-pinned version string (e.g., `7.0.0-dev.20260421.2`)
- **AND** no floating dist-tag (`beta`, `next`, etc.) appears in that version string

### Requirement: Workload Split Documentation

The root `CLAUDE.md` SHALL document the canonical type-check and declaration-emit implementations in a section discoverable by agents (under `## Monorepo Build System` or equivalent). The documentation SHALL state:

- Which TypeScript implementation runs each workload (type-check, declaration emit).
- The install command for each implementation in `bun add -d <pkg>` form (or equivalent `bun install` invocation).
- The exact version pin currently in effect for each implementation.

#### Scenario: Agent looks up the canonical implementations

- **WHEN** an agent reads the root `CLAUDE.md` Monorepo Build System section
- **THEN** the documentation identifies which TypeScript implementation runs `verify:compile`, `verify:types`, and `build:ts`
- **AND** the install command for each is recorded in `bun` form
- **AND** the pinned version for each is recorded

#### Scenario: Documentation stays in sync with package.json

- **WHEN** the root `package.json` `devDependencies.typescript` or alternate type-check implementation version changes
- **THEN** the same change updates the version string recorded in the root `CLAUDE.md` Monorepo Build System section
- **AND** drift between `package.json` and `CLAUDE.md` is treated as a documentation defect

### Requirement: Soak Path for Type-Check Implementation Swaps

When the canonical type-check implementation is changed (e.g., from `tsc` to `tsgo` or vice versa), the change SHALL provide a parallel "fallback" script set that invokes the prior implementation. The fallback set SHALL exist for at least one inner-loop cycle after the change lands and SHALL be removed in a follow-on commit once the new canonical is verified stable.

The fallback set SHALL consist of:
- A root orchestrator script (e.g., `verify:compile:tsc-fallback`) that fans the fallback invocation across active packages.
- Per-package scripts (e.g., `compile:tsc-fallback`) that invoke the prior implementation with the same arguments.

The fallback scripts SHALL NOT be invoked by any composite orchestrator (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`). They are ad-hoc parity-check tools.

#### Scenario: Type-check swap ships with a fallback

- **WHEN** a change proposes swapping the canonical type-check implementation
- **THEN** the same change adds a `verify:<canonical-name>:<prior-name>-fallback` root script (or equivalent)
- **AND** per-package fallback scripts mirror the prior invocation pattern

#### Scenario: Fallback is excluded from composite orchestrators

- **WHEN** a developer runs any composite orchestrator (`verify`, `verify:full`, `verify:ci`, `verify:next`, `verify:showcase`)
- **THEN** no fallback script is invoked
- **AND** the canonical implementation runs

#### Scenario: Fallback is removed after soak

- **WHEN** the new canonical implementation has been stable for at least one inner-loop cycle (one calendar week minimum)
- **THEN** a follow-on commit removes the fallback root script AND the per-package fallback scripts
- **AND** the rollback strategy documented in this requirement is no longer available
