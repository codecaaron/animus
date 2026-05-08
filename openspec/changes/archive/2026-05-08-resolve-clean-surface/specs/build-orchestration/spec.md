## MODIFIED Requirements

### Requirement: Clean command

The root orchestrator's task graph (currently `vite.config.ts` `run.tasks` per the `migrate-orchestrator-to-vp-run` binding) SHALL contain a `clean` task that removes all build artifacts, returning the repo to a pre-build state. The task's command MAY use `rm -rf` directly until vp ships a native cleaning capability that preserves all current cleaning targets.

#### Scenario: Clean all artifacts

- **WHEN** a developer runs `bunx vp run clean` from the repository root
- **THEN** all `packages/*/dist/` directories are removed
- **THEN** `packages/extract/target/` (Rust build cache) is removed
- **THEN** no source files or configuration files are affected
