# rolldown-build Specification

## Purpose

TBD - created by archiving change rolldown-build. Update Purpose after archive.

## Requirements

### Requirement: Rolldown as library bundler

Each published package (core, theming, ui) SHALL use Rolldown to produce ES module bundles. Rolldown SHALL handle TypeScript and JSX compilation natively without Babel or separate TypeScript emit plugins.

#### Scenario: Core package build

- **WHEN** `bun run build` executes in `packages/core`
- **THEN** Rolldown produces `dist/index.js` (ES module format) with all `node_modules` externalized

#### Scenario: TypeScript declaration output

- **WHEN** a package is built
- **THEN** `dist/index.d.ts` declaration files are generated (via tsc or Rolldown dts plugin)

### Requirement: No Babel in build pipeline

The build pipeline SHALL NOT use Babel for any purpose. No `babel.config.js`, `.babelrc`, or Babel-related dependencies SHALL exist in the repository.

#### Scenario: Babel removal verification

- **WHEN** searching the repository for Babel configuration files
- **THEN** no `babel.config.js`, `.babelrc`, or `babel.config.json` files exist at any level
- **THEN** no `@babel/*`, `babel-*`, or `babel-preset-*` entries exist in any `package.json`

### Requirement: Shared Rolldown base config

A shared Rolldown configuration SHALL be defined at the root. Per-package configs SHALL extend the shared base with minimal overrides (entry point, externals).

#### Scenario: Per-package config

- **WHEN** examining a package's `rolldown.config.ts`
- **THEN** it imports and extends the root shared config
- **THEN** package-specific config is no more than ~10 lines

### Requirement: Build output equivalence

The Rolldown build output SHALL be functionally equivalent to the current Rollup output: ES module format, single `dist/index.js` entry, all external dependencies excluded from the bundle.

#### Scenario: Output format

- **WHEN** inspecting `dist/index.js` after a Rolldown build
- **THEN** the file uses ES module syntax (import/export)
- **THEN** no `node_modules` code is inlined

### Requirement: Binding to orchestration-architecture

The library bundler contract — Rolldown as the bundling engine, ES-module output, TypeScript and JSX compilation without Babel, externalization of `node_modules`, declaration emission — defined in this spec SHALL be realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding invokes `tsdown` (which uses Rolldown internally) per package via `bun run --filter './packages/*' build:ts`.

A future rebind to direct `vp pack` invocation (per the `migrate-build-to-vp-pack` follow-on policy change) SHALL preserve the bundler-engine identity (Rolldown), the output format (ES module), the externalization contract, and the declaration-emission requirement. The rebind MAY replace `tsdown.config.ts` files with `rolldown.config.ts` (or the orchestrator's equivalent config surface) provided the output is functionally equivalent.

This spec's existing requirement text references legacy package paths (`packages/core`, `packages/theming`, `packages/ui`) that no longer exist in the active build graph (they live under `legacy/` per the `legacy-directory-topology` capability). The reference refresh — updating the requirement text to enumerate the current package set (`packages/extract`, `packages/system`, `packages/properties`, `packages/vite-plugin`, `packages/next-plugin`, `packages/_assertions`) — SHALL be performed in the `migrate-build-to-vp-pack` follow-on policy change as part of the rebind. This capability change does NOT modify the existing requirements' text.

#### Scenario: Rolldown engine identity survives bundler rebind

- **WHEN** a cutover follow-on rebinds the library-build invocation (e.g., `tsdown` → `vp pack`)
- **THEN** the underlying bundling engine continues to be Rolldown
- **AND** ES-module output continues to be the only emitted format
- **AND** all `node_modules` continue to be externalized from the bundle
- **AND** TypeScript declaration files continue to be emitted

#### Scenario: Stale package references refreshed by rebind follow-on

- **WHEN** the `migrate-build-to-vp-pack` follow-on policy change is proposed
- **THEN** it modifies the existing "Core package build" scenario (and similar legacy-package scenarios) to reference current packages
- **AND** this capability change does NOT pre-emptively modify those scenarios
