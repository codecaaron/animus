## ADDED Requirements

### Requirement: Merge parent and child chain configurations

The chain merger SHALL combine a parent chain's evaluated configuration with a child extension's stages using immutable merge semantics. For each configuration field (baseStyles, variants, statesConfig, activeGroups, custom), the merged result SHALL be equivalent to `merge({}, parent.field, child.field)` where `merge` performs deep recursive merging.

#### Scenario: Merge base styles

- **WHEN** parent has `styles({ padding: 10, display: 'flex' })` and child has `styles({ padding: 16, color: 'red' })`
- **THEN** merged base styles SHALL be `{ padding: 16, display: 'flex', color: 'red' }` — child values override parent on conflict, parent values preserved otherwise

#### Scenario: Merge variants additively

- **WHEN** parent has `variant({ prop: 'size', variants: { sm: {...}, lg: {...} } })` and child adds `variant({ prop: 'color', variants: { red: {...}, blue: {...} } })`
- **THEN** merged variants SHALL contain BOTH the `size` variant (from parent) AND the `color` variant (from child)

#### Scenario: Merge states additively

- **WHEN** parent has `states({ loading: { opacity: 0 } })` and child has `states({ disabled: { cursor: 'not-allowed' } })`
- **THEN** merged states SHALL contain BOTH `loading` (from parent) AND `disabled` (from child)

#### Scenario: Override variant option

- **WHEN** parent has `variant({ variants: { fill: { bg: 'blue' } } })` and child has `variant({ variants: { fill: { bg: 'green' } } })`
- **THEN** merged variant `fill` SHALL have `bg: 'green'` — child overrides parent within the same variant option

#### Scenario: Merge groups additively

- **WHEN** parent has `groups({ space: true, layout: true })` and child has `groups({ color: true })`
- **THEN** merged active groups SHALL be `{ space: true, layout: true, color: true }`

### Requirement: Topological ordering for multi-level chains

The chain merger SHALL process extension chains in topological order (parents before children). For a chain A → B → C, the merger SHALL first merge A+B to produce AB, then merge AB+C to produce ABC.

#### Scenario: Three-level extension chain

- **WHEN** A has `styles({ p: 8 })`, B extends A with `styles({ m: 4 })`, C extends B with `styles({ p: 16 })`
- **THEN** the merged chain for C SHALL have `{ p: 16, m: 4 }` — C's padding overrides A's, B's margin preserved

#### Scenario: Cycle detection

- **WHEN** the provenance graph contains a cycle (A extends B, B extends A)
- **THEN** the merger SHALL report an error and mark both components as non-extractable

### Requirement: Merged component gets own class name

Each component in an extension chain SHALL receive its own unique class name, even though it inherits CSS from its parent. The class name is based on the component's own binding name and a content hash of its merged chain.

#### Scenario: Extended component class name

- **WHEN** parent `Button` has class `animus-Button-abc12345` and child `PrimaryButton` extends it
- **THEN** PrimaryButton SHALL have its own class `animus-PrimaryButton-def67890` (different hash because merged chain is different)
