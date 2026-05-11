## MODIFIED Requirements

### Requirement: Rust crate returns per-layer CSS sheets
The `UniverseManifest` returned by `analyze_project` SHALL include a `sheets` field containing individual CSS strings for each layer: `declaration`, `base`, `variants`, `states`, `system`, and `custom`. When compose families exist, the `variants` and `compounds` sheet strings SHALL include sublayer wrappers (`@layer standalone { ... }` and `@layer composed { ... }`).

#### Scenario: Manifest includes structured sheets
- **WHEN** `analyze_project` is called with valid file entries
- **THEN** the returned manifest JSON includes a `sheets` object with string fields: `declaration`, `base`, `variants`, `states`, `system`, `custom`

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
