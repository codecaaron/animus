## ADDED Requirements

### Requirement: System re-exports theming public API
The `@animus-ui/system` package SHALL re-export `createTheme` and related public types from `@animus-ui/theming` so that consumers can author their entire system definition using a single import source.

#### Scenario: Consumer imports createTheme from system
- **WHEN** consumer writes `import { createSystem, createTheme } from '@animus-ui/system'`
- **THEN** both imports SHALL resolve — `createTheme` is re-exported from theming

#### Scenario: Theming is not a direct consumer dependency
- **WHEN** consumer installs `@animus-ui/system`
- **THEN** `@animus-ui/theming` SHALL be pulled in as a transitive dependency — the consumer does not need to install it separately
