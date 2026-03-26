### Requirement: NAPI function signature
The Rust crate SHALL export THREE NAPI functions:
1. `extract(source, filename, theme_json, config_json, group_registry_json) -> ExtractionResult` — per-file extraction (preserved for backward compatibility and testing)
2. `analyze_project(file_entries_json, theme_json, config_json, group_registry_json) -> String` — project-level analysis returning JSON manifest
3. `transform_file(source, filename, manifest_json) -> TransformResult` — per-file transformation using manifest

#### Scenario: Backward-compatible extract
- **WHEN** `extract()` is called with a file containing only primary chains (no extensions)
- **THEN** it SHALL produce the same result as Arc 2 — CSS, transformed code, extractable flag, errors

#### Scenario: analyze_project with extensions
- **WHEN** `analyze_project()` is called with files containing extension chains
- **THEN** the returned manifest JSON SHALL contain all components (primary and extended), resolved provenance, merged chain configs, and complete CSS

#### Scenario: transform_file uses manifest
- **WHEN** `transform_file()` is called with a file and a manifest
- **THEN** it SHALL look up the file's components in the manifest and apply source replacements using the manifest's precomputed class names and configs

#### Scenario: Chain with groups is extractable
- **WHEN** `extract()` is called with source containing `animus.styles({...}).groups({ space: true }).asElement('div')` and JSX elements using system props
- **THEN** the result SHALL have `extractable: true`, `css` containing both component layer CSS and utility CSS in `@layer system`, and `code` containing `createComponent()` with system prop class map

#### Scenario: Chain with props is extractable
- **WHEN** `extract()` is called with source containing `animus.styles({...}).props({ logoSize: {...} }).asElement('h1')` and JSX elements using custom props
- **THEN** the result SHALL have `extractable: true`, `css` containing utility CSS in `@layer custom`

### Requirement: Chain walking from terminals
The chain walker SHALL find all `.asElement(tag)` and `.asComponent(component)` terminal calls in the AST, walk backwards through the method chain, and collect each stage's argument spans. The walker SHALL recognize TWO chain patterns:

1. **Primary chains**: `animus` root followed by zero or more stages, terminated by `.asElement(tag)` or `.asComponent(component)`
2. **Extension chains**: A component binding root (any identifier that is NOT `animus`), followed by `.extend()`, followed by zero or more stages, terminated by `.asElement(tag)` or `.asComponent(component)`

The walker SHALL bail with `extractable: false` when encountering a method call that is not in the known `CHAIN_METHODS` set, not in the `BAIL_METHODS` set, and is not a recognized terminal or extension marker.

