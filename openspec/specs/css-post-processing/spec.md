## Requirements

### Requirement: CSS post-processing function
The Vite plugin SHALL expose an internal `postProcessCss()` function that takes a CSS string, processing mode, and browser targets, and returns a processed CSS string. The function SHALL use Lightning CSS (`lightningcss` npm package) for minification and autoprefixing.

#### Scenario: Prod mode minifies and autoprefixes
- **WHEN** `postProcessCss(css, { minify: true, targets })` is called
- **THEN** the returned CSS SHALL be minified (whitespace removed, rules merged where safe) and vendor-prefixed for the specified targets

#### Scenario: Dev mode autoprefixes without minifying
- **WHEN** `postProcessCss(css, { minify: false, targets })` is called
- **THEN** the returned CSS SHALL have vendor prefixes added but formatting preserved (no whitespace removal, no rule merging)

#### Scenario: No targets specified
- **WHEN** `postProcessCss()` is called with no explicit targets
- **THEN** the function SHALL use the resolved default targets (browserslist query or built-in defaults)

### Requirement: @layer preservation
Lightning CSS post-processing SHALL preserve `@layer` block structure and ordering. The six cascade layers (`global`, `base`, `variants`, `states`, `system`, `custom`) SHALL appear in the output in the same order as the input.

#### Scenario: Layer declaration preserved
- **WHEN** input CSS contains `@layer global, base, variants, states, system, custom;`
- **THEN** the output CSS SHALL contain an equivalent layer declaration with the same order

#### Scenario: Layer blocks not merged across names
- **WHEN** input CSS contains separate `@layer base { ... }` and `@layer system { ... }` blocks
- **THEN** the output CSS SHALL preserve them as separate blocks (Lightning CSS only merges adjacent blocks with identical names)

#### Scenario: Layer block content minified
- **WHEN** prod mode processes `@layer base { .comp { display: flex; flex-direction: column; } }`
- **THEN** the layer block wrapper is preserved while internal rules are minified

### Requirement: CSS custom property preservation
Lightning CSS post-processing SHALL NOT resolve, inline, or remove CSS custom properties (`var()` references). All `var(--animus-*)` references and `:root` variable declarations SHALL pass through untouched.

#### Scenario: var() references preserved
- **WHEN** input CSS contains `color: var(--colors-primary);`
- **THEN** the output CSS SHALL contain the same `var()` reference

#### Scenario: Dynamic slot variables preserved
- **WHEN** input CSS contains `padding: var(--animus-p);` in a slot class
- **THEN** the output CSS SHALL contain the same `var()` reference

#### Scenario: Root variable declarations preserved
- **WHEN** input CSS contains `:root { --colors-primary: #ff2800; }`
- **THEN** the output CSS SHALL contain the same declaration

### Requirement: Vendor prefix insertion
Lightning CSS SHALL add vendor prefixes based on the configured browser targets. Only prefixes required by the target browsers SHALL be inserted.

#### Scenario: backdrop-filter prefixed for Safari
- **WHEN** targets include Safari 15 and input CSS contains `backdrop-filter: blur(8px);`
- **THEN** the output CSS SHALL include `-webkit-backdrop-filter: blur(8px);`

#### Scenario: No unnecessary prefixes
- **WHEN** targets only include Chrome 100+ and input CSS contains `display: flex;`
- **THEN** the output CSS SHALL NOT add `-webkit-` prefix (Chrome 100 supports unprefixed flex)

#### Scenario: user-select prefixed where needed
- **WHEN** targets include browsers requiring prefix and input CSS contains `user-select: none;`
- **THEN** the output CSS SHALL include the appropriate vendor-prefixed version

### Requirement: Minification behavior
In prod mode, Lightning CSS minification SHALL reduce CSS size by removing whitespace, merging adjacent rules with identical selectors or declarations, folding longhands into shorthands where safe, and simplifying color values.

#### Scenario: Whitespace removal
- **WHEN** prod mode processes multi-line indented CSS
- **THEN** unnecessary whitespace and newlines are removed

#### Scenario: Adjacent rule merging
- **WHEN** two adjacent rules have identical selectors
- **THEN** their declarations are merged into a single rule

#### Scenario: Color simplification
- **WHEN** input CSS contains `color: rgb(255, 40, 0);`
- **THEN** the output CSS MAY contain a shorter equivalent (e.g., `color: #ff2800`)

#### Scenario: Longhand folding
- **WHEN** input CSS contains `margin-top: 0; margin-right: 0; margin-bottom: 0; margin-left: 0;` in the same rule
- **THEN** the output CSS MAY contain `margin: 0` instead

### Requirement: Graceful degradation on error
If Lightning CSS processing fails for any reason, the plugin SHALL fall back to serving the unprocessed CSS and emit a console warning. A post-processing failure SHALL NOT block the dev server or production build.

#### Scenario: Malformed CSS input
- **WHEN** the extraction pipeline produces CSS that Lightning CSS cannot parse
- **THEN** the unprocessed CSS is served and a warning is logged

#### Scenario: Lightning CSS import failure
- **WHEN** the `lightningcss` package is missing or fails to load
- **THEN** the unprocessed CSS is served and a warning is logged at plugin initialization

#### Scenario: Warning includes context
- **WHEN** post-processing fails
- **THEN** the warning message SHALL include the error details and indicate which CSS path (styles.css or components) was affected

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
