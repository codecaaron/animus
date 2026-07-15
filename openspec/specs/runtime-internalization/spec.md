## Purpose

Requirements for the `runtime-internalization` capability: Runtime module location; Runtime package removal.

## Requirements

### Requirement: Runtime module location

The `createComponent` function and all runtime types SHALL reside in `packages/system/src/runtime/index.ts`. The system package SHALL export `createComponent` from its public API.

#### Scenario: Import from system package

- **WHEN** consumer code imports `createComponent`
- **THEN** the import path SHALL be `import { createComponent } from '@animus-ui/system'`

#### Scenario: Internal builder chain usage

- **WHEN** `Animus.ts` or `AnimusExtended.ts` need `createComponent`
- **THEN** they SHALL import from `'./runtime'` (relative path within system package)

### Requirement: Runtime package removal

The `packages/runtime` workspace entry SHALL be removed from the root `package.json` workspaces array and from the `build:ts` script order. The runtime package SHALL NOT be built or published.

#### Scenario: Workspace exclusion

- **WHEN** `bun install` runs at the repository root
- **THEN** `packages/runtime` SHALL NOT be included in the workspace resolution

#### Scenario: Build order exclusion

- **WHEN** `bun run build:ts` runs
- **THEN** the runtime package SHALL NOT appear in the build chain
