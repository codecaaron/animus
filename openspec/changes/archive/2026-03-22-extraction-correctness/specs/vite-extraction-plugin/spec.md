## ADDED Requirements

### Requirement: Smoke test TypeScript configuration
The smoke test package SHALL have a `tsconfig.json` extending the root config with `jsx: "react-jsx"` and `noEmit: true`, and a `typecheck` script in `package.json` that runs `tsc --noEmit`.

#### Scenario: tsconfig resolves workspace packages
- **WHEN** `tsc --noEmit` runs in the smoke test
- **THEN** it SHALL resolve `@animus-ui/core` and `@animus-ui/runtime` imports via the workspace (path aliases or Bun workspace resolution) and type-check against their source types

#### Scenario: typecheck script is runnable
- **WHEN** a developer runs `bun run typecheck` in `packages/smoke-test/`
- **THEN** `tsc --noEmit` SHALL execute and report any type errors in `src/**/*.tsx`
