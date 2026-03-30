## MODIFIED Requirements

### Requirement: Theme self-serialization method naming
The built theme object's pipeline serialization method SHALL be named `.serialize()` (not `.evaluate()`), matching `ds.serialize()`.

#### Scenario: tokens.serialize() returns pipeline-ready JSON
- **WHEN** consumer calls `tokens.serialize()` on a theme built via `createTheme().build()`
- **THEN** the return value SHALL contain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }` — identical shape and values to the previous `.evaluate()` method

#### Scenario: tokens.evaluate() removed
- **WHEN** consumer accesses `tokens.evaluate`
- **THEN** it SHALL be `undefined` — the method is renamed, not aliased

### Requirement: SerializedTheme type naming
The type for the theme serialization return value SHALL be `SerializedTheme` (not `EvaluatedTheme`).

#### Scenario: SerializedTheme exported from system
- **WHEN** build tooling imports `SerializedTheme` from `@animus-ui/system`
- **THEN** it SHALL receive the type `{ scalesJson: string; variableMapJson: string; variableCss: string; contextualVarsJson: string }`

## REMOVED Requirements

### Requirement: Pipeline subpath export
**Reason:** Pipeline utilities (resolveGlobalStyles, camelToKebab, resolveValue) are extraction concerns, not system concerns. Moved to `@animus-ui/extract`.
**Migration:** Import from `@animus-ui/extract` instead of `@animus-ui/system/pipeline`.
