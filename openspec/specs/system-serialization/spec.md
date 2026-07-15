## Purpose

Requirements for the `system-serialization` capability: Theme self-serialization; System instance method rename; SerializedTheme type naming; and 2 more.

## Requirements

### Requirement: Theme self-serialization

The built theme's serialization method SHALL be `.serialize()`. It SHALL flatten nested theme data at the serialization boundary, converting dot-path keys to dash-join for CSS variable names.

#### Scenario: tokens.serialize() returns pipeline-ready JSON

- **WHEN** consumer calls `tokens.serialize()` on a theme built via the new builder chain
- **THEN** the return value SHALL contain `{ scalesJson, variableMapJson, variableCss, contextualVarsJson }`

#### Scenario: scalesJson uses dot-path keys

- **WHEN** theme has nested colors `{ gray: { 50: '#fafafa' } }`
- **THEN** `scalesJson` SHALL contain `{ "colors.gray.50": "var(--color-gray-50)" }` — dot-path key, dash-join CSS var name

#### Scenario: variableMapJson maps dot-path to CSS var name

- **WHEN** theme has emitted colors
- **THEN** `variableMapJson` SHALL contain `{ "colors.ember": "--color-ember" }`

#### Scenario: variableCss uses dash-join names

- **WHEN** theme has nested mode aliases
- **THEN** `variableCss` SHALL contain dash-join CSS variable names in `:root` and `[data-color-mode]` blocks

#### Scenario: contextualVarsJson unchanged

- **WHEN** theme has contextual vars `{ colors: ['current-bg'] }`
- **THEN** `contextualVarsJson` SHALL contain `{ "colors": ["current-bg"] }`

### Requirement: System instance method rename

The SystemInstance serialization method SHALL be renamed from `.serialize()` to `.toConfig()` to disambiguate from the theme's `.serialize()`.

#### Scenario: ds.toConfig() returns system config

- **WHEN** consumer calls `ds.toConfig()`
- **THEN** the return value SHALL contain `{ propConfig, groupRegistry, transforms }`

#### Scenario: SerializedConfig type unchanged

- **WHEN** build tooling imports `SerializedConfig` from `@animus-ui/system`
- **THEN** it SHALL receive the type `{ propConfig: string; groupRegistry: string; transforms: Record<string, NamedTransform> }`

### Requirement: SerializedTheme type naming

The type for theme serialization SHALL remain `SerializedTheme`.

#### Scenario: SerializedTheme exported from system

- **WHEN** build tooling imports `SerializedTheme` from `@animus-ui/system`
- **THEN** it SHALL receive `{ scalesJson: string; variableMapJson: string; variableCss: string; contextualVarsJson: string }`

### Requirement: System module export detection

The plugin's `loadSystem` subprocess SHALL detect SystemInstance exports by interface (`toConfig()` method presence), not by name convention.

#### Scenario: Non-standard export name

- **WHEN** the system file exports `export const myDs = createSystem().build()` (not named `ds`, `default`, or `system`)
- **THEN** the subprocess SHALL detect `myDs` as a valid SystemInstance via its `.toConfig()` method

#### Scenario: No valid export found

- **WHEN** no export satisfies `.toConfig()`
- **THEN** the subprocess SHALL throw with a message listing all found export names and stating that none had a `.toConfig()` method

#### Scenario: Multiple candidates

- **WHEN** multiple exports satisfy `.toConfig()`
- **THEN** the subprocess SHALL throw with a message listing the candidate export names and asking the user to specify which one

### Requirement: Error message accuracy

Error messages from `loadSystem` SHALL reference the actual method being checked (`.toConfig()`), not a different method (`.serialize()`).

#### Scenario: Error message content

- **WHEN** the system module fails to load or has no valid SystemInstance
- **THEN** the error message SHALL reference `.toConfig()` and SHALL NOT reference `.serialize()`
