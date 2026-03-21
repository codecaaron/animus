## ADDED Requirements

### Requirement: NAPI function signature
The Rust crate SHALL export a single NAPI function `extract(source: String, filename: String, theme_json: String, config_json: String) -> ExtractionResult` where `ExtractionResult` contains `css: String`, `code: String`, `source_map: String`, `components: Vec<ComponentDescriptor>`, `extractable: bool`, and `errors: Vec<String>`.

#### Scenario: Successful extraction
- **WHEN** `extract()` is called with valid TS/TSX source containing an extractable builder chain
- **THEN** the result SHALL have `extractable: true`, `css` containing @layer-structured CSS, `code` containing the transformed source with shim imports, and `components` describing each extracted component

#### Scenario: Non-extractable chain
- **WHEN** `extract()` is called with source containing a chain with `.groups()`, `.extend()`, `.asComponent()`, `.props()`, template literals with expressions, or function values
- **THEN** the result SHALL have `extractable: false`, `code` identical to the input source, empty `css`, and `errors` containing the bail reason

#### Scenario: No chains in file
- **WHEN** `extract()` is called with source that contains no `animus.` chain expressions
- **THEN** the result SHALL have `extractable: false`, `code` identical to input, empty `css`, and empty `errors`

### Requirement: Chain walking from terminals
The chain walker SHALL find all `.asElement(tag)` terminal calls in the AST, walk backwards through the method chain to the `animus` root, and collect each stage's argument spans. The walker SHALL recognize the chain pattern: `animus` followed by zero or more of `.styles()`, `.variant()`, `.states()`, `.groups()`, `.props()`, terminated by `.asElement(tag)` or `.asComponent(component)`.

