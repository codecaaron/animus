## Purpose

Requirements for the `doc-reference` capability: TypeSignature component; ParamTable component; MethodCard provides expandable detail sections; and 3 more.

## Requirements

### Requirement: TypeSignature component

A function type signature display component. The component SHALL accept `name` (string), `generics` (optional string), `params` (array of `{name: string, type: string}`), and `returns` (string). It SHALL render in monospace font with color-coded parts: name in accent, generics in purple/secondary, param names in blue, param types in purple/secondary, return type in green/success.

#### Scenario: Full signature rendering

- **WHEN** TypeSignature renders with name=".compound", generics="V extends VariantMap", params=[{name:"condition", type:"keyof V"}], returns="CompoundBuilder<V>"
- **THEN** it displays as `.compound<V extends VariantMap>(condition: keyof V) → CompoundBuilder<V>` with each part color-coded

#### Scenario: Without generics

- **WHEN** TypeSignature renders with no generics prop
- **THEN** the generic angle brackets are omitted

#### Scenario: Visual treatment

- **WHEN** TypeSignature renders
- **THEN** it has a left accent border (3px), surface background, rounded right corners, and monospace font

### Requirement: ParamTable component

An API parameter table component. The component SHALL accept `params` as an array of `{name: string, type: string, default: string, desc: string}`. It SHALL render using the existing Table/Th/Td components from `surfaces/Table.tsx` — it SHALL NOT implement its own table styling. The type column SHALL render each type value inside a TokenBadge with variant="type". The default column SHALL highlight "required" values in accent color.

#### Scenario: Table rendering

- **WHEN** ParamTable renders with 3 parameters
- **THEN** it displays a 4-column table (Parameter | Type | Default | Description) with 3 data rows

#### Scenario: Type column uses TokenBadge

- **WHEN** ParamTable renders a param with type="string | string[]"
- **THEN** the type cell contains `<TokenBadge variant="type">string | string[]</TokenBadge>`

#### Scenario: Required highlighting

- **WHEN** a param has default="required"
- **THEN** the default cell renders "required" in accent/primary color

### Requirement: MethodCard provides expandable detail sections

MethodCard SHALL use ark-ui Accordion primitives for expand/collapse behavior while maintaining the existing consumer API. Accordion semantics (proper ARIA roles, multi-expand control) are delegated to ark-ui.

#### Scenario: MethodCard expand/collapse via ark-ui

- **WHEN** user clicks the MethodCard header
- **THEN** the detail section toggles visibility, managed by ark-ui's Accordion primitive with proper `aria-expanded` state

#### Scenario: MethodCard consumer API stable

- **WHEN** a consumer renders `<MethodCard name="method" params={[...]} returns="void">`
- **THEN** the component works identically to the pre-migration version

### Requirement: TypeSignature uses variant-based token spans

TypeSignature SHALL replace 6 single-purpose styled spans (NameSpan, GenericSpan, PunctSpan, ParamNameSpan, ParamTypeSpan, ReturnSpan) with one `TokenSpan` element using `.variant({ prop: 'role' })` with options: name, generic, punct, param, paramType, return.

#### Scenario: Color mapping preserved

- **WHEN** TypeSignature renders a function signature
- **THEN** name tokens SHALL be `primary`, generic tokens `{colors.violet.400}`, punct tokens `text.dim`, param tokens `{colors.ocean.500}`, paramType tokens `{colors.violet.400}`, return tokens `{colors.forest.500}`

### Requirement: MethodCard uses states for expand/collapse

MethodCard Chevron SHALL use `.states({ expanded: { transform: 'rotate(180deg)' } })` instead of inline style for rotation.

#### Scenario: Chevron rotation via states

- **WHEN** the MethodCard is expanded
- **THEN** the Chevron element SHALL receive the `expanded` state prop
- **AND** the rotation SHALL be applied via `@layer states` CSS, not inline style

### Requirement: MethodCard accordion accessibility

MethodCard SHALL implement proper accordion ARIA semantics.

#### Scenario: ARIA attributes present

- **WHEN** a MethodCard renders
- **THEN** the header button SHALL have `aria-expanded` and `aria-controls` pointing to the detail section's `id`
- **AND** the detail section SHALL have `role="region"` and `aria-labelledby` pointing to the header
