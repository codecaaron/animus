## MODIFIED Requirements

### Requirement: Per-workspace type checking
The `compile` script SHALL run `tsc --noEmit` with each active package's own `tsconfig.json` instead of running root-level `tsc --noEmit`. Active packages: core, theming, runtime, system, vite-plugin, showcase.

#### Scenario: Each package uses own tsconfig
- **WHEN** `bun run compile` executes
- **THEN** it SHALL run `tsc -p packages/<pkg>/tsconfig.json --noEmit` for each of the 6 active packages

#### Scenario: Dead packages excluded
- **WHEN** `bun run compile` executes
- **THEN** `packages/_docs`, `packages/ui`, and `packages/_integration` SHALL NOT be type-checked

#### Scenario: JSX setting respected per package
- **WHEN** `packages/showcase/tsconfig.json` specifies `"jsx": "react-jsx"`
- **THEN** showcase files SHALL be type-checked with automatic JSX transform, not requiring `import React`

### Requirement: Build before compile ordering
The `compile` script SHALL only be run after `build:ts` completes, so that cross-package import declarations in `dist/` are available for type resolution.

#### Scenario: Verify script ordering
- **WHEN** `bun run verify` executes
- **THEN** `build:ts` SHALL complete before `compile` starts

#### Scenario: CI step ordering
- **WHEN** the CI `verify` job runs
- **THEN** the Build step SHALL precede the Type Check step

### Requirement: Explicit workspace list
The root `package.json` `workspaces` field SHALL list active packages explicitly instead of using a glob pattern, excluding dead packages.

#### Scenario: Workspace packages
- **WHEN** `bun install` runs
- **THEN** only `packages/core`, `packages/extract`, `packages/runtime`, `packages/showcase`, `packages/system`, `packages/theming`, and `packages/vite-plugin` SHALL be treated as workspace members

#### Scenario: Dead packages ignored
- **WHEN** `bun install` runs
- **THEN** `packages/_docs`, `packages/ui`, and `packages/_integration` SHALL NOT be resolved as workspace members

### Requirement: Type test files excluded from main compile
The `packages/system/tsconfig.json` SHALL NOT include `__tests__/**/*.test-d.*` files. These files are type-checked separately via `bun run test:types` using their own `tsconfig.test-d.json` which disables `noUnusedLocals`.

#### Scenario: Compile passes without type test noise
- **WHEN** `tsc -p packages/system/tsconfig.json --noEmit` runs
- **THEN** it SHALL NOT report unused variable errors from `__tests__/types.test-d.tsx`

#### Scenario: Type tests still verified
- **WHEN** `bun run test:types` runs
- **THEN** it SHALL use `packages/system/__tests__/tsconfig.test-d.json` which includes the test-d files with `noUnusedLocals: false`
