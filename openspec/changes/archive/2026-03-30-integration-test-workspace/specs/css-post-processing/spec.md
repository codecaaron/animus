## MODIFIED Requirements

### Requirement: Unit fallback converts bare numerics to px
The `applyUnitFallback` function SHALL append `px` to bare numeric values on CSS length properties. It MUST preserve unitless properties (flex, z-index, opacity, line-height, font-weight, order, etc.) and MUST NOT mangle values inside function calls (rgb(), calc(), cubic-bezier(), var(), etc.).

#### Scenario: Bare numeric on length property gets px
- **WHEN** `applyUnitFallback` receives CSS containing `padding: 8;`
- **THEN** it returns CSS containing `padding: 8px;`

#### Scenario: Unitless property preserved
- **WHEN** `applyUnitFallback` receives CSS containing `z-index: 10;` or `opacity: 0.5;`
- **THEN** the values are not modified

#### Scenario: Function call values preserved
- **WHEN** `applyUnitFallback` receives CSS containing `color: rgb(255, 0, 0);` or `width: calc(100% - 16);`
- **THEN** the numeric arguments inside function calls are not modified

#### Scenario: Multi-value shorthand
- **WHEN** `applyUnitFallback` receives CSS containing `margin: 8 16 8 16;`
- **THEN** it returns CSS containing `margin: 8px 16px 8px 16px;`

### Requirement: Transform placeholder resolution
The `resolveTransformPlaceholders` function SHALL replace `__TRANSFORM__{name}__{value}__` patterns in CSS with the result of calling the named transform function with the given value. It MUST handle both string and numeric return values from transform functions.

#### Scenario: Named transform resolves placeholder
- **WHEN** `resolveTransformPlaceholders` receives CSS containing `__TRANSFORM__size__4__` and a transforms map with a `size` function
- **THEN** the placeholder is replaced with the return value of `size(4)`

#### Scenario: Multiple transform placeholders in one CSS string
- **WHEN** CSS contains multiple `__TRANSFORM__` placeholders for different transforms
- **THEN** all placeholders are resolved using their respective transform functions

### Requirement: Prefix application namespaces CSS custom properties
The `applyPrefix` function SHALL prepend a namespace prefix to all CSS custom properties in the variable map and variable CSS. `--color-primary` with prefix `ds` MUST become `--ds-color-primary`.

#### Scenario: Variable map entries prefixed
- **WHEN** `applyPrefix("ds", variableMapJson, variableCss)` is called
- **THEN** all `--{name}` entries in the returned `variableMapJson` have `--ds-` prefix

#### Scenario: Variable CSS declarations prefixed
- **WHEN** `applyPrefix("ds", variableMapJson, variableCss)` is called
- **THEN** all custom property declarations and references in the returned `variableCss` have the `ds` prefix

### Requirement: Global styles resolution
The `resolveGlobalStyles` function SHALL resolve global style blocks by applying scale lookups, token alias resolution, and named transforms to produce final CSS strings. Token aliases using `{scale.path}` syntax MUST resolve to `var(--name)` when a variable map entry exists, or to the literal token value when it does not.

#### Scenario: Token alias resolves to CSS variable
- **WHEN** a global style block contains `color: '{colors.primary}'` and the variable map has an entry for `colors.primary`
- **THEN** the resolved CSS contains `color: var(--color-primary)`

#### Scenario: Token alias with alpha resolves to color-mix
- **WHEN** a global style block contains `background: '{colors.primary/50}'`
- **THEN** the resolved CSS contains `background: color-mix(in srgb, var(--color-primary) 50%, transparent)`

#### Scenario: Scale lookup resolves to token value
- **WHEN** a global style block contains a value matching a scale key and the scale has a corresponding entry
- **THEN** the value is resolved using the flat token map

#### Scenario: Named transform applied in global styles
- **WHEN** a global style block uses a property with an associated named transform
- **THEN** the transform function is applied to the value before CSS emission
