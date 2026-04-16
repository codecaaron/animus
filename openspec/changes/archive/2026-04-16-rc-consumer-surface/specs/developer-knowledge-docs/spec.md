## MODIFIED Requirements

### Requirement: Root CLAUDE.md build system addendum
The root `CLAUDE.md` SHALL include a build system section (appended after existing content) documenting monorepo build order, verification commands, cache tiers, and common debugging scenarios. Consumer-facing README content SHALL NOT conflict with internal CLAUDE.md content — the same APIs, terminology, and package names MUST be used in both.

#### Scenario: Root CLAUDE.md covers verification loop
- **WHEN** a developer reads the root `CLAUDE.md` build system section
- **THEN** it SHALL document: `bun run verify` (fast, TS only), `bun run verify:full` (complete with Rust + showcase), `bun run rebuild` (nuclear fresh state)

#### Scenario: Root CLAUDE.md covers build dependency order
- **WHEN** a developer reads the root `CLAUDE.md` build system section
- **THEN** it SHALL document the package build order: extract → core → theming → system → vite-plugin → showcase

#### Scenario: Root CLAUDE.md covers debugging decision tree
- **WHEN** a developer reads the root `CLAUDE.md` build system section
- **THEN** it SHALL document a decision tree: "transforms seem stale" → clean:light, "NAPI errors" → rebuild, "nothing works" → clean:full + rebuild

#### Scenario: Terminology consistency between README and CLAUDE.md
- **WHEN** both the root README.md and root CLAUDE.md reference the builder chain API
- **THEN** both SHALL use `.system()` (not `.groups()`) and `ds.styles()` (not `animus.styles()`)
