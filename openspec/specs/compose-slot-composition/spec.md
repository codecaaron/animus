## ADDED Requirements

### Requirement: compose() API signature
`compose()` SHALL accept two arguments: a `Slots` record mapping slot names to Animus components, and an options object with a `shared` config. It SHALL return a `ComposedFamily<Slots>` where each slot is a sealed `ForwardRefExoticComponent`.

#### Scenario: Basic compose call
- **WHEN** `compose({ Root: CardRoot, Header: CardHeader, Body: CardBody }, { shared: { density: true } })` is called
- **THEN** the result SHALL have keys `Root`, `Header`, `Body`, each mapped to a `ForwardRefExoticComponent` with the slot's original props

#### Scenario: Composed output is sealed
- **WHEN** a composed family is created
- **THEN** the output components SHALL NOT have `.extend()` or any builder methods — compose is a one-way door from builder-land to component-land

### Requirement: Root convention — literal "Root" key
The Root slot SHALL be identified by the exact key `"Root"` (PascalCase, case-sensitive). Any other casing SHALL NOT be treated as Root.

#### Scenario: PascalCase Root detected
- **WHEN** `compose({ Root: RootComp, Child: ChildComp }, { shared: {} })` is called
- **THEN** the `Root` slot SHALL be identified as the context provider

#### Scenario: Lowercase root NOT detected as Root
- **WHEN** `compose({ root: RootComp, child: ChildComp }, { shared: {} })` is called
- **THEN** no slot SHALL be treated as the context provider — `root` is treated as a regular child slot

#### Scenario: Type-level Root extraction
- **WHEN** `SharedConfig<Slots>` is computed for slots containing a `"Root"` key
- **THEN** the shared key options SHALL be derived from Root's variant keys using direct `Slots['Root']` lookup, not case-insensitive matching

### Requirement: Shared variant propagation via React context
Root SHALL provide shared variant values via React context. Child slots that have matching variant keys SHALL consume from context. Direct props on child slots SHALL override context values.

#### Scenario: Shared variant flows from Root to child
- **WHEN** `<Family.Root density="compact">` renders with a shared `density` key
- **THEN** `<Family.Child />` (which has a `density` variant) SHALL receive `density="compact"` from context

#### Scenario: Direct prop overrides context
- **WHEN** `<Family.Root density="compact">` renders and `<Family.Child density="loose" />` has a direct prop
- **THEN** the Child SHALL use `density="loose"` (direct prop wins)

#### Scenario: Unknown shared keys don't leak to children
- **WHEN** Root provides `density` via context but a child slot does NOT have a `density` variant
- **THEN** the child SHALL NOT receive the `density` prop — unknown props are filtered by `__variantKeys`

### Requirement: Family displayName derivation
Composed family member displayNames SHALL be stable and predictable. The family name SHALL NOT be derived from displayName regex parsing.

#### Scenario: displayName with explicit name option
- **WHEN** `compose(slots, { shared: {}, name: 'Card' })` is called
- **THEN** each slot SHALL have `displayName` of `"Card.Root"`, `"Card.Header"`, etc.

#### Scenario: displayName without name option
- **WHEN** `compose(slots, { shared: {} })` is called without a `name` option
- **THEN** each slot SHALL have a stable displayName derived from the Root component's displayName (stripping `animus-` prefix and hash suffix) or fallback to `"Composed"`

### Requirement: React key preservation through wrappers
Composed components wrapped in `forwardRef` SHALL correctly propagate React keys for list rendering.

#### Scenario: Keys maintained in list rendering
- **WHEN** a list of `<Family.Root key={id}>` elements is rendered
- **THEN** React reconciliation SHALL use the keys correctly — reordering the list SHALL not remount components

### Requirement: SharedConfig type constraint
`SharedConfig<Slots>` SHALL only allow keys that exist as variant props on the Root slot. Non-Root variant keys SHALL NOT be valid shared keys.

#### Scenario: Valid shared key from Root
- **WHEN** Root has variants `{ density: { compact: {}, loose: {} } }` and shared config is `{ density: true }`
- **THEN** TypeScript SHALL accept the shared config

#### Scenario: Invalid shared key not on Root
- **WHEN** Root does NOT have a `theme` variant but shared config is `{ theme: true }`
- **THEN** TypeScript SHALL produce a type error — `theme` is not a valid shared key
