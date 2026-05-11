## ADDED Requirements

### Requirement: Layer names are prefixed with dash-prefixed flat layers
When the `prefix` option is set, all 7 Animus `@layer` names SHALL be emitted as dash-prefixed namespaced layers. The bare layer name `base` SHALL become `{prefix}-base` in all CSS output.

#### Scenario: Prefixed layer declaration
- **WHEN** `prefix` is set to `'acme'`
- **THEN** the CSS layer declaration SHALL be `@layer acme-global, acme-base, acme-variants, acme-compounds, acme-states, acme-system, acme-custom;`

#### Scenario: Prefixed layer block wrappers
- **WHEN** `prefix` is set to `'acme'` and a component has base styles
- **THEN** the component's CSS SHALL be wrapped in `@layer acme-base { ... }` instead of `@layer base { ... }`

#### Scenario: No prefix (default behavior unchanged)
- **WHEN** `prefix` is not set
- **THEN** the CSS layer declaration SHALL be `@layer global, base, variants, compounds, states, system, custom;` (unchanged from current behavior)

### Requirement: Rust extractor accepts layer prefix parameter
The Rust `generate_css()`, `generate_sheets_from_slice()`, and `generate_utility_css_impl()` functions SHALL accept an optional `layer_prefix` parameter. When provided, all `@layer` emissions SHALL use `{prefix}-{name}` notation.

#### Scenario: Rust generate_css with prefix
- **WHEN** `generate_css()` is called with `layer_prefix = Some("acme")`
- **THEN** the output SHALL contain `@layer acme-global, acme-base, acme-variants, acme-compounds, acme-states, acme-system, acme-custom;` and all `@layer X {` blocks SHALL use prefixed names

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
- **THEN** the output CSS SHALL contain `@layer acme-global, acme-base, ...;` and all layer block wrappers SHALL use prefixed names

#### Scenario: assembleStylesheet without prefix
- **WHEN** `assembleStylesheet()` is called without a prefix
- **THEN** the output SHALL be identical to current behavior

### Requirement: Custom layer ordering composes with prefix
When both `layers` and `prefix` are provided, the `layers` array SHALL contain the actual CSS layer names — consumers write `{prefix}-{name}` for Animus layers. `validateLayerOrder(layers, prefix)` SHALL check for prefixed Animus names as the required subsequence. Layer names are emitted as-is with no silent transformation.

#### Scenario: Consumer layers interleaved with prefix
- **WHEN** `prefix` is `'acme'` and `layers` is `['reset', 'acme-global', 'acme-base', 'acme-variants', 'acme-compounds', 'acme-states', 'acme-system', 'acme-custom', 'overrides']`
- **THEN** the declaration SHALL be `@layer reset, acme-global, acme-base, acme-variants, acme-compounds, acme-states, acme-system, acme-custom, overrides;`

#### Scenario: Framework coexistence (e.g. Tailwind)
- **WHEN** `prefix` is `'acme'` and `layers` is `['base', 'acme-global', 'acme-base', 'acme-variants', 'acme-compounds', 'acme-states', 'acme-system', 'acme-custom', 'utilities']`
- **THEN** the declaration SHALL be `@layer base, acme-global, acme-base, acme-variants, acme-compounds, acme-states, acme-system, acme-custom, utilities;` (TW's bare `base` and Animus's `acme-base` coexist)

#### Scenario: Consumer layers without prefix
- **WHEN** `prefix` is not set and `layers` is `['reset', 'global', 'base', 'variants', 'compounds', 'states', 'system', 'custom', 'overrides']`
- **THEN** the declaration SHALL be `@layer reset, global, base, variants, compounds, states, system, custom, overrides;` (unchanged behavior)

### Requirement: applyPrefix unchanged — layer prefixing at emission points
The `applyPrefix()` function in `extract/pipeline/prefix.ts` SHALL NOT be modified for `@layer` handling. Layer name prefixing is handled at emission points: Rust CSS generators apply `prefix_layer()` to all `@layer` block wrappers, and `assembleStylesheet()` applies `prefixLayerName()` to the default layer declaration. `applyPrefix()` continues to handle only CSS variables and class names.

#### Scenario: applyPrefix does not transform layer names
- **WHEN** `applyPrefix('acme', ...)` is called with CSS variable data
- **THEN** the function SHALL transform `--color-*` and `var(--color-*)` as before, with no `@layer` handling (its inputs never contain `@layer` content)
