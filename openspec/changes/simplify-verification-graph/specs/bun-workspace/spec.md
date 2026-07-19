## MODIFIED Requirements

### Requirement: Simplified root scripts

Repository-wide verification diagnostics/composites and shared artifact builds SHALL remain Vite+ root tasks and SHALL be absent from the root `package.json` script inventory. Framework-specific consumer build, assertion, dry-run, and complete verification scripts SHALL live in the owning workspace manifest and SHALL be invoked through package-target or workspace-filter syntax. The root task graph SHALL NOT retain `build:showcase` or another per-consumer build family merely to proxy an owner script.

Package-management, release/deployment triggers, long-running development, and explicitly unmigrated compatibility scripts MAY remain root package scripts when they are not a competing task graph.

#### Scenario: Root script inventory

- **WHEN** a maintainer inspects root `package.json` and `vite.config.ts`
- **THEN** repository-wide diagnostics, fast/full composites, and shared builds are root Vite+ tasks
- **AND** per-consumer verification/build phases are absent from the root task family
- **AND** consumer workspace manifests own their framework-specific scripts
- **AND** Bun remains the package manager and filtered package-script runner
