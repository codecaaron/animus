## ADDED Requirements

### Requirement: Layer names are prefixed with dot-notation sublayers
When the `prefix` option is set, all 7 Animus `@layer` names SHALL be emitted as dot-notation sublayers of the prefix. The bare layer name `base` SHALL become `{prefix}.base` in all CSS output.

#### Scenario: Prefixed layer declaration
- **WHEN** `prefix` is set to `'acme'`
- **THEN** the CSS layer declaration SHALL be `@layer acme.global, acme.base, acme.variants, acme.compounds, acme.states, acme.system, acme.custom;`

#### Scenario: Prefixed layer block wrappers
- **WHEN** `prefix` is set to `'acme'` and a component has base styles
- **THEN** the component's CSS SHALL be wrapped in `@layer acme.base { ... }` instead of `@layer base { ... }`

#### Scenario: No prefix (default behavior unchanged)
- **WHEN** `prefix` is not set
- **THEN** the CSS layer declaration SHALL be `@layer global, base, variants, compounds, states, system, custom;` (unchanged from current behavior)

### Requirement: Rust extractor accepts layer prefix parameter
The Rust `generate_css()`, `generate_sheets_from_slice()`, and `generate_utility_css_impl()` functions SHALL accept an optional `layer_prefix` parameter. When provided, all `@layer` emissions SHALL use `{prefix}.{name}` notation.

#### Scenario: Rust generate_css with prefix
- **WHEN** `generate_css()` is called with `layer_prefix = Some("acme")`
- **THEN** the output SHALL contain `@layer acme.global, acme.base, acme.variants, acme.compounds, acme.states, acme.system, acme.custom;` and all `@layer X {` blocks SHALL use prefixed names

#### Scenario: Rust generate_css without prefix
- **WHEN** `generate_css()` is called with `layer_prefix = None`
- **THEN** the output SHALL be identical to current behavior with bare layer names

#### Scenario: Rust generate_sheets_from_slice with prefix
- **WHEN** `generate_sheets_from_slice()` is called with `layer_prefix = Some("acme")`
- **THEN** the `declaration` field of `CssSheets` SHALL contain prefixed layer names and all per-layer CSS strings SHALL use prefixed `@layer` wrappers

### Requirement: TS assembly applies layer prefix
The `assembleStylesheet()` function SHALL accept an optional `prefix` parameter. When provided, it SHALL prefix all Animus layer names in the declaration line and in `@layer X {` block wrappers throughout the assembled CSS.

#### Scenario: assembleStylesheet with prefix
- **WHEN** `assembleStylesheet()` is called with `prefix: 'acme'`
- **THEN** the output CSS SHALL contain `@layer acme.global, acme.base, ...;` and all layer block wrappers SHALL use prefixed names

#### Scenario: assembleStylesheet without prefix
- **WHEN** `assembleStylesheet()` is called without a prefix
- **THEN** the output SHALL be identical to current behavior

### Requirement: Custom layer ordering composes with prefix
When both `layers` and `prefix` are provided, the `layers` array SHALL be processed with bare names (validation uses unprefixed names), and prefixing SHALL be applied after validation. Only the 7 Animus layer names SHALL be prefixed; consumer-provided layer names SHALL pass through unchanged.

#### Scenario: Consumer layers interleaved with prefix
- **WHEN** `prefix` is `'acme'` and `layers` is `['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides']`
- **THEN** the declaration SHALL be `@layer reset, acme.global, acme.base, acme.variants, acme.compounds, acme.states, acme.system, acme.custom, overrides;`

#### Scenario: Consumer layers without prefix
- **WHEN** `prefix` is not set and `layers` is `['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides']`
- **THEN** the declaration SHALL be `@layer reset, global, base, variants, compounds, states, system, custom, overrides;` (unchanged behavior)

### Requirement: applyPrefix handles layer names in CSS
The `applyPrefix()` function in `extract/pipeline/prefix.ts` SHALL transform `@layer` declarations and `@layer X {` block wrappers in CSS strings, prefixing only the known Animus layer names.

#### Scenario: Layer declaration line transformation
- **WHEN** `applyPrefix('acme', ...)` processes CSS containing `@layer global, base, variants, compounds, states, system, custom;`
- **THEN** the output SHALL contain `@layer acme.global, acme.base, acme.variants, acme.compounds, acme.states, acme.system, acme.custom;`

#### Scenario: Layer block wrapper transformation
- **WHEN** `applyPrefix('acme', ...)` processes CSS containing `@layer base { .animus-Foo { color: red } }`
- **THEN** the output SHALL contain `@layer acme.base { .acme-Foo { color: red } }`

#### Scenario: Non-Animus layer names are not prefixed
- **WHEN** `applyPrefix('acme', ...)` processes CSS containing `@layer reset, global, base;`
- **THEN** `reset` SHALL NOT be prefixed — output SHALL be `@layer reset, acme.global, acme.base;`
