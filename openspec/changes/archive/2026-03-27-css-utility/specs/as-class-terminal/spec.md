## ADDED Requirements

### Requirement: `.asClass()` terminal produces callable className resolver
The builder chain SHALL expose `.asClass()` as a terminal method that returns a function of type `(props?: InferredProps) => string`. The function SHALL resolve variant classes, state toggles, compound matches, and system prop utilities into a space-joined className string.

#### Scenario: Static chain produces zero-arg callable
- **WHEN** a chain with only `.styles()` calls `.asClass()`
- **THEN** the returned function accepts an empty object or no arguments and returns the base className string

#### Scenario: Chain with variants produces typed callable
- **WHEN** a chain with `.variant({ prop: 'size', variants: { sm: {...}, lg: {...} } })` calls `.asClass()`
- **THEN** the returned function accepts `{ size?: 'sm' | 'lg' }` and returns base className plus the matching variant className

#### Scenario: Chain with states produces boolean-accepting callable
- **WHEN** a chain with `.states({ loading: {...}, disabled: {...} })` calls `.asClass()`
- **THEN** the returned function accepts `{ loading?: boolean, disabled?: boolean }` and appends state classNames for each `true` value

#### Scenario: Chain with groups produces system-prop-accepting callable
- **WHEN** a chain with `.groups({ space: true })` calls `.asClass()`
- **THEN** the returned function accepts space group props (`p`, `m`, `mt`, etc.) and resolves them to utility classNames via the shared system prop map

#### Scenario: Full chain merges all prop types
- **WHEN** a chain with `.styles()`, `.variant()`, `.states()`, `.compound()`, and `.groups()` calls `.asClass()`
- **THEN** the returned function accepts the union of variant props, state booleans, and system props, returning a single space-joined className string

### Requirement: `.asClass()` is available at all post-styles chain positions
The `.asClass()` method SHALL be available as a terminal at every chain position where `.asElement()` is available.

#### Scenario: Available after `.styles()`
- **WHEN** `.styles({...}).asClass()` is called
- **THEN** it compiles and returns a callable function

#### Scenario: Available after `.variant()`
- **WHEN** `.styles({...}).variant({...}).asClass()` is called
- **THEN** it compiles and returns a callable function with variant props

#### Scenario: Available after `.compound()`
- **WHEN** `.styles({...}).variant({...}).compound({...}, {...}).asClass()` is called
- **THEN** it compiles and returns a callable function

#### Scenario: Available after `.states()`
- **WHEN** a chain ending in `.states({...}).asClass()` is called
- **THEN** it compiles and returns a callable function with state props

#### Scenario: Available after `.groups()`
- **WHEN** a chain ending in `.groups({...}).asClass()` is called
- **THEN** it compiles and returns a callable function with group props

#### Scenario: Not available after another terminal
- **WHEN** `.asElement('div').asClass()` is written
- **THEN** it SHALL produce a TypeScript compile error

### Requirement: `.asClass()` output has no React dependency
The function returned by `.asClass()` SHALL NOT import or reference React, ReactDOM, or any React types. It SHALL be usable in any JavaScript environment.

#### Scenario: Used in non-React context
- **WHEN** `.asClass()` result is called in a vanilla JS file with no React imports
- **THEN** it returns a className string without errors

### Requirement: `.asClass()` preserves cascade contract
CSS generated from `.asClass()` chains SHALL follow the same `@layer` assignment as `.asElement()` chains.

#### Scenario: Styles in base layer
- **WHEN** a chain has `.styles({ display: 'flex' }).asClass()`
- **THEN** extracted CSS for `display: flex` SHALL be in `@layer base`

#### Scenario: Variants in variants layer
- **WHEN** a chain has `.variant({...}).asClass()`
- **THEN** extracted variant CSS SHALL be in `@layer variants`

#### Scenario: States in states layer
- **WHEN** a chain has `.states({...}).asClass()`
- **THEN** extracted state CSS SHALL be in `@layer states`

### Requirement: Class naming follows component conventions
`.asClass()` chains SHALL use the same naming scheme as `.asElement()` chains.

#### Scenario: Dev mode uses position-based hash
- **WHEN** in development mode
- **THEN** class names SHALL be `animus-{variableName}-{positionHash}` for HMR stability

#### Scenario: Prod mode uses content-based hash
- **WHEN** in production mode
- **THEN** class names SHALL be `animus-{variableName}-{contentHash}` for caching

#### Scenario: Variable name inferred from AST
- **WHEN** the chain is assigned to `const card = ds.styles({...}).asClass()`
- **THEN** the variable name `card` SHALL be used in the class name
