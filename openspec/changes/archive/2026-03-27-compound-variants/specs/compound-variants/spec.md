## ADDED Requirements

### Requirement: Compound variant builder method
The builder chain SHALL expose a `.compound(condition, styles)` method on `AnimusWithVariants`. The method SHALL accept a condition object where keys are variant prop names and values are variant option keys, and a styles object using the same `ThemedCSSProps` type as `.styles()` and `.variant()`. The method SHALL return `this`, enabling multiple `.compound()` calls to chain. Compound data SHALL be stored at the value level (array) on the instance, not as a generic type parameter.

#### Scenario: Single compound definition
- **WHEN** a builder chain includes `.variant({ prop: 'size', variants: { sm: {...}, lg: {...} } }).variant({ variants: { fill: {...}, ghost: {...} } }).compound({ size: 'sm', variant: 'ghost' }, { padding: 0 })`
- **THEN** the compound SHALL be stored with condition `{ size: 'sm', variant: 'ghost' }` and styles `{ padding: 0 }`

#### Scenario: Multiple compound definitions chain
- **WHEN** a builder chain includes `.compound({ size: 'sm', variant: 'ghost' }, { padding: 0 }).compound({ size: 'lg', variant: 'fill' }, { borderRadius: 8 })`
- **THEN** both compounds SHALL be stored in definition order (index 0 and index 1)

#### Scenario: Compound condition keys constrained to variant props
- **WHEN** a builder chain has variants `size` and `variant` defined, and `.compound({ size: 'sm', color: 'red' }, {...})` is called
- **THEN** TypeScript SHALL report a type error because `color` is not a key in the accumulated Variants

#### Scenario: Compound condition values constrained to variant options
- **WHEN** a builder chain has variant `size` with options `sm | md | lg`, and `.compound({ size: 'xl' }, {...})` is called
- **THEN** TypeScript SHALL report a type error because `'xl'` is not a valid option for `size`

#### Scenario: Compound is callable before states
- **WHEN** a builder chain includes `.variant({...}).compound({...}, {...}).states({...})`
- **THEN** the chain SHALL compile and produce a valid component

#### Scenario: Compound styles use ThemedCSSProps
- **WHEN** a compound styles object includes `{ bg: 'primary', padding: '{space.4}' }`
- **THEN** the styles SHALL be resolved through the same theme scale and token alias pipeline as variant and base styles

### Requirement: Compound variant CSS generation
The CSS generator SHALL emit compound variant rules into `@layer compounds`. Each compound SHALL produce one class rule with a deterministic class name following the pattern `animus-{ComponentName}-{hash}--compound-{index}`.

#### Scenario: Single compound CSS output
- **WHEN** a component has one compound `{ size: 'sm', variant: 'ghost' }` with styles `{ padding: 0 }`
- **THEN** the CSS SHALL contain `@layer compounds { .animus-Btn-hash--compound-0 { padding: 0; } }`

#### Scenario: Multiple compounds CSS output
- **WHEN** a component has two compounds at indices 0 and 1
- **THEN** both SHALL appear within `@layer compounds`, with index-1 rules after index-0 rules (later definition wins on overlap)

#### Scenario: Compound with pseudo-selectors
- **WHEN** a compound styles object contains `{ '&:hover': { opacity: 0.8 } }`
- **THEN** the CSS SHALL contain `.animus-Btn-hash--compound-0:hover { opacity: 0.8; }` within `@layer compounds`

#### Scenario: Compound with responsive values
- **WHEN** a compound styles object contains `{ padding: { _: 2, md: 8 } }` with theme `{ "space.2": "0.125rem", "space.8": "0.5rem" }`
- **THEN** the CSS SHALL contain the base value and a `@media` query within `@layer compounds`

### Requirement: Compound variant runtime resolution
At render time, the runtime SHALL iterate the component's `compounds` array and check each compound's conditions against the current variant prop values. For each compound where ALL condition key/value pairs match, the compound's className SHALL be added to the element's class list.

#### Scenario: Matching compound applied
- **WHEN** a component has compound `{ conditions: { size: "sm", variant: "ghost" }, className: "cls-0" }` and receives props `size="sm" variant="ghost"`
- **THEN** the rendered element SHALL include `cls-0` in its className

#### Scenario: Non-matching compound not applied
- **WHEN** a component has compound `{ conditions: { size: "sm", variant: "ghost" }, className: "cls-0" }` and receives props `size="lg" variant="ghost"`
- **THEN** the rendered element SHALL NOT include `cls-0` in its className

#### Scenario: Partial condition match
- **WHEN** a component has compound `{ conditions: { size: "sm" }, className: "cls-0" }` and receives props `size="sm" variant="fill"`
- **THEN** the rendered element SHALL include `cls-0` — partial conditions match when all specified keys match, regardless of unspecified keys

#### Scenario: Multiple compounds match simultaneously
- **WHEN** a component has compounds `[{ conditions: { size: "sm" }, className: "cls-0" }, { conditions: { size: "sm", variant: "ghost" }, className: "cls-1" }]` and receives `size="sm" variant="ghost"`
- **THEN** both `cls-0` and `cls-1` SHALL be in the className — both conditions are satisfied

#### Scenario: Compound with default variant
- **WHEN** variant `variant` has `defaultVariant: "fill"` and compound condition is `{ variant: "fill" }` and component is rendered without a `variant` prop
- **THEN** the compound SHALL match — the default value is used for condition matching

#### Scenario: No compounds defined
- **WHEN** a component has no `compounds` in its config
- **THEN** the runtime SHALL skip compound resolution entirely — no performance cost

### Requirement: Cascade layer ordering
The CSS layer declaration SHALL include `compounds` between `variants` and `states`: `@layer global, base, variants, compounds, states, system, custom`. This ensures compound rules override individual variant rules, and state rules override compound rules.

#### Scenario: Compound overrides variant
- **WHEN** variant `size=sm` sets `padding: 4px` in `@layer variants` and compound `{ size: 'sm', variant: 'ghost' }` sets `padding: 0` in `@layer compounds`
- **THEN** when both conditions are active, the compound's `padding: 0` SHALL win

#### Scenario: State overrides compound
- **WHEN** compound `{ size: 'sm', variant: 'ghost' }` sets `opacity: 1` in `@layer compounds` and state `loading` sets `opacity: 0.5` in `@layer states`
- **THEN** when the compound matches AND loading is active, the state's `opacity: 0.5` SHALL win

#### Scenario: System prop overrides compound
- **WHEN** compound sets `padding: 0` in `@layer compounds` and system prop `p={8}` produces a utility class in `@layer system`
- **THEN** the system prop SHALL win — `@layer system` has higher precedence

### Requirement: Extension inheritance of compounds
When a component B extends component A, B SHALL inherit A's compounds. If B defines its own compounds, they SHALL be appended after A's compounds. Within `@layer compounds`, later-defined rules take precedence via source ordering.

#### Scenario: Extension inherits parent compounds
- **WHEN** A has compound `{ size: 'sm', variant: 'ghost' }` and B extends A without defining compounds
- **THEN** B SHALL include A's compound in its config and CSS output

#### Scenario: Extension overrides parent compound
- **WHEN** A has compound at index 0 and B extends A and defines its own compound at index 1 with overlapping conditions
- **THEN** B's compound (higher index, later in source) SHALL override A's when both match
