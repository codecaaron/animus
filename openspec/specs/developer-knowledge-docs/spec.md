## Purpose

Requirements for the `developer-knowledge-docs` capability: Package-level CLAUDE.md for extract; Package-level CLAUDE.md for vite-plugin; Package-level CLAUDE.md for showcase; and 1 more.
## Requirements
### Requirement: Package-level CLAUDE.md for extract

The `packages/extract/` directory SHALL contain a `CLAUDE.md` file documenting the Rust NAPI crate's build process, cache behavior, debugging procedures, and known failure modes.

#### Scenario: CLAUDE.md covers build commands

- **WHEN** a developer reads `packages/extract/CLAUDE.md`
- **THEN** it SHALL document: `napi build --platform --release` for production, `napi build --platform` for debug, and the root-level `build:extract` alias

#### Scenario: CLAUDE.md covers cache locations

- **WHEN** a developer reads `packages/extract/CLAUDE.md`
- **THEN** it SHALL document: `target/` (Cargo build cache), `*.node` (NAPI binary artifact), and how to clear each

#### Scenario: CLAUDE.md covers NAPI signature debugging

- **WHEN** a developer reads `packages/extract/CLAUDE.md`
- **THEN** it SHALL document: that changing NAPI function signatures requires rebuilding the `.node` binary, and that stale binaries accept wrong arity silently

#### Scenario: CLAUDE.md covers the NAPI function surface

- **WHEN** a developer reads `packages/extract/CLAUDE.md`
- **THEN** it SHALL document the three exported NAPI functions (`extract`, `analyze_project`, `transform_file`) with their parameter signatures and return types

### Requirement: Package-level CLAUDE.md for vite-plugin

The `packages/vite-plugin/` directory SHALL contain a `CLAUDE.md` file documenting the plugin's architecture, subprocess model, cache behavior, and debugging procedures.

#### Scenario: CLAUDE.md covers plugin lifecycle

- **WHEN** a developer reads `packages/vite-plugin/CLAUDE.md`
- **THEN** it SHALL document: `buildStart` (system loading via subprocess), `resolveId`/`load` (virtual stylesheet), `transform` (per-file extraction), and dev-mode HMR behavior

#### Scenario: CLAUDE.md covers Vite cache behavior

- **WHEN** a developer reads `packages/vite-plugin/CLAUDE.md`
- **THEN** it SHALL document: `node_modules/.vite/` as the transform cache location, that it persists across Vite restarts, and that deleting it forces re-extraction of all files

#### Scenario: CLAUDE.md covers subprocess model

- **WHEN** a developer reads `packages/vite-plugin/CLAUDE.md`
- **THEN** it SHALL document: system loading via bun subprocess (imports system module, calls `.serialize()`), global styles resolution via inline bun subprocess, and why subprocesses are used (ESM isolation from Vite's module graph)

#### Scenario: CLAUDE.md covers known failure modes

- **WHEN** a developer reads `packages/vite-plugin/CLAUDE.md`
- **THEN** it SHALL document: Vite resolve aliases can silently break transforms (React alias incident), stale `.vite` cache serving old transforms, and the debug logging mechanism

### Requirement: Package-level CLAUDE.md for showcase

The `packages/showcase/` directory SHALL contain a `CLAUDE.md` file documenting
the showcase's role as extraction proof, what breaks it, and how to verify
extraction is working.

#### Scenario: CLAUDE.md covers extraction verification

- **WHEN** a developer reads `packages/showcase/CLAUDE.md`
- **THEN** it SHALL document: how to run the complete showcase-scoped proof (`vp run @animus-ui/showcase#verify` — build, output assertions, Worker dry-run), where the assertion script and its lane receipt live, and that the built output carries no Emotion runtime

#### Scenario: CLAUDE.md covers the design system

- **WHEN** a developer reads `packages/showcase/CLAUDE.md`
- **THEN** it SHALL document: `src/ds.ts` defines the design system via `createSystem()`, the component library under `src/components/`, and that ALL components are built with the extraction-compatible `@animus-ui/system` builder

#### Scenario: CLAUDE.md covers common breakage patterns

- **WHEN** a developer reads `packages/showcase/CLAUDE.md`
- **THEN** it SHALL document: stale Vite cache after pipeline changes, components silently failing to extract when authored with the archived legacy builder instead of `ds.styles()`, and unresolved `__TRANSFORM__` placeholders in the output CSS

### Requirement: Root CLAUDE.md build system addendum

The root `CLAUDE.md` SHALL include a build system section (appended after existing content) documenting monorepo build order, verification commands, cache tiers, and common debugging scenarios.

#### Scenario: Root CLAUDE.md covers verification loop

- **WHEN** a developer reads the root `CLAUDE.md` build system section
- **THEN** it SHALL document: `bun run verify` (fast, TS only), `bun run verify:full` (complete with Rust + showcase), `bun run rebuild` (nuclear fresh state)

#### Scenario: Root CLAUDE.md covers build dependency order

- **WHEN** a developer reads the root `CLAUDE.md` build system section
- **THEN** it SHALL document the package build order: extract → core → theming → runtime → system → vite-plugin → ui → showcase

#### Scenario: Root CLAUDE.md covers debugging decision tree

- **WHEN** a developer reads the root `CLAUDE.md` build system section
- **THEN** it SHALL document a decision tree: "transforms seem stale" → clean:light, "NAPI errors" → rebuild, "nothing works" → clean:full + rebuild

