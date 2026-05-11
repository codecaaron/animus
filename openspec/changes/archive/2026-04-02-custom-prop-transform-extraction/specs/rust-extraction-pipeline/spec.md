## MODIFIED Requirements

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

#### Scenario: Props stage with inline transform function is extractable
- **WHEN** source contains `.props({ sizing: { property: 'flexBasis', transform: (v) => \`${v}px\` } })`
- **THEN** the style evaluator SHALL capture the function source text from the `transform` field and the chain SHALL be marked `extractable: true`

#### Scenario: Props stage with inline transform emits function body in replacement
- **WHEN** `.props({ sizing: { property: 'flexBasis', transform: (v) => \`${v}px\` } })` is extracted and `sizing` has dynamic JSX usage
- **THEN** the replacement JS SHALL contain the function body directly: `"transform":(v) => \`${v}px\`` — NOT a `transforms.name` registry reference