#### Scenario: Walk styles-variant-asElement chain
- **WHEN** source contains `animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the walker SHALL produce a chain descriptor with `terminal: "asElement"`, `tag: "button"`, stages `styles` and `variants`, and `extends_from: None`

#### Scenario: Walk extension chain
- **WHEN** source contains `Button.extend().styles({ borderRadius: 8 }).asElement('button')`
- **THEN** the walker SHALL produce a chain descriptor with `terminal: "asElement"`, `tag: "button"`, stages containing `styles`, and `extends_from: Some("Button")`

#### Scenario: Walk extension chain with asComponent terminal
- **WHEN** source contains `Link.extend().states({ active: {} }).asComponent(NextLink)`
- **THEN** the walker SHALL produce a chain descriptor with `terminal: "asComponent"`, `tag: "NextLink"`, stages containing `states`, and `extends_from: Some("Link")`

#### Scenario: Extension chain is extractable
- **WHEN** source contains an extension chain with statically evaluable stages
- **THEN** the chain SHALL be marked `extractable: true` — `.extend()` on a component binding is NO LONGER a bail condition

#### Scenario: Extension with non-static stages still bails
- **WHEN** source contains `Button.extend().styles({ color: dynamicVar }).asElement('button')`
- **THEN** the chain SHALL bail with reason "variable reference (non-static)" — same bail rules as primary chains

#### Scenario: Bare .extend() in animus chain still bails
- **WHEN** source contains `animus.styles({...}).extend(SomeComponent).asElement('div')` (extend as a STAGE, not as a chain root pattern)
- **THEN** the chain SHALL bail — `.extend()` as a mid-chain call with an argument is not the same as the `.extend()` root pattern

#### Scenario: Multiple chains including extensions in one file
- **WHEN** source contains both `const A = animus.styles({...}).asElement('div')` and `const B = A.extend().styles({...}).asElement('div')`
- **THEN** the walker SHALL produce two chain descriptors: A as a primary chain, B as an extension chain with `extends_from: Some("A")`

#### Scenario: Walk variant-only chain
- **WHEN** source contains `animus.variant({...}).variant({...}).asElement('span')`
- **THEN** the walker SHALL produce a chain descriptor with two variant entries merged (matching lodash `merge` semantics in the runtime)

#### Scenario: Walk chain with groups stage
- **WHEN** source contains `animus.styles({...}).groups({ space: true, layout: true }).asElement('div')`
- **THEN** the walker SHALL produce a chain descriptor with a `groups` stage containing active group names `["space", "layout"]` and the chain SHALL be marked extractable

#### Scenario: Walk chain with props stage
- **WHEN** source contains `animus.styles({...}).props({ logoSize: { property: 'fontSize', scale: { xs: 28, sm: 32 } } }).asElement('h1')`
- **THEN** the walker SHALL produce a chain descriptor with a `props` stage containing the custom prop configuration and the chain SHALL be marked extractable

#### Scenario: Walk chain with both groups and props
- **WHEN** source contains `animus.styles({...}).groups({ space: true }).props({ custom: {...} }).asElement('div')`
- **THEN** the walker SHALL produce a chain descriptor with both `groups` and `props` stages and the chain SHALL be marked extractable

#### Scenario: Multiple chains in one file
- **WHEN** source contains multiple independent `animus.` chains (e.g., `ButtonContainer` and `ButtonForeground`)
- **THEN** the walker SHALL produce a separate chain descriptor for each, and each SHALL be independently extractable or bailable

#### Scenario: Unknown method causes bail
- **WHEN** source contains `animus.styles({...}).unknownMethod({...}).asElement('div')`
- **THEN** the walker SHALL set `extractable: false` with bail reason containing "unknown chain method: unknownMethod"

#### Scenario: Future method on extension chain causes bail
- **WHEN** source contains `Button.extend().styles({...}).futureAPI({...}).asElement('button')`
- **THEN** the walker SHALL set `extractable: false` with bail reason containing "unknown chain method: futureAPI"

### Requirement: Static style evaluation
The style evaluator SHALL convert ObjectExpression AST nodes to key-value style maps. It SHALL handle string literals, numeric literals, nested object literals (for pseudo-selectors and responsive values), and array literals. When encountering a property whose value is a function call, variable reference, template literal containing expressions, or member expression, the evaluator SHALL skip that individual property and continue evaluating remaining properties. It SHALL bail the entire object only on structural issues: spread elements, computed property keys, and getter/setter properties.

#### Scenario: Evaluate simple style object
- **WHEN** the evaluator processes `{ p: 0, display: 'inline-flex', borderRadius: 4 }`
- **THEN** it SHALL produce `{ "p": 0, "display": "inline-flex", "borderRadius": 4 }`

#### Scenario: Evaluate nested pseudo-selector
- **WHEN** the evaluator processes `{ '&:hover': { color: 'primary' } }`
- **THEN** it SHALL produce `{ "&:hover": { "color": "primary" } }`

#### Scenario: Evaluate responsive object
- **WHEN** the evaluator processes `{ fontSize: { _: 16, xs: 18 } }`
- **THEN** it SHALL produce `{ "fontSize": { "_": 16, "xs": 18 } }` (responsive resolution happens in CSS generation)

#### Scenario: Skip property with template literal expression
- **WHEN** the evaluator encounters `{ animation: \`${flow} 5s\`, color: 'red' }`
- **THEN** it SHALL skip `animation`, produce `{ "color": "red" }`, and report a skip warning for `animation`

#### Scenario: Skip property with variable reference
- **WHEN** the evaluator encounters `{ color: someVariable, display: 'flex' }`
- **THEN** it SHALL skip `color`, produce `{ "display": "flex" }`, and report a skip warning for `color`

#### Scenario: Bail on spread (structural)
- **WHEN** the evaluator encounters `{ ...baseStyles, color: 'red' }`
- **THEN** the entire object SHALL bail — spread affects object shape

#### Scenario: Bail on computed key (structural)
- **WHEN** the evaluator encounters `{ [dynamicKey]: 'red' }`
- **THEN** the entire object SHALL bail — computed keys affect object shape

### Requirement: Theme scale resolution
The theme resolver SHALL accept a flattened theme JSON map (`{ "scale_name.key": "css_value" }`) AND a variable-name map (`{ "token_path": "css_variable_name" }`) and resolve style values against them. For each style property, the resolver SHALL look up the prop config to determine the CSS property name, scale name, and transform identifier. When a prop config has a `transform` field, the resolver SHALL emit the resolved value (after scale lookup) WITHOUT applying the transform, and SHALL include the transform name in the output metadata. Transform application is deferred to the Vite plugin's JS post-processing step. When a resolved string value (after scale lookup) contains `{...}` token alias patterns, the resolver SHALL resolve each alias using the variable-name map and flat value map before emitting the CSS declaration.

#### Scenario: Resolve scale lookup
- **WHEN** prop is `p` with value `8`, config says `{ property: "padding", scale: "space" }`, and theme has `{ "space.8": "0.5rem" }`
- **THEN** the resolver SHALL produce `{ "padding": "0.5rem" }`

#### Scenario: Resolve color mode variable
- **WHEN** prop is `color` with value `"background"`, config says `{ property: "color", scale: "colors" }`, and theme has `{ "colors.background": "var(--colors-background)" }`
- **THEN** the resolver SHALL produce `{ "color": "var(--colors-background)" }`

#### Scenario: Emit raw value with transform metadata
- **WHEN** prop is `width` with value `1`, config says `{ property: "width", transform: "size" }`
- **THEN** the resolver SHALL emit `{ "width": 1 }` as the raw value AND include metadata `{ property: "width", transform: "size", raw_value: 1 }` for post-processing

#### Scenario: Scale lookup before transform deferral
- **WHEN** prop is `borderRadius` with value `4`, config says `{ property: "borderRadius", scale: "radii", transform: "size" }`, and theme has `{ "radii.4": "4" }`
- **THEN** the resolver SHALL look up the scale first (getting `"4"`), then emit that as the raw value with transform metadata `{ property: "borderRadius", transform: "size", raw_value: "4" }` — scale resolution happens in Rust, transform application happens in JS

#### Scenario: No scale defined, transform deferred
- **WHEN** prop is `top` with value `100`, config says `{ property: "top", transform: "size" }` (no scale)
- **THEN** the resolver SHALL emit `{ "top": 100 }` as the raw value with transform metadata — no scale lookup, transform deferred

#### Scenario: No transform, value passes through
- **WHEN** prop is `display` with value `"flex"`, config says `{ property: "display" }` (no scale, no transform)
- **THEN** the resolver SHALL produce `{ "display": "flex" }` with no transform metadata

#### Scenario: Multi-property expansion with transform deferred
- **WHEN** prop is `inset` with value `0`, config says `{ properties: ["top","right","bottom","left"], transform: "size" }`
- **THEN** the resolver SHALL emit raw values for all four properties with transform metadata for each

#### Scenario: String value with token alias resolved during theme resolution
- **WHEN** prop is `border` with value `"1px solid {colors.primary}"`, config has no scale for `border`, variable map has `"colors.primary" → "--colors-primary"`
- **THEN** the resolver SHALL scan the string for `{...}` patterns, resolve `{colors.primary}` to `var(--colors-primary)`, and produce `{ "border": "1px solid var(--colors-primary)" }`

#### Scenario: Token alias with alpha in compound value
- **WHEN** prop is `boxShadow` with value `"0 4px 12px {colors.primary/20}"`, variable map has `"colors.primary" → "--colors-primary"`
- **THEN** the resolver SHALL resolve `{colors.primary/20}` to `color-mix(in srgb, var(--colors-primary) 20%, transparent)` and produce the complete compound CSS value

### Requirement: CSS generation with @layer
The CSS generator SHALL produce CSS structured with shared `@layer` declarations. Base styles go in `@layer base`, variant styles in `@layer variants`, state styles in `@layer states`. Responsive values SHALL be emitted as `@media` queries within their respective layers. Pseudo-selectors SHALL be emitted as nested selectors within class rules.

#### Scenario: Generate base styles
- **WHEN** a chain has `.styles({ padding: '0.5rem', display: 'inline-flex' })`
- **THEN** the CSS output SHALL contain `@layer base { .animus-Name-hash { padding: 0.5rem; display: inline-flex; } }`

#### Scenario: Generate variant styles
- **WHEN** a chain has `.variant({ variants: { fill: { color: 'var(--colors-background)' }, stroke: { border: '1px solid' } } })`
- **THEN** the CSS output SHALL contain `@layer variants { .animus-Name-hash--variant-fill { color: var(--colors-background); } .animus-Name-hash--variant-stroke { border: 1px solid; } }`

#### Scenario: Generate state styles
- **WHEN** a chain has `.states({ loading: { opacity: 0 }, disabled: { cursor: 'not-allowed' } })`
- **THEN** the CSS output SHALL contain `@layer states { .animus-Name-hash--loading { opacity: 0; } .animus-Name-hash--disabled { cursor: not-allowed; } }`

#### Scenario: Generate responsive @media
- **WHEN** a chain has `.styles({ fontSize: { _: '1rem', sm: '1.125rem' } })` and breakpoints has `{ sm: 768 }`
- **THEN** the CSS output SHALL contain the default value outside any media query AND `@media (min-width: 768px) { .animus-Name-hash { font-size: 1.125rem; } }` within `@layer base`

#### Scenario: Generate pseudo-selector
- **WHEN** a chain has `.styles({ '&:hover': { color: 'var(--colors-primary)' } })`
- **THEN** the CSS output SHALL contain `.animus-Name-hash:hover { color: var(--colors-primary); }` within `@layer base`

#### Scenario: Generate variant with pseudo-selector
- **WHEN** a variant option contains `{ '&:before': { content: '""', position: 'absolute' } }`
- **THEN** the CSS output SHALL contain `.animus-Name-hash--variant-stroke::before { content: ""; position: absolute; }` within `@layer variants`

#### Scenario: @layer declaration order
- **WHEN** any extraction produces CSS
- **THEN** the CSS output SHALL begin with `@layer global, base, variants, states, system, custom;` to establish layer precedence

### Requirement: Source replacement
The source replacer SHALL replace the entire chain expression (from `animus.` root to terminal) with a `createComponent()` call importing from `@animus-ui/system`, and add a CSS import for the extracted stylesheet. When ALL named bindings from an import statement have been replaced by extraction, the replacer SHALL remove that import statement from the output.

#### Scenario: Replace asElement chain
- **WHEN** source has `export const Button = animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the transformed source SHALL contain an import of `createComponent` from `@animus-ui/system`, an import of the CSS file, and `export const Button = createComponent('button', 'animus-Button-hash', { variants: { variant: { options: ['fill', 'stroke'], default: undefined } } })`

#### Scenario: Preserve non-chain code
- **WHEN** source has code before and after the chain expression (imports, other exports, JSX components)
- **THEN** the transformed source SHALL preserve all non-chain code exactly, only replacing the chain expression itself

#### Scenario: Multiple chains in one file
- **WHEN** source has `const A = animus.styles({...}).asElement('div')` and `const B = animus.styles({...}).asElement('span')`
- **THEN** both SHALL be replaced with separate `createComponent()` calls, and the CSS import SHALL include styles for both components

#### Scenario: Dead import removal when all bindings replaced
- **WHEN** source has `import { animus } from '@animus-ui/core'` and the `animus` binding's chain is fully extracted
- **THEN** the transformed source SHALL NOT contain the `import { animus } from '@animus-ui/core'` statement

#### Scenario: Partial import preservation
- **WHEN** source has `import { animus, createParser } from '@animus-ui/core'` and only `animus` chains are extracted
- **THEN** the transformed source SHALL preserve the import (because `createParser` may still be used)

### Requirement: Deterministic class names
Class names SHALL follow the pattern `animus-{binding}-{hash}` where `binding` is the JavaScript variable name the chain is assigned to, and `hash` is an 8-character content hash of the normalized chain descriptor.

#### Scenario: Stable across builds
- **WHEN** the same source file is extracted in two separate builds without changes
- **THEN** the generated class names SHALL be identical

#### Scenario: Unique per chain
- **WHEN** two different chains exist in the same file with different styles
- **THEN** each SHALL receive a distinct class name

#### Scenario: Binding name in class
- **WHEN** source has `const ButtonContainer = animus.styles({...}).asElement('button')`
- **THEN** the class name SHALL start with `animus-ButtonContainer-`

### Requirement: ChainDescriptor extension fields
The `ChainDescriptor` struct SHALL include an `extends_from: Option<String>` field containing the identifier name of the parent component when the chain is an extension chain. For primary chains (rooted at `animus`), this field SHALL be `None`.

#### Scenario: Primary chain has no extends_from
- **WHEN** a chain starts from `animus`
- **THEN** `extends_from` SHALL be `None`

#### Scenario: Extension chain has extends_from
- **WHEN** a chain starts from `Button.extend()`
- **THEN** `extends_from` SHALL be `Some("Button")`
