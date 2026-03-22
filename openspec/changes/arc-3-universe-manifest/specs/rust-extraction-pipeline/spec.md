## MODIFIED Requirements

### Requirement: Chain walking from terminals
The chain walker SHALL find all `.asElement(tag)` and `.asComponent(component)` terminal calls in the AST, walk backwards through the method chain, and collect each stage's argument spans. The walker SHALL recognize TWO chain patterns:

1. **Primary chains**: `animus` root followed by zero or more stages, terminated by `.asElement(tag)` or `.asComponent(component)`
2. **Extension chains**: A component binding root (any identifier that is NOT `animus`), followed by `.extend()`, followed by zero or more stages, terminated by `.asElement(tag)` or `.asComponent(component)`

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

### Requirement: ChainDescriptor extension fields
The `ChainDescriptor` struct SHALL include an `extends_from: Option<String>` field containing the identifier name of the parent component when the chain is an extension chain. For primary chains (rooted at `animus`), this field SHALL be `None`.

#### Scenario: Primary chain has no extends_from
- **WHEN** a chain starts from `animus`
- **THEN** `extends_from` SHALL be `None`

#### Scenario: Extension chain has extends_from
- **WHEN** a chain starts from `Button.extend()`
- **THEN** `extends_from` SHALL be `Some("Button")`
