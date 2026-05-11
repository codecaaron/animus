## ADDED Requirements

### Requirement: Binding to orchestration-architecture

The build DAG, clean command, verification pipeline, and granular test commands defined in this spec are realized through the orchestrator binding designated by the `orchestration-architecture` capability. The current binding uses `bun run` (specifically `bun run build:all`, `bun run build:extract`, `bun run build:ts`, `bun run clean`, `bun run verify`). A future rebind to a different orchestrator (e.g., Vite+ via the `migrate-orchestrator-to-vp-run` follow-on policy change) SHALL preserve every behavioral requirement in this spec — DAG ordering, clean coverage, verification composition — while updating only the invocation surface.

The Rust NAPI build (`packages/extract`) SHALL remain owned by `cargo` + `@napi-rs/cli` per the Rust-pipeline exclusion in `orchestration-architecture`. Any orchestrator binding that orchestrates the full DAG MUST shell out to the cargo-based NAPI build for the Rust step.

#### Scenario: Build DAG semantics survive orchestrator rebind

- **WHEN** a cutover follow-on rebinds the orchestrator
- **THEN** the full-build task continues to build packages in the correct topological position
- **AND** the Rust NAPI build continues to invoke `cargo` / `napi build`
- **AND** the clean task continues to remove `dist/`, `target/`, and `.node` artifacts as documented
- **AND** the verification pipeline continues to compose its constituent tiers in the correct order
