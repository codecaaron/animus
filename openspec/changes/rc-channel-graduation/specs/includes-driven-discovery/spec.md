## MODIFIED Requirements

### Requirement: Constructor-argument AST tracing
The plugin SHALL read the system entry file and find `createSystem({ includes: [...] })` constructor calls. For each identifier inside the array, it SHALL trace back to the corresponding import declaration and extract the package specifier. Only packages explicitly declared via the `includes` constructor argument SHALL be discovered.

During the RC iteration window, the parser MAY also accept the legacy `.includes([...])` chain-method pattern to ease migration. Before `1.0.0` graduation the parser MUST hard-cut to the constructor-argument pattern only — the chain-method form is removed from the `@animus-ui/system` public surface (see `system-builder` capability).

#### Scenario: Constructor-arg identifier traces to import
- **WHEN** the system file contains `createSystem({ includes: [testDs] })` and `import { ds as testDs } from '@animus-ui/test-ds'`
- **THEN** `@animus-ui/test-ds` SHALL be in the discovered specifier set

#### Scenario: Multiple identifiers in constructor arg
- **WHEN** the system file contains `createSystem({ includes: [a, b] })` with `import { ds as a } from '@ds-a/core'` and `import { ds as b } from '@ds-b/core'`
- **THEN** both `@ds-a/core` and `@ds-b/core` SHALL be in the discovered set

#### Scenario: Legacy chain-method pattern during migration window
- **WHEN** the system file contains `createSystem().addProps(...).includes([testDs]).build()` and the parser is in migration mode (pre-graduation)
- **THEN** `@animus-ui/test-ds` SHALL be in the discovered set — the parser accepts either form

#### Scenario: Legacy chain-method pattern post-graduation
- **WHEN** the system file contains `.includes([...])` and the parser is in strict constructor-arg-only mode (post-graduation)
- **THEN** the chain-method form SHALL NOT be recognized by `discover-packages.ts`
- **AND** the compile-time surface of `@animus-ui/system` SHALL have removed the chain method, so this scenario is unreachable for supported consumers

#### Scenario: No includes declared
- **WHEN** the system file calls `createSystem()` or `createSystem({})` with no `includes` field
- **THEN** the discovered specifier set SHALL be empty — no external packages

#### Scenario: System imports not used in includes are not discovered
- **WHEN** the system file imports `@animus-ui/system` but does NOT reference it in the `includes` constructor argument
- **THEN** `@animus-ui/system` SHALL NOT be in the discovered set
