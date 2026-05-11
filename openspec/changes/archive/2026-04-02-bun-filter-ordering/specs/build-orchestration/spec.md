## MODIFIED Requirements

### Requirement: TypeScript build pipeline
The monorepo SHALL build all TypeScript library packages via `bun run --filter` with topological ordering derived from workspace dependency graph.

#### Scenario: build:ts executes all TS packages
- **WHEN** `bun run build:ts` is executed at the root
- **THEN** all packages with a `build:ts` script SHALL execute in dependency order

#### Scenario: Packages without build:ts are skipped
- **WHEN** a package (e.g., `_integration`, `_docs`) has no `build:ts` script
- **THEN** `bun run --filter` SHALL skip it without error

#### Scenario: App packages excluded from library build
- **WHEN** `bun run build:ts` is executed
- **THEN** showcase and next-test-app SHALL NOT be built (they are app builds, not library builds)
