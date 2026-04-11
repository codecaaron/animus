## MODIFIED Requirements

### Requirement: Runtime import injection for compose replacements

The transform emitter SHALL inject runtime imports based on the compose replacement type. For `context: false` replacements, it SHALL import `createComposedFamily` from the configured `runtime_import` path. For `context: true` replacements, it SHALL import `createComposedFamilyWithContext` from a compose-context module path derived from `runtime_import`.

#### Scenario: Derive compose-context path from runtime_import
- **WHEN** `runtime_import` is `@animus-ui/system/runtime`
- **THEN** the compose-context import path is `@animus-ui/system/compose-with-context`

#### Scenario: Derive compose-context path from barrel runtime_import
- **WHEN** `runtime_import` is `@animus-ui/system`
- **THEN** the compose-context import path is `@animus-ui/system/compose-with-context`

#### Scenario: Mixed compose and composeWithContext in same file
- **WHEN** a file contains both `compose()` and `composeWithContext()` calls
- **THEN** the emitter generates two import lines: one for `createComposedFamily` from runtime, one for `createComposedFamilyWithContext` from compose-with-context
