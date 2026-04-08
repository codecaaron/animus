## ADDED Requirements

### Requirement: Sidecar default class emission
When a variant has `defaultVariant` specified, the CSS generator SHALL emit a sidecar rule using the class `{className}--{prop}-default` containing the default option's resolved declarations. This rule SHALL be emitted within `@layer variants` alongside the normal per-option variant rules.

#### Scenario: Sidecar rule emitted for variant with defaultVariant
- **WHEN** component `Card` has variant `density` with options `compact`, `comfortable` and `defaultVariant: 'comfortable'`
- **THEN** the CSS output SHALL contain a rule `.animus-Card-xxx--density-default { ...comfortable's declarations... }` within `@layer variants`

#### Scenario: Sidecar not emitted without defaultVariant
- **WHEN** component `Card` has variant `density` with options `compact`, `comfortable` and NO `defaultVariant`
- **THEN** the CSS output SHALL NOT contain any `--density-default` rule for that component

#### Scenario: Sidecar declarations match default option
- **WHEN** variant `density` has `defaultVariant: 'comfortable'` and `comfortable` resolves to `{ font-size: 1rem; padding-bottom: 0.5rem; }`
- **THEN** the sidecar rule `.animus-Card-xxx--density-default` SHALL contain exactly those declarations (including pseudo-selectors and responsive declarations if present on the default option)

#### Scenario: Multiple variants with defaults on same component
- **WHEN** component `Button` has `variant` with `defaultVariant: 'fill'` AND `size` with `defaultVariant: 'md'`
- **THEN** the CSS SHALL contain both `.animus-Button-xxx--variant-default` and `.animus-Button-xxx--size-default` sidecar rules

### Requirement: Runtime default class resolution
When resolving variant classes, the runtime SHALL emit the `--{prop}-default` class when the variant value comes from `defaultVariant` fallback (prop not passed by user), and the `--{prop}-{value}` class when the variant value comes from an explicit prop.

#### Scenario: Prop not passed, defaultVariant exists
- **WHEN** component renders with no `density` prop and config has `defaultVariant: 'comfortable'`
- **THEN** the resolved classes SHALL include `{className}--density-default` and SHALL NOT include `{className}--density-comfortable`

#### Scenario: Prop explicitly passed matching default
- **WHEN** component renders with `density="comfortable"` (explicit prop) and config has `defaultVariant: 'comfortable'`
- **THEN** the resolved classes SHALL include `{className}--density-comfortable` and SHALL NOT include `{className}--density-default`

#### Scenario: Prop explicitly passed different from default
- **WHEN** component renders with `density="compact"` and config has `defaultVariant: 'comfortable'`
- **THEN** the resolved classes SHALL include `{className}--density-compact`

#### Scenario: No defaultVariant configured
- **WHEN** component renders with no `density` prop and config has NO `defaultVariant`
- **THEN** no density variant class SHALL be added (existing behavior preserved)

### Requirement: Sidecar specificity contract
The sidecar default rule SHALL have specificity (0,1,0) — a single class selector. This SHALL be lower than compose inheritance and override rules at (0,3,0), ensuring compose rules always win when both match.

#### Scenario: Compose inheritance beats sidecar default
- **WHEN** parent Root has `density="compact"` and child has `defaultVariant: 'comfortable'` (no explicit prop)
- **THEN** the compose inheritance rule `.Root.Root--density-compact .Child` at (0,3,0) SHALL override the sidecar `.Child--density-default` at (0,1,0), applying compact styles to the child

#### Scenario: Compose override wins with explicit child prop
- **WHEN** parent Root has `density="compact"` and child explicitly passes `density="comfortable"`
- **THEN** the child receives `--density-comfortable` (not `--density-default`), the compose override rule `.Root .Child.Child--density-comfortable` at (0,3,0) SHALL match, and source-order-later override SHALL beat inheritance

### Requirement: Standalone behavior unchanged
Components used outside compose families SHALL render identically whether using the sidecar default class or the option-specific class. The sidecar rule contains the same declarations as the default option's rule.

#### Scenario: Standalone component with defaultVariant
- **WHEN** `Card` is used standalone (not in a compose family) with no `density` prop
- **THEN** the rendered output SHALL have class `--density-default`, and the sidecar CSS SHALL produce the same visual result as the previous `--density-comfortable` class
