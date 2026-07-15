## Purpose

Requirements for the `semantic-const-resolution` capability: Intra-file const identifier resolution; Intra-file object reference resolution; Cross-file imported const resolution.

## Requirements

### Requirement: Intra-file const identifier resolution

The style evaluator SHALL resolve `Expression::Identifier` nodes that reference top-level `const` declarations in the same file. When the identifier's declaration has a statically-evaluable init expression, the evaluator SHALL use the resolved value instead of bailing.

#### Scenario: Numeric const used as style value

- **WHEN** a file contains `const GAP = 16;` and a style object contains `{ gap: GAP }`
- **THEN** the evaluator SHALL resolve `GAP` to `16` and extract `gap: 16` as a static style value

#### Scenario: String const used as style value

- **WHEN** a file contains `const COLOR = 'red';` and a style object contains `{ color: COLOR }`
- **THEN** the evaluator SHALL resolve `COLOR` to `'red'` and extract `color: red` as a static style value

#### Scenario: Non-static const skips gracefully

- **WHEN** a file contains `const val = getSpacing();` and a style object contains `{ gap: val }`
- **THEN** the evaluator SHALL skip the property with reason "variable reference (non-static)" because the init expression is a function call

#### Scenario: let/var declarations are not resolved

- **WHEN** a file contains `let gap = 16;` and a style object contains `{ gap: gap }`
- **THEN** the evaluator SHALL skip the property because `let` bindings are mutable and cannot be statically guaranteed

#### Scenario: Only module-scope declarations are collected

- **WHEN** a `const` declaration appears inside a function body or block scope
- **THEN** it SHALL NOT be included in the static value map (only top-level `program.body` declarations are walked)

### Requirement: Intra-file object reference resolution

The style evaluator SHALL resolve identifiers that reference top-level `const` declarations whose init expression is an ObjectExpression. When `styles(config)` is called with an identifier argument instead of an inline object, the evaluator SHALL look up the identifier and evaluate the referenced object.

#### Scenario: Object identifier as styles argument

- **WHEN** a file contains `const config = { gap: 16, display: 'flex' };` and a chain contains `.styles(config)`
- **THEN** the evaluator SHALL resolve `config` to the object `{ gap: 16, display: 'flex' }` and extract both properties

#### Scenario: Object with non-static properties

- **WHEN** a file contains `const config = { gap: 16, color: someVar };` and a chain contains `.styles(config)`
- **THEN** the evaluator SHALL extract `gap: 16` and skip `color` with appropriate bail reason (per-property skip model preserved)

#### Scenario: Object spread in referenced object still bails

- **WHEN** a file contains `const config = { ...base, gap: 16 };` and a chain contains `.styles(config)`
- **THEN** the evaluator SHALL bail on the object due to spread element (existing behavior preserved)

### Requirement: Cross-file imported const resolution

The style evaluator SHALL resolve identifiers that reference imported `const` values from other files in the project. During Phase 1, each file's exported static values SHALL be collected into an export map. After binding resolution (Phase 2), imported identifiers SHALL be resolved by following the binding chain to the source file's export map.

#### Scenario: Imported numeric const

- **WHEN** file A contains `export const SPACING = 8;` and file B contains `import { SPACING } from './a'; styles({ padding: SPACING })`
- **THEN** the evaluator SHALL resolve `SPACING` to `8` via the cross-file export map and extract `padding: 8`

#### Scenario: Imported object const

- **WHEN** file A contains `export const baseStyles = { display: 'flex', gap: 16 };` and file B contains `import { baseStyles } from './a'; .styles(baseStyles)`
- **THEN** the evaluator SHALL resolve `baseStyles` to the object and extract both properties

#### Scenario: Re-exported const

- **WHEN** file A exports `SPACING`, file B re-exports it (`export { SPACING } from './a'`), and file C imports from B
- **THEN** the evaluator SHALL follow the re-export chain (via existing binding resolution) and resolve to file A's value

#### Scenario: Non-project import is not resolved

- **WHEN** an import comes from a package (`import { X } from 'some-library'`)
- **THEN** the identifier SHALL NOT be resolved (only project files with analyzed source are eligible) and the property SHALL skip with standard bail reason

#### Scenario: Aliased import resolution

- **WHEN** file A contains `export const GAP = 16;` and file B contains `import { GAP as spacing } from './a'; styles({ padding: spacing })`
- **THEN** the evaluator SHALL resolve the local name `spacing` to the exported value `16`
