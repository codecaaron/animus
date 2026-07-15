## Purpose

Requirements for the `cascade-round-trip-testing` capability: Multi-target prop combinations produce correct CSS through Lightning CSS; esbuild minification preserves the same computed values; Test uses real NAPI pipeline.

## Requirements

### Requirement: Multi-target prop combinations produce correct CSS through Lightning CSS

For every combination of multi-target shorthand + overlapping longhand + true shorthand, the CSS emitted by the Rust pipeline and then consolidated by Lightning CSS `transform()` SHALL produce the same computed property values as the un-consolidated CSS would in a browser.

#### Scenario: px + pl — tier 1 multi-target + tier 2 longhand

- **GIVEN** a component with `styles({ px: 4, pl: 8 })`
- **WHEN** the emitted CSS is passed through Lightning CSS `transform({ minify: false })`
- **THEN** the consolidated output SHALL have `padding-left` equal to the `pl` value (longhand wins over multi-target's padding-left)
- **AND** `padding-right` SHALL equal the `px` value

#### Scenario: py + pt — tier 1 multi-target + tier 2 longhand

- **GIVEN** a component with `styles({ py: 4, pt: 8 })`
- **WHEN** the emitted CSS is passed through Lightning CSS
- **THEN** `padding-top` SHALL equal the `pt` value (longhand wins)
- **AND** `padding-bottom` SHALL equal the `py` value

#### Scenario: p + px + pl — all three tiers

- **GIVEN** a component with `styles({ p: 12, px: 8, pl: 4 })`
- **WHEN** the emitted CSS is passed through Lightning CSS
- **THEN** `padding-left` SHALL equal the `pl` value (tier 2 wins)
- **AND** `padding-right` SHALL equal the `px` value (tier 1 wins over tier 0)
- **AND** `padding-top` and `padding-bottom` SHALL equal the `p` value (tier 0, uncontested)

#### Scenario: px + py + pt — two tier 1 props + tier 2 override

- **GIVEN** a component with `styles({ px: 4, py: 4, pt: 8 })`
- **WHEN** the emitted CSS is passed through Lightning CSS
- **THEN** `padding-top` SHALL equal the `pt` value (tier 2 wins over py's padding-top)
- **AND** all other sides SHALL equal the `px`/`py` values

#### Scenario: Margin equivalents

- **GIVEN** components with `styles({ mx: 4, ml: 8 })`, `styles({ m: 12, mx: 8, ml: 4 })`, `styles({ my: 4, mt: 8 })`
- **WHEN** the emitted CSS is passed through Lightning CSS
- **THEN** the same tier precedence rules SHALL apply as for padding (tier 2 > tier 1 > tier 0)

### Requirement: esbuild minification preserves the same computed values

For the same set of multi-target prop combinations, CSS passed through esbuild `transform({ minify: true, loader: 'css' })` SHALL produce the same computed property values as the original un-consolidated CSS.

#### Scenario: esbuild consolidation matches Lightning CSS

- **GIVEN** any component CSS from the round-trip test fixtures
- **WHEN** passed through both Lightning CSS and esbuild
- **THEN** the computed padding/margin values SHALL be identical between the two outputs

### Requirement: Test uses real NAPI pipeline

The round-trip test SHALL exercise the real Rust extraction pipeline via `analyzeProject()` rather than hand-constructing CSS. This validates the actual tier ordering, multi-target expansion, and theme resolution — the full bridge from JS object to CSS.

#### Scenario: Fixture components defined with real builder chains

- **GIVEN** test fixture files using `El.styles({...}).asElement('div')` with multi-target prop combinations
- **WHEN** `analyzeProject()` is called on the fixture files
- **THEN** the returned manifest SHALL contain CSS for each component
- **AND** that CSS SHALL be used as input for the Lightning CSS and esbuild round-trip assertions
