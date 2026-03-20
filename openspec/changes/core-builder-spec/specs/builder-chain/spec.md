## ADDED Requirements

### Requirement: Type-state machine enforces method ordering
The builder SHALL enforce a fixed method call ordering through a backwards inheritance chain: `Animus → AnimusWithBase → AnimusWithVariants → AnimusWithStates → AnimusWithSystem → AnimusWithAll`. Each class in the chain SHALL only expose the method(s) appropriate to its stage. The TypeScript type system SHALL prevent calling methods out of order at compile time.

#### Scenario: Valid chain produces typed component
- **WHEN** a developer writes `animus.styles({...}).variant({...}).states({...}).groups({...}).props({...}).asElement('button')`
- **THEN** the chain compiles without error and produces a fully-typed React component whose prop API is computed from the accumulated type parameters

#### Scenario: Invalid ordering is a compile error
- **WHEN** a developer writes `animus.variant({...}).styles({...})`
- **THEN** TypeScript SHALL emit a type error because `.variant()` is not exposed on the `Animus` class (only `.styles()` is available at the entry point)

#### Scenario: Methods are optional with skip-through
- **WHEN** a developer writes `animus.styles({...}).asElement('div')` (skipping variant, states, groups, props)
- **THEN** the chain SHALL compile successfully because each class inherits terminal methods from AnimusWithAll through the backwards inheritance chain

### Requirement: Progressive type accumulation via 8 generic parameters
The builder chain SHALL track all configuration through 8 generic type parameters: PropRegistry, GroupRegistry, BaseParser, BaseStyles, Variants, States, ActiveGroups, and CustomProps. Each method call SHALL return a new class instance with updated type parameters, accumulating the configuration progressively.

#### Scenario: Type parameters carry style values
- **WHEN** `.styles({ padding: 10 })` is called
- **THEN** the BaseStyles type parameter SHALL contain the literal type `{ padding: 10 }`, not the widened type `{ padding: number }`

#### Scenario: Variant types accumulate across multiple calls
- **WHEN** `.variant({ prop: 'size', variants: { sm: {...}, lg: {...} } })` is called followed by `.variant({ prop: 'intent', variants: { primary: {...} } })`
- **THEN** the Variants type parameter SHALL be the intersection of both variant configs, and the final component SHALL accept both `size` and `intent` props

### Requirement: Cascade ordering mirrors CSS specificity layers
The builder method order SHALL define the cascade priority of styles at runtime. Styles from later methods override styles from earlier methods when they target the same CSS property. The execution order SHALL be: base styles → variant styles → state styles → system props → custom props.

#### Scenario: State styles override variant styles
- **WHEN** a component has `.variant({ variants: { primary: { opacity: 1 } } }).states({ disabled: { opacity: 0.6 } })`
- **AND** the component is rendered with `variant="primary" disabled`
- **THEN** the computed opacity SHALL be `0.6` because state styles (later in cascade) override variant styles

#### Scenario: System props override all declarative styles
- **WHEN** a component has `.styles({ padding: 10 }).groups({ space: true })` and is rendered with `p={20}`
- **THEN** the computed padding SHALL be `20` because system props (later in cascade) override base styles

### Requirement: Terminal methods materialize configuration into components
The builder SHALL provide three terminal methods: `.asElement(tag)`, `.asComponent(Component)`, and `.build()`. Terminals SHALL compile the accumulated configuration into a usable output. `.asElement()` and `.asComponent()` produce React components. `.build()` produces the raw styling function.

#### Scenario: asElement creates a styled HTML element
- **WHEN** `.asElement('button')` is called
- **THEN** the result SHALL be a React component that renders a `<button>` element with styles applied via Emotion's `styled()`, with `shouldForwardProp` filtering system props from DOM attributes

#### Scenario: asComponent wraps an existing component
- **WHEN** `.asComponent(MyComponent)` is called where MyComponent accepts `className`
- **THEN** the result SHALL be a React component that wraps MyComponent with styles applied via `className`, filtering system props via `shouldForwardProp`

#### Scenario: Terminal components carry extend()
- **WHEN** `.asElement('button')` produces a component `Button`
- **THEN** `Button.extend()` SHALL be a method that returns an AnimusExtended instance seeded with all of Button's accumulated configuration

#### Scenario: build() produces a raw style function
- **WHEN** `.build()` is called
- **THEN** the result SHALL be a function `(props) => CSSObject` that computes styles from the full cascade, AND the function SHALL have an `.extend()` method attached

### Requirement: Backwards inheritance enables progressive revelation
The class hierarchy SHALL use backwards inheritance where the entry point class (Animus) inherits from ALL subsequent classes. This pattern SHALL ensure that the entry point has access to all terminal methods through inheritance, while TypeScript's type narrowing restricts which methods are visible at each stage.

#### Scenario: Animus class inherits terminal methods
- **WHEN** the Animus class is instantiated
- **THEN** it SHALL have `.asElement()`, `.build()`, and `.extend()` available through its prototype chain (inherited from AnimusWithAll), even though TypeScript's type system only exposes `.styles()` at the entry point type

#### Scenario: Each method returns a new instance
- **WHEN** any builder method is called (e.g., `.styles({...})`)
- **THEN** a NEW instance of the next class in the chain SHALL be returned, preserving immutability of the builder pattern
