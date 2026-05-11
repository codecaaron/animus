## MODIFIED Requirements

### Requirement: NAPI function signature
The Rust crate SHALL export a single NAPI function `extract(source: String, filename: String, theme_json: String, config_json: String, group_registry_json: String) -> ExtractionResult` where `ExtractionResult` contains `css: String`, `code: String`, `source_map: String`, `components: Vec<ComponentDescriptor>`, `extractable: bool`, and `errors: Vec<String>`.

#### Scenario: Successful extraction
- **WHEN** `extract()` is called with valid TS/TSX source containing an extractable builder chain
- **THEN** the result SHALL have `extractable: true`, `css` containing @layer-structured CSS, `code` containing the transformed source with shim imports, and `components` describing each extracted component

#### Scenario: Non-extractable chain
- **WHEN** `extract()` is called with source containing a chain with `.extend()` or `.asComponent()`, template literals with expressions, or function values
- **THEN** the result SHALL have `extractable: false`, `code` identical to the input source, empty `css`, and `errors` containing the bail reason

#### Scenario: No chains in file
- **WHEN** `extract()` is called with source that contains no `animus.` chain expressions
- **THEN** the result SHALL have `extractable: false`, `code` identical to input, empty `css`, and empty `errors`

#### Scenario: Chain with groups is extractable
- **WHEN** `extract()` is called with source containing `animus.styles({...}).groups({ space: true }).asElement('div')` and JSX elements using system props
- **THEN** the result SHALL have `extractable: true`, `css` containing both component layer CSS and utility CSS in `@layer system`, and `code` containing `createComponent()` with system prop class map

#### Scenario: Chain with props is extractable
- **WHEN** `extract()` is called with source containing `animus.styles({...}).props({ logoSize: {...} }).asElement('h1')` and JSX elements using custom props
- **THEN** the result SHALL have `extractable: true`, `css` containing utility CSS in `@layer custom`

### Requirement: Chain walking from terminals
The chain walker SHALL find all `.asElement(tag)` terminal calls in the AST, walk backwards through the method chain to the `animus` root, and collect each stage's argument spans. The walker SHALL recognize the chain pattern: `animus` followed by zero or more of `.styles()`, `.variant()`, `.states()`, `.groups()`, `.props()`, terminated by `.asElement(tag)` or `.asComponent(component)`.

#### Scenario: Walk styles-variant-asElement chain
- **WHEN** source contains `animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the walker SHALL produce a chain descriptor with `terminal: "asElement"`, `tag: "button"`, stages `styles` and `variants` each referencing their argument AST nodes

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

#### Scenario: Bail on asComponent terminal
- **WHEN** source contains `animus.styles({...}).asComponent(Link)`
- **THEN** the walker SHALL mark the chain as non-extractable with reason "asComponent terminal not supported"

#### Scenario: Bail on extend stage
- **WHEN** source contains a chain involving `.extend()`
- **THEN** the walker SHALL mark the chain as non-extractable with reason "extend stage not supported"

#### Scenario: Multiple chains in one file
- **WHEN** source contains multiple independent `animus.` chains (e.g., `ButtonContainer` and `ButtonForeground`)
- **THEN** the walker SHALL produce a separate chain descriptor for each, and each SHALL be independently extractable or bailable
