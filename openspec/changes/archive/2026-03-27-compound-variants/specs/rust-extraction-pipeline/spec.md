## ADDED Requirements

### Requirement: Chain walker recognizes compound stage
The chain walker SHALL recognize `.compound()` as a valid chain method. Each `.compound()` call SHALL produce a stage entry with two argument spans: the condition object expression and the styles object expression. Multiple `.compound()` calls SHALL produce multiple stage entries.

#### Scenario: Walk chain with single compound
- **WHEN** source contains `animus.styles({...}).variant({...}).compound({ size: 'sm' }, { padding: 0 }).asElement('div')`
- **THEN** the walker SHALL produce a chain descriptor with stages `styles`, `variants`, and one `compound` entry containing condition and styles spans

#### Scenario: Walk chain with multiple compounds
- **WHEN** source contains `.compound({...}, {...}).compound({...}, {...})`
- **THEN** the walker SHALL produce two `compound` stage entries in definition order

#### Scenario: Compound without prior variant bails
- **WHEN** source contains `animus.styles({...}).compound({...}, {...}).asElement('div')` with no `.variant()` call
- **THEN** the chain SHALL still be walkable — compound conditions will simply never match at runtime (empty variants object). No bail needed.

### Requirement: Style evaluator processes compound styles
The style evaluator SHALL process compound style objects identically to variant and base style objects — using the same `ThemedCSSProps` resolution pipeline including theme scale lookup, token alias resolution, and transform deferral.

#### Scenario: Evaluate compound styles with scale lookup
- **WHEN** a compound styles object contains `{ padding: 4 }` and prop `padding` has scale `space` with `{ "space.4": "0.25rem" }`
- **THEN** the evaluator SHALL resolve to `{ padding: 0.25rem }`

#### Scenario: Evaluate compound styles with token alias
- **WHEN** a compound styles object contains `{ border: '1px solid {colors.primary}' }`
- **THEN** the evaluator SHALL resolve the token alias to `var(--colors-primary)`

### Requirement: CSS generator emits @layer compounds
The CSS generator SHALL emit compound variant rules into a dedicated `@layer compounds { }` block. Compound rules SHALL be emitted after `@layer variants` and before `@layer states` in the CSS output. Each compound SHALL produce one class rule with naming pattern `animus-{ComponentName}-{hash}--compound-{index}`.

#### Scenario: Compound CSS in correct layer
- **WHEN** a component has base styles, variants, compounds, and states
- **THEN** the CSS output SHALL contain `@layer base {...}`, `@layer variants {...}`, `@layer compounds {...}`, `@layer states {...}` in that order

#### Scenario: Compound class naming
- **WHEN** a component `Button` with hash `a1b2c3d4` has a compound at index 0
- **THEN** the class name SHALL be `animus-Button-a1b2c3d4--compound-0`

### Requirement: Transform emitter includes compounds in config
The transform emitter SHALL include a `compounds` array in the `createComponent` config when the component has compound definitions. Each entry SHALL contain `conditions` (the condition object as-is) and `className` (the generated compound class name).

#### Scenario: Emitted config includes compounds
- **WHEN** a component has two compounds
- **THEN** the emitted `createComponent` call SHALL include `compounds: [{ conditions: { size: "sm", variant: "ghost" }, className: "animus-Btn-hash--compound-0" }, { conditions: { size: "lg", variant: "fill" }, className: "animus-Btn-hash--compound-1" }]`

#### Scenario: No compounds emits no field
- **WHEN** a component has no `.compound()` calls
- **THEN** the emitted config SHALL NOT include a `compounds` field
