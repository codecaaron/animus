## ADDED Requirements

### Requirement: CSS variable prefix
When a `prefix` option is configured, all generated CSS variable names SHALL be prefixed: `--{prefix}-{scale}-{key}` instead of `--{scale}-{key}`.

#### Scenario: Prefixed variable names
- **WHEN** plugin is configured with `prefix: 'mylib'` and theme has color `ember`
- **THEN** the emitted CSS variable SHALL be `--mylib-color-ember` instead of `--color-ember`

#### Scenario: Token refs resolve to prefixed variables
- **WHEN** plugin is configured with `prefix: 'mylib'` and source code contains `color: '{colors.ember}'`
- **THEN** the extracted CSS SHALL contain `color: var(--mylib-color-ember)`

#### Scenario: No prefix preserves current behavior
- **WHEN** plugin is configured without a `prefix` option
- **THEN** all CSS variable names SHALL use the current unprefixed format (`--color-ember`)

### Requirement: Class name prefix
When a `prefix` option is configured, all generated class names SHALL use the prefix instead of `animus`: `.{prefix}-{Component}-{hash}`.

#### Scenario: Prefixed class names
- **WHEN** plugin is configured with `prefix: 'mylib'` and a component `Button` is extracted
- **THEN** the generated class name SHALL be `.mylib-Button-{hash}` instead of `.animus-Button-{hash}`

#### Scenario: No prefix uses default
- **WHEN** plugin is configured without a `prefix` option
- **THEN** class names SHALL use the current `animus-` prefix

### Requirement: Layer name prefix
When a `prefix` option is configured, all `@layer` names SHALL be prefixed: `{prefix}-global`, `{prefix}-base`, etc.

#### Scenario: Prefixed layer names
- **WHEN** plugin is configured with `prefix: 'mylib'`
- **THEN** the emitted CSS SHALL use `@layer mylib-global, mylib-base, mylib-variants, mylib-states, mylib-system, mylib-custom`

#### Scenario: Layer blocks use prefixed names
- **WHEN** plugin is configured with `prefix: 'mylib'` and component CSS is generated
- **THEN** component CSS SHALL be wrapped in `@layer mylib-base { ... }` instead of `@layer base { ... }`

### Requirement: Consumer-controlled layer declaration
The plugin SHALL accept an optional `layers` array that specifies the complete `@layer` declaration order. Consumers MAY include their own layer names interleaved with Animus layer names.

#### Scenario: Consumer layers interleaved
- **WHEN** plugin is configured with `prefix: 'mylib'` and `layers: ['reset', 'mylib-global', 'mylib-base', 'app-typography', 'mylib-variants', 'mylib-states', 'mylib-system', 'mylib-custom', 'app-overrides']`
- **THEN** the emitted CSS SHALL begin with `@layer reset, mylib-global, mylib-base, app-typography, mylib-variants, mylib-states, mylib-system, mylib-custom, app-overrides;`

#### Scenario: Consumer layers before and after
- **WHEN** plugin is configured with `layers: ['reset', 'global', 'base', 'variants', 'states', 'system', 'custom', 'overrides']`
- **THEN** the emitted CSS SHALL include all listed layers in the declaration, with `reset` first and `overrides` last

### Requirement: Layer order enforcement
When a `layers` array is provided, the plugin SHALL validate at init that the 6 Animus layers appear in their required relative order: `global < base < variants < states < system < custom`. The validation SHALL only check relative order — consumer layers between Animus layers are unconstrained.

#### Scenario: Valid interleaved order accepted
- **WHEN** `layers: ['reset', 'mylib-global', 'mylib-base', 'app-layer', 'mylib-variants', 'mylib-states', 'mylib-system', 'mylib-custom']`
- **THEN** the configuration SHALL be accepted without error

#### Scenario: Invalid order rejected
- **WHEN** `layers: ['mylib-custom', 'mylib-base', 'mylib-global']` (custom before base, base before global)
- **THEN** the plugin SHALL throw at `configResolved` with a message explaining the required order

#### Scenario: Missing Animus layers rejected
- **WHEN** `layers: ['reset', 'mylib-global', 'mylib-base', 'app-overrides']` (missing variants, states, system, custom)
- **THEN** the plugin SHALL throw with a message listing the missing required layers

### Requirement: Prefix is output-only
The `prefix` option SHALL NOT affect token ref syntax, scale key names, or any consumer-facing TypeScript types. Token refs (`{colors.primary}`) remain prefix-free. The prefix is applied at extraction output time only.

#### Scenario: Token refs are prefix-unaware
- **WHEN** plugin is configured with `prefix: 'mylib'` and source uses `{colors.primary}`
- **THEN** the token ref syntax in source code SHALL NOT change — `{colors.primary}` resolves to `var(--mylib-color-primary)` at extraction time
