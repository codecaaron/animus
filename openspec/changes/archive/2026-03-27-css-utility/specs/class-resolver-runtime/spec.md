## ADDED Requirements

### Requirement: `createClassResolver` resolves className from props
The system SHALL export a `createClassResolver` function that accepts a base className and optional configuration (variants, states, compounds, system prop map) and returns a function `(props?) => string`.

#### Scenario: Base class only
- **WHEN** `createClassResolver("animus-card-abc", {})` is created and called with no args
- **THEN** it returns `"animus-card-abc"`

#### Scenario: Variant resolution
- **WHEN** resolver is configured with `variants: [{ prop: "size", default: "md", classes: { sm: "...-sm", lg: "...-lg" } }]`
- **AND** called with `{ size: "lg" }`
- **THEN** it returns base class plus `"...-lg"`

#### Scenario: Default variant applied
- **WHEN** resolver is configured with a variant that has `default: "md"`
- **AND** called with no `size` prop
- **THEN** it returns base class plus the `md` variant class

#### Scenario: State toggle
- **WHEN** resolver is configured with `states: { loading: "...-loading", disabled: "...-disabled" }`
- **AND** called with `{ loading: true }`
- **THEN** it returns base class plus `"...-loading"` but NOT `"...-disabled"`

#### Scenario: Compound matching
- **WHEN** resolver is configured with compounds `[{ conditions: { size: "sm", variant: "ghost" }, className: "...-compound-0" }]`
- **AND** called with `{ size: "sm", variant: "ghost" }`
- **THEN** it returns base class plus variant classes plus `"...-compound-0"`

#### Scenario: Compound array conditions
- **WHEN** a compound has condition `{ variant: ["ghost", "subtle"] }`
- **AND** called with `{ variant: "ghost" }`
- **THEN** the compound class SHALL be included (matches any in array)

#### Scenario: System prop resolution
- **WHEN** resolver is configured with a system prop map
- **AND** called with `{ p: 8 }`
- **THEN** it returns base class plus the utility class for `padding: 0.5rem` from the shared map

#### Scenario: All sources combined
- **WHEN** resolver has variants, states, compounds, and system props configured
- **AND** called with a mix of variant, state, and system props
- **THEN** it returns a single space-joined string containing base + variant + state + compound + system classes

### Requirement: `createClassResolver` is factored from `createComponent`
The className resolution logic in `createClassResolver` SHALL be shared with `createComponent` to prevent behavioral divergence.

#### Scenario: Variant resolution matches createComponent
- **WHEN** a variant chain produces a React component via `.asElement()` AND a class resolver via `.asClass()`
- **AND** both are given the same props
- **THEN** the className portion of the React component's output SHALL equal the class resolver's output
