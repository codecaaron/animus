## MODIFIED Requirements

### Requirement: System package exports `createClassResolver`
The `@animus-ui/system` package SHALL export `createClassResolver` as a named export alongside `createComponent`.

#### Scenario: Import available
- **WHEN** a consumer writes `import { createClassResolver } from '@animus-ui/system'`
- **THEN** it SHALL resolve to the className resolution function

#### Scenario: Used by extraction transform
- **WHEN** the Rust extraction pipeline transforms an `.asClass()` chain
- **THEN** it SHALL emit an import of `createClassResolver` from `@animus-ui/system`
