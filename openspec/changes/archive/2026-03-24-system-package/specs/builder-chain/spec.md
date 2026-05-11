## MODIFIED Requirements

### Requirement: Progressive type accumulation via 8 generic parameters
The builder chain SHALL use 9 generic parameters (up from 8), with `T extends BaseTheme` as the first parameter on all 6 classes and AnimusExtended. T SHALL be set by the SystemBuilder's `.withTokens()` phase and threaded through all subsequent type operations. The generic signature SHALL be:

```
Animus<T, PropRegistry, GroupRegistry, BaseParser>
  → AnimusWithBase<T, PR, GR, BP, BaseStyles>
    → AnimusWithVariants<T, PR, GR, BP, BS, Variants>
      → AnimusWithStates<T, PR, GR, BP, BS, V, States>
        → AnimusWithSystem<T, PR, GR, BP, BS, V, S, ActiveGroups>
          → AnimusWithAll<T, PR, GR, BP, BS, V, S, AG, CustomProps>

AnimusExtended<T, PR, GR, BP, BS, V, S, AG, CP>
```

#### Scenario: Type parameters carry style values
- **WHEN** a component is created via `ds.styles({ color: 'primary', p: 8 })`
- **THEN** the BaseStyles generic SHALL capture the specific prop types, and T SHALL constrain `'primary'` to be a valid key of `T['colors']`

#### Scenario: Variant types accumulate across multiple calls
- **WHEN** `.variant()` is called multiple times in an extension chain
- **THEN** variant types SHALL merge, and T SHALL be preserved across all variant type accumulations

### Requirement: Terminal methods materialize configuration into components
Terminal methods (`.asElement()`, `.asComponent()`, `.build()`) SHALL produce components/handlers that are fully typed with T flowing through to prop types. Scale-resolved props SHALL autocomplete from `T[scale]`.

#### Scenario: asElement creates a styled HTML element
- **WHEN** `ds.styles({ bg: 'primary' }).asElement('div')` is called
- **THEN** the resulting component's `bg` prop SHALL autocomplete with `keyof T['colors']` values

#### Scenario: asComponent wraps an existing component
- **WHEN** `.asComponent(ExistingComponent)` is called
- **THEN** the resulting component SHALL carry T-derived prop types alongside the wrapped component's props

#### Scenario: Terminal components carry extend()
- **WHEN** `.extend()` is called on a terminal component
- **THEN** the AnimusExtended instance SHALL carry the same T, enabling scale-resolved autocomplete in extension styles

#### Scenario: build() produces a raw style function
- **WHEN** `.build()` is called instead of a terminal
- **THEN** the returned function's props SHALL be typed with T-derived scale values

## ADDED Requirements

### Requirement: No Emotion dependency in builder chain
The system package's builder chain SHALL NOT import from `@emotion/styled`, `@emotion/react`, or any Emotion package. Terminal methods SHALL produce configuration objects consumed by the extraction pipeline and runtime shim, not Emotion styled components.

#### Scenario: asElement produces extraction-compatible output
- **WHEN** `.asElement('div')` is called on the system package builder
- **THEN** the output SHALL be compatible with `createComponent()` from `@animus-ui/runtime`, not `styled()` from Emotion

#### Scenario: No ThemeProvider required
- **WHEN** a component created via the system builder is rendered
- **THEN** it SHALL NOT require an Emotion ThemeProvider in the React tree
