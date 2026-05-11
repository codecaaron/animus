## ADDED Requirements

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

### Requirement: MethodCard component

An expandable API method reference card. The component SHALL accept `name` (string), `description` (string), `returnType` (string), `available` (optional string — which method must precede this one), `example` (ReactNode), and `expanded` is managed internally via useState. Clicking the header SHALL toggle expanded state.

#### Scenario: Collapsed state
- **WHEN** MethodCard renders with name="styles(css)" and description="Define base styles"
- **THEN** it displays a compact header row with method name (accent color), description (muted), return type (TokenBadge), and expand chevron

#### Scenario: Expanded state
- **WHEN** user clicks the MethodCard header
- **THEN** the detail section expands below showing: "available after" badge (if provided) and the example ReactNode content

#### Scenario: Collapse toggle
- **WHEN** user clicks the header of an expanded MethodCard
- **THEN** the detail section collapses

#### Scenario: Chevron rotation
- **WHEN** MethodCard is expanded vs collapsed
- **THEN** the chevron icon rotates 180° (expanded) or 0° (collapsed) with CSS transition
