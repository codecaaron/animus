## ADDED Requirements

### Requirement: Per-component CSS fragments in manifest
The Rust crate SHALL produce per-component CSS fragments alongside the existing concatenated per-layer `CssSheets`. Each component's CSS SHALL be individually addressable by component_id, containing separate strings for base, variants, compounds, states, and custom layers.

#### Scenario: Component with base and variants
- **WHEN** component `Button` has base styles and two variant props
- **THEN** the manifest SHALL contain a `component_css` entry keyed by `Button`'s component_id with separate `base`, `variants`, `compounds`, `states`, and `custom` strings

#### Scenario: Component with no styles in a layer
- **WHEN** component `Divider` has base styles but no variants, states, or custom props
- **THEN** the `component_css` entry SHALL have a non-empty `base` string and empty strings for `variants`, `states`, `compounds`, and `custom`

#### Scenario: Extended component is self-contained
- **WHEN** component `FancyCard` extends `Card`
- **THEN** `FancyCard`'s `component_css` entry SHALL contain the fully merged CSS (parent + child), not a reference to the parent's CSS

### Requirement: Existing CssSheets unchanged
The existing `CssSheets` struct with concatenated per-layer strings SHALL remain unchanged. Per-component CSS is additive — single-file mode uses `CssSheets`, splitting mode uses per-component fragments.

#### Scenario: Single-file mode unaffected
- **WHEN** the bundler plugin uses single-file mode (default)
- **THEN** it SHALL use the existing `CssSheets` concatenation, ignoring per-component fragments
