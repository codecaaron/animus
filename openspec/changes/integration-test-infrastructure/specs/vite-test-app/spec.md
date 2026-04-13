## ADDED Requirements

### Requirement: Contrived Vite test application
A minimal Vite application SHALL exist at `e2e/vite-app/` that exercises the extraction pipeline via `@animus-ui/vite-plugin`. It SHALL mirror the `packages/next-test-app` pattern: a small set of components importing from `@animus-ui/test-ds`, its own system definition, and post-build structural assertions.

#### Scenario: Workspace registration
- **WHEN** the root `package.json` workspaces list is inspected
- **THEN** it SHALL include `"e2e/vite-app"`

#### Scenario: Package identity
- **WHEN** `e2e/vite-app/package.json` is inspected
- **THEN** it SHALL have `"name": "@animus-ui/vite-test-app"`, `"private": true`, and `"type": "module"`

### Requirement: Vite configuration with extraction plugin
The fixture SHALL use `animusExtract()` from `@animus-ui/vite-plugin` pointing to its own system file.

#### Scenario: Plugin configuration
- **WHEN** `e2e/vite-app/vite.config.ts` is inspected
- **THEN** it SHALL import `animusExtract` from `@animus-ui/vite-plugin` and `react` from `@vitejs/plugin-react`
- **AND** it SHALL call `animusExtract({ system: './src/ds.ts' })`

### Requirement: System definition from test-ds
The fixture SHALL define its own `src/ds.ts` that imports theme and system from `@animus-ui/test-ds` or builds a minimal system directly, producing a `SystemInstance` default export.

#### Scenario: System file exists and exports correctly
- **WHEN** `e2e/vite-app/src/ds.ts` is inspected
- **THEN** it SHALL export a `SystemInstance` as the default export
- **AND** it SHALL use `@animus-ui/system` builder APIs (`createSystem`, `createTheme`)

### Requirement: Component fixtures exercise builder chain surface
The fixture SHALL include components that collectively exercise: base styles (`.styles()`), variants (`.variant()`), compound variants (`.compound()`), states (`.states()`), system props (`.props()`), extension chains (`.extend()`), and composition (`compose()`).

#### Scenario: Component inventory
- **WHEN** `e2e/vite-app/src/components/` is inspected
- **THEN** it SHALL contain components covering at minimum: a base-styled element, a component with variants, a component with states, an extension chain (parent + child), and a composed family

#### Scenario: Components import from test-ds
- **WHEN** the fixture components are inspected
- **THEN** at least one component SHALL import from `@animus-ui/test-ds` to exercise cross-package extraction

### Requirement: Build and assertion scripts
The fixture SHALL include build scripts and structural post-build assertions runnable from the repo root.

#### Scenario: Build script
- **WHEN** `bun run --filter '@animus-ui/vite-test-app' build` is executed
- **THEN** Vite SHALL build the app to `e2e/vite-app/dist/`

#### Scenario: Root-level verification command
- **WHEN** `bun run test:vite-app` is executed from the repo root
- **THEN** it SHALL build the Vite fixture app and run post-build assertions
- **AND** it SHALL exit with zero status when all assertions pass

#### Scenario: Integration with verify:full
- **WHEN** `bun run verify:full` is executed
- **THEN** it SHALL include `test:vite-app` in its pipeline

### Requirement: Fixture stays minimal
The fixture SHALL NOT include: MDX, animation libraries, icon libraries, routing, or any dependency not required for extraction testing. Dependencies SHALL be limited to `react`, `react-dom`, `@animus-ui/system`, `@animus-ui/test-ds`, `@animus-ui/vite-plugin`, `@vitejs/plugin-react`, and `vite`.

#### Scenario: Dependency audit
- **WHEN** `e2e/vite-app/package.json` dependencies are inspected
- **THEN** no dependency outside the allowed list SHALL be present
