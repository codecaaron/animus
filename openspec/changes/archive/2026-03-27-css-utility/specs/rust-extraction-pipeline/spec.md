## MODIFIED Requirements

### Requirement: Chain walker recognizes `.asClass()` terminal
The Rust extraction pipeline SHALL recognize `.asClass()` as a valid terminal method alongside `.asElement()` and `.asComponent()`. Chains ending in `.asClass()` SHALL be fully extracted.

#### Scenario: `.asClass()` chain detected
- **WHEN** the chain walker encounters `identifier.styles({...}).asClass()`
- **THEN** it SHALL identify this as a complete extractable chain with terminal type `AsClass`

#### Scenario: `.asClass()` chain with full pipeline
- **WHEN** a `.styles().variant().states().groups().asClass()` chain is found
- **THEN** all chain methods SHALL be walked and their style objects evaluated, identical to `.asElement()` chains

### Requirement: Transform emitter produces `createClassResolver` for `.asClass()` chains
The transform emitter SHALL replace `.asClass()` chains with `createClassResolver()` import and call.

#### Scenario: Static chain transform
- **WHEN** `const card = ds.styles({ display: 'flex' }).asClass()` is extracted
- **THEN** the transformed output SHALL be `const card = _cr("animus-card-{hash}", {})` with import `import { createClassResolver as _cr } from '@animus-ui/system'`

#### Scenario: Dynamic chain transform
- **WHEN** a chain with variants calls `.asClass()`
- **THEN** the transformed output SHALL include variant config in the `createClassResolver` arguments, matching the shape used by `.asElement()` transforms for `createComponent`

#### Scenario: Mixed file with both terminals
- **WHEN** a file contains both `.asElement()` chains and `.asClass()` chains
- **THEN** the transform SHALL emit both `createComponent` and `createClassResolver` imports and replace each chain with its appropriate call
