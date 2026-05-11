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

### Requirement: Source replacement
The source replacer SHALL replace the entire chain expression (from `animus.` root to terminal) with a `createComponent()` call importing from `@animus-ui/runtime`, and add a CSS import for the extracted stylesheet. When ALL named bindings from an import statement have been replaced by extraction, the replacer SHALL remove that import statement from the output.

#### Scenario: Replace asElement chain
- **WHEN** source has `export const Button = animus.styles({...}).variant({...}).asElement('button')`
- **THEN** the transformed source SHALL contain an import of `createComponent` from `@animus-ui/runtime`, an import of the CSS file, and `export const Button = createComponent('button', 'animus-Button-hash', { variants: { variant: { options: ['fill', 'stroke'], default: undefined } } })`

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
