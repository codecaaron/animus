### Requirement: System package owns ThemeBuilder and token utilities

The system package SHALL contain internal implementations of `ThemeBuilder`, `createTheme`, `serializeTokens`, and `flattenScale` in `system/src/theme/`. These modules SHALL have zero imports from `@animus-ui/core` or `@animus-ui/theming`.

#### Scenario: No external theming dependency

- **WHEN** the system package's `package.json` is inspected
- **THEN** it SHALL NOT contain `@animus-ui/theming` or `@animus-ui/core` as a dependency, devDependency, or peerDependency

#### Scenario: No transitive Emotion dependency

- **WHEN** a consumer installs `@animus-ui/system`
- **THEN** the resolved dependency tree SHALL NOT include `@emotion/react`, `@emotion/styled`, or `@emotion/is-prop-valid`

### Requirement: System package defines AbstractTheme and CSSObject locally

The system package SHALL define `AbstractTheme` and `CSSObject` types in its own type surface (`system/src/types/theme.ts`). These SHALL be structurally identical to the definitions in `@animus-ui/core`.

#### Scenario: AbstractTheme definition

- **WHEN** `AbstractTheme` is imported from `@animus-ui/system`
- **THEN** it SHALL be typed as `BaseTheme & { readonly [key: string]: any }`

#### Scenario: CSSObject definition

- **WHEN** `CSSObject` is imported from `@animus-ui/system`
- **THEN** it SHALL be typed as `{ [key: string]: string | number | CSSObject | undefined }`

#### Scenario: Structural compatibility with core types

- **WHEN** a value of type `CSSObject` from `@animus-ui/system` is assigned to a variable typed as `CSSObject` from `@animus-ui/core`
- **THEN** TypeScript SHALL accept the assignment without error (structural typing)

### Requirement: System re-exports theming utilities

The system package index SHALL re-export `createTheme`, `ThemeBuilder`, `flattenScale`, `serializeTokens`, and all associated type utilities (`KeyAsVariable`, `SanitizeKey`, `LiteralPaths`, `MergeTheme`, `Merge`, `PrivateThemeKeys`, `ColorModeConfig`, `FindPath`, `Path`, `PathValue`).

#### Scenario: createTheme available from system

- **WHEN** consumer writes `import { createTheme } from '@animus-ui/system'`
- **THEN** the import SHALL resolve successfully and `createTheme` SHALL return a `ThemeBuilder` instance

#### Scenario: ThemeBuilder available from system

- **WHEN** consumer writes `import { ThemeBuilder } from '@animus-ui/system'`
- **THEN** the import SHALL resolve successfully as the class type

#### Scenario: Type utilities available from system

- **WHEN** consumer writes `import type { KeyAsVariable, LiteralPaths, MergeTheme } from '@animus-ui/system'`
- **THEN** all type imports SHALL resolve successfully

### Requirement: ThemeBuilder API preserved

The internalized ThemeBuilder SHALL expose the identical fluent API as the theming package version: `.addColors()`, `.addColorModes()`, `.addScale()`, `.updateScale()`, `.build()`.

#### Scenario: Full theme construction chain

- **WHEN** consumer calls `createTheme(base).addColors({...}).addColorModes('light', {...}).addScale({ name: 'space', values: { sm: 4, md: 8 } }).build()`
- **THEN** the returned theme object SHALL contain `colors` (CSS var references), `_variables` (CSS var definitions), `_tokens` (raw values), and the added scale

#### Scenario: Color mode variable generation

- **WHEN** consumer calls `.addColorModes('light', { light: { primary: 'navy' }, dark: { primary: 'white' } })`
- **THEN** the theme SHALL contain `_variables.mode` with CSS var definitions for the initial mode, and `_tokens.modes` with raw values for all modes

#### Scenario: Scale flattening

- **WHEN** consumer calls `.addScale({ name: 'space', values: { sm: 4, md: 8, lg: { _: 16, xl: 24 } } })`
- **THEN** the theme SHALL contain `{ space: { sm: 4, md: 8, lg: 16, 'lg-xl': 24 } }` (underscore boundary, dash separator)

#### Scenario: Scale without emit (default)

- **WHEN** consumer calls `.addScale({ name: 'space', values: { sm: 4, md: 8 } })` (no `emit` field)
- **THEN** `emit` SHALL default to `false` — the scale values are available in the theme object but no CSS variable block is emitted

#### Scenario: Scale with emit enabled

- **WHEN** consumer calls `.addScale({ name: 'space', values: { sm: 4, md: 8 }, emit: true })`
- **THEN** the theme SHALL contain `_variables.space` with CSS variable definitions (e.g. `--space-sm: 4; --space-md: 8;`) and the scale SHALL appear in the emitted CSS variable block

#### Scenario: createScaleVariables removed

- **WHEN** consumer attempts to call `.createScaleVariables('space')` on a ThemeBuilder instance
- **THEN** TypeScript SHALL produce a type error — the method does not exist. Variable emission is instead controlled via `emit: true` in `.addScale()`