#### Scenario: Walk styles-variant-asElement chain
- **WHEN** source contains `animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the walker SHALL produce a chain descriptor with `terminal: "asElement"`, `tag: "button"`, stages `styles` and `variants` each referencing their argument AST nodes

#### Scenario: Walk variant-only chain
- **WHEN** source contains `animus.variant({...}).variant({...}).asElement('span')`
- **THEN** the walker SHALL produce a chain descriptor with two variant entries merged (matching lodash `merge` semantics in the runtime)

#### Scenario: Bail on groups stage
- **WHEN** source contains `animus.styles({...}).groups({...}).asElement('div')`
- **THEN** the walker SHALL mark the chain as non-extractable with reason "groups stage not supported in Arc 1"

#### Scenario: Bail on asComponent terminal
- **WHEN** source contains `animus.styles({...}).asComponent(Link)`
- **THEN** the walker SHALL mark the chain as non-extractable with reason "asComponent terminal not supported in Arc 1"

#### Scenario: Multiple chains in one file
- **WHEN** source contains multiple independent `animus.` chains (e.g., `ButtonContainer` and `ButtonForeground`)
- **THEN** the walker SHALL produce a separate chain descriptor for each, and each SHALL be independently extractable or bailable

### Requirement: Static style evaluation
The style evaluator SHALL convert ObjectExpression AST nodes to key-value style maps. It SHALL handle string literals, numeric literals, nested object literals (for pseudo-selectors and responsive values), and array literals. It SHALL bail on function calls, variable references, template literals containing expressions, spread elements, and computed property keys.

#### Scenario: Evaluate simple style object
- **WHEN** the evaluator processes `{ p: 0, display: 'inline-flex', borderRadius: 4 }`
- **THEN** it SHALL produce `{ "p": 0, "display": "inline-flex", "borderRadius": 4 }`

#### Scenario: Evaluate nested pseudo-selector
- **WHEN** the evaluator processes `{ '&:hover': { color: 'primary' } }`
- **THEN** it SHALL produce `{ "&:hover": { "color": "primary" } }`

#### Scenario: Evaluate responsive object
- **WHEN** the evaluator processes `{ fontSize: { _: 16, xs: 18 } }`
- **THEN** it SHALL produce `{ "fontSize": { "_": 16, "xs": 18 } }` (responsive resolution happens in CSS generation)

#### Scenario: Bail on template literal with expression
- **WHEN** the evaluator encounters `` animation: `${flow} 5s linear 1s infinite` ``
- **THEN** it SHALL mark the value as non-static and the entire chain SHALL bail

#### Scenario: Bail on variable reference
- **WHEN** the evaluator encounters `color: someVariable`
- **THEN** it SHALL mark the value as non-static and the entire chain SHALL bail

### Requirement: Theme scale resolution
The theme resolver SHALL accept a flattened theme JSON map (`{ "scale_name.key": "css_value" }`) and resolve style values against it. For each style property, the resolver SHALL look up the prop config to determine the CSS property name, scale name, and transform identifier.

#### Scenario: Resolve scale lookup
- **WHEN** prop is `p` with value `8`, config says `{ property: "padding", scale: "space" }`, and theme has `{ "space.8": "0.5rem" }`
- **THEN** the resolver SHALL produce `{ "padding": "0.5rem" }`

#### Scenario: Resolve color mode variable
- **WHEN** prop is `color` with value `"background"`, config says `{ property: "color", scale: "colors" }`, and theme has `{ "colors.background": "var(--colors-background)" }`
- **THEN** the resolver SHALL produce `{ "color": "var(--colors-background)" }`

#### Scenario: Apply size transform
- **WHEN** prop is `width` with value `1`, config says `{ property: "width", transform: "size" }`
- **THEN** the resolver SHALL apply the `size` transform: `size(1)` → `percentageOrAbsolute(1)` → `"100%"`, producing `{ "width": "100%" }`

#### Scenario: Apply size transform to zero
- **WHEN** prop is `inset` with value `0`, config says `{ properties: ["top","right","bottom","left"], transform: "size" }`
- **THEN** the resolver SHALL produce `{ "top": 0, "right": 0, "bottom": 0, "left": 0 }` (zero passes through unchanged)

#### Scenario: Apply borderShorthand transform
- **WHEN** prop is `border` with value `'none'`, config says `{ property: "border", scale: "borders", transform: "borderShorthand" }`
- **THEN** the resolver SHALL look up scale first; if scale value exists use it, otherwise pass string through as-is producing `{ "border": "none" }`

#### Scenario: Apply gridItemRatio transform
- **WHEN** prop is `cols` with value `'15rem:1'`, config says `{ property: "gridTemplateColumns", transform: "gridItemRatio" }`
- **THEN** the resolver SHALL produce `{ "gridTemplateColumns": "minmax(0, 15rem) minmax(0, 1fr)" }`

#### Scenario: Multi-property expansion
- **WHEN** prop is `px` with value `16`, config says `{ property: "padding", properties: ["paddingLeft", "paddingRight"], scale: "space" }`, and theme has `{ "space.16": "1rem" }`
- **THEN** the resolver SHALL produce `{ "paddingLeft": "1rem", "paddingRight": "1rem" }`

#### Scenario: No scale defined
- **WHEN** prop is `display` with value `"flex"`, config says `{ property: "display" }` (no scale)
- **THEN** the resolver SHALL pass through the value as-is: `{ "display": "flex" }`

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
- **THEN** the CSS output SHALL begin with `@layer base, variants, states, system, custom;` to establish layer precedence

### Requirement: Source replacement
The source replacer SHALL replace the entire chain expression (from `animus.` root to terminal) with a `createComponent()` call importing from `@animus-ui/runtime`, and add a CSS import for the extracted stylesheet.

#### Scenario: Replace asElement chain
- **WHEN** source has `export const Button = animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the transformed source SHALL contain an import of `createComponent` from `@animus-ui/runtime`, an import of the CSS file, and `export const Button = createComponent('button', 'animus-Button-hash', { variants: { variant: { options: ['fill', 'stroke'], default: undefined } } })`

#### Scenario: Preserve non-chain code
- **WHEN** source has code before and after the chain expression (imports, other exports, JSX components)
- **THEN** the transformed source SHALL preserve all non-chain code exactly, only replacing the chain expression itself

#### Scenario: Multiple chains in one file
- **WHEN** source has `const A = animus.styles({...}).asElement('div')` and `const B = animus.styles({...}).asElement('span')`
- **THEN** both SHALL be replaced with separate `createComponent()` calls, and the CSS import SHALL include styles for both components

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
