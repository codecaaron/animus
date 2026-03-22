## ADDED Requirements

### Requirement: Variant usage tracking
The usage ledger SHALL track which variant option values are used for each component at JSX callsites across all analyzed files. For each component binding, the ledger records a map of variant prop name to the set of option values observed.

#### Scenario: Explicit variant value
- **WHEN** a callsite has `<Button variant="stroke" />`
- **THEN** the ledger SHALL record that component `Button`'s variant prop `variant` has value `"stroke"` used

#### Scenario: Multiple variant values across callsites
- **WHEN** callsites have `<Button variant="stroke" />` and `<Button variant="fill" />`
- **THEN** the ledger SHALL record both `"stroke"` and `"fill"` as used for `Button.variant`

#### Scenario: Default variant implicit activation
- **WHEN** a component has `defaultVariant: "fill"` and a callsite renders `<Button />` without a `variant` prop
- **THEN** the ledger SHALL record `"fill"` as used (the default is implicitly activated)

#### Scenario: Default NOT activated when all callsites specify explicit values
- **WHEN** a component has `defaultVariant: "fill"` and EVERY callsite specifies an explicit variant value (e.g., all use `variant="stroke"`)
- **THEN** the ledger SHALL NOT record `"fill"` as used — no callsite triggers the default

#### Scenario: Dynamic variant value transacts all options
- **WHEN** a callsite has `<Button variant={someVariable} />`
- **THEN** the ledger SHALL record ALL variant options for `Button.variant` as used — the dynamic value could be any option at runtime

### Requirement: State usage tracking
The usage ledger SHALL track which state props are activated for each component at JSX callsites.

#### Scenario: Static state activation
- **WHEN** a callsite has `<Layout sidebar />`
- **THEN** the ledger SHALL record state `"sidebar"` as used for component `Layout`

#### Scenario: Dynamic state activation
- **WHEN** a callsite has `<Layout loading={isLoading} />`
- **THEN** the ledger SHALL record state `"loading"` as used — the dynamic boolean could be true at runtime

#### Scenario: State never activated
- **WHEN** no callsite across any file passes the `loading` prop to `Layout`
- **THEN** the ledger SHALL NOT contain `"loading"` for `Layout`

### Requirement: Component render tracking
The usage ledger SHALL track whether each component is rendered at any JSX callsite. A component is considered rendered if its binding name appears as a JSX element tag.

#### Scenario: Component rendered
- **WHEN** any callsite has `<GridBox>...</GridBox>` or `<GridBox />`
- **THEN** the ledger SHALL record `GridBox` as rendered

#### Scenario: Component never rendered
- **WHEN** no file in the project contains a `<GridBox>` or `<GridBox />` element
- **THEN** the ledger SHALL NOT contain `GridBox` in the rendered set

#### Scenario: Component imported but only extended
- **WHEN** `Anchor` is imported in a file but only used as `Anchor.extend()` — never rendered as `<Anchor>`
- **THEN** the ledger SHALL NOT record `Anchor` as rendered via JSX — but Anchor's CSS is still kept because it is a parent in the provenance graph
