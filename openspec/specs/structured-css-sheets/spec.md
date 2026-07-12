## Purpose

Requirements for the `structured-css-sheets` capability: Rust crate returns per-layer CSS sheets; Backward-compatible css field preserved; Layer declaration is a standalone sheet.

## Requirements

### Requirement: Rust crate returns per-layer CSS sheets

The `UniverseManifest` returned by `analyze_project` SHALL include a `sheets` field containing individual CSS strings for each layer: `declaration`, `base`, `variants`, `states`, `system`, and `custom`. When compose families exist, the `variants` and `compounds` sheet strings SHALL include sublayer wrappers (`@layer standalone { ... }` and `@layer composed { ... }`). The `sheets` field SHALL be derived from per-component fragments via pre-allocated concatenation in topological order.

#### Scenario: Manifest includes structured sheets

- **WHEN** `analyze_project` is called with valid file entries
- **THEN** the returned manifest JSON includes a `sheets` object with string fields: `declaration`, `base`, `variants`, `states`, `system`, `custom`

#### Scenario: Sheets derived from fragments

- **WHEN** `sheets.base` is computed
- **THEN** it SHALL be the concatenation of all per-component base fragments in topological order, produced via a pre-allocated fold (`String::with_capacity(total_bytes)`)

#### Scenario: Sheets content matches concatenated CSS

- **WHEN** all sheet strings are concatenated in order (declaration + base + variants + states + system + custom)
- **THEN** the result is identical to the `css` field content

#### Scenario: Variants sheet includes sublayer structure

- **WHEN** compose families exist in the project
- **THEN** `sheets.variants` SHALL contain `@layer standalone, composed;` followed by `@layer standalone { ... }` and `@layer composed { ... }` blocks inside the `@layer variants { }` wrapper

#### Scenario: Variants sheet flat without compose

- **WHEN** no compose families exist
- **THEN** `sheets.variants` SHALL contain variant rules directly inside `@layer variants { }` with no sublayer structure

#### Scenario: Empty layers produce empty strings

- **WHEN** no components have variant styles
- **THEN** `sheets.variants` is an empty string
- **AND** `sheets.declaration` still includes `variants` in the layer ordering

### Requirement: Backward-compatible css field preserved

The `UniverseManifest` SHALL continue to include the `css` field as the full concatenation of all layer CSS, maintaining backward compatibility with existing consumers.

#### Scenario: css field unchanged for existing consumers

- **WHEN** a consumer reads `manifest.css`
- **THEN** the content is identical to the previous behavior (layer declaration + base + variants + states + system + custom concatenated)

### Requirement: Layer declaration is a standalone sheet

The `sheets.declaration` field SHALL contain exactly the `@layer` ordering statement and nothing else, allowing consumers to place it independently of the component CSS.

#### Scenario: Declaration contains only the ordering statement

- **WHEN** `sheets.declaration` is read
- **THEN** it contains `@layer global, base, variants, states, system, custom;` followed by a newline
- **AND** it does not contain any rule blocks
