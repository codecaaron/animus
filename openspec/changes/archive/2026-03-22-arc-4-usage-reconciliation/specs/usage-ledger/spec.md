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

### Requirement: Variants without defaultVariant excluded from tracking
Variant props that have NO `defaultVariant` defined SHALL be excluded from the `ComponentUsageConfig` and SHALL NOT be tracked by the scanner. The reconciler SHALL receive no usage data for those variant props and SHALL fall back to conservative behavior: all options are kept. This prevents implicit callsite usage (no prop passed) from incorrectly eliminating all options when there is no default to resolve to.

#### Scenario: Variant without default keeps all options
- **WHEN** a component has `variant({ variants: { ui: {...}, text: {...} } })` with NO `defaultVariant` and some callsites render the component without a variant prop
- **THEN** the reconciler SHALL keep ALL variant options (`ui` and `text`) because the variant prop is not tracked

### Requirement: Conservative fallback when no usage data
When a component IS in `rendered_components` but the ledger contains NO entries in `variant_usage` or `state_usage` for that component, the reconciler SHALL keep ALL variant options and ALL states for that component. No elimination occurs without positive evidence of what IS used.

#### Scenario: Rendered component with no variant/state usage data
- **WHEN** a component `Box` is rendered at callsites but no variant or state props are passed
- **THEN** the reconciler SHALL keep all of Box's variants and states intact
