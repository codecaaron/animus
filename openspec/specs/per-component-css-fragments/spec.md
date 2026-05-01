## Purpose

Per-component CSS fragment generation for the 4 splittable layers (base, variants, compounds, states). Fragments enable targeted HMR splice, granular cache invalidation via reverse provenance, and fine-grained manifest introspection — while preserving cascade correctness through topological ordering.

## Requirements

### Requirement: Per-component CSS fragment generation

The Rust CSS generator SHALL retain per-component CSS fragments for the 4 splittable layers (base, variants, compounds, states) during generation. Each fragment SHALL be keyed by component_id and contain only that component's CSS contribution to the layer. Fragments SHALL be stored in topological order (matching `reconciled_order`) to preserve cascade correctness.

#### Scenario: Component with base and variants produces fragments

- **WHEN** a component `Button` has base styles and two variant props
- **THEN** fragments SHALL contain an entry for `Button`'s component_id in `base` (with the base rule block) and in `variants` (with variant option rule blocks)
- **AND** the `compounds` and `states` entries for `Button` SHALL be absent (not empty strings)

#### Scenario: Fragment concatenation equals CssSheets

- **WHEN** all base fragments are concatenated in insertion order
- **THEN** the result SHALL be byte-identical to `CssSheets.base`
- **AND** the same invariant SHALL hold for variants, compounds, and states

#### Scenario: Topological ordering preserved

- **WHEN** component `PrimaryButton` extends `Button`
- **THEN** `Button`'s fragment SHALL appear before `PrimaryButton`'s fragment in the base vec
- **AND** this ordering SHALL match the existing `reconciled_order` used by `generate_css_sheets_ordered()`

#### Scenario: Empty layers produce no fragment entries

- **WHEN** no components have compound styles
- **THEN** the compounds fragment collection SHALL be empty (zero entries)

### Requirement: Single-pass fragment generation

The CSS generator SHALL produce fragments for all 4 splittable layers in a single iteration over the component list, replacing the current 4-pass `generate_layer_content_slice()` approach.

#### Scenario: All layers populated in one pass

- **WHEN** `generate_css_sheets_ordered()` is called with N components
- **THEN** the component list SHALL be iterated exactly once, producing base, variants, compounds, and states fragments for each component in a single traversal

### Requirement: Fragment lookup index

The fragment storage SHALL maintain a side index (`FxHashMap<String, usize>`) mapping component_id to vec position for O(1) lookup. This enables HMR splice operations without scanning.

#### Scenario: Lookup by component_id

- **WHEN** a plugin needs the base CSS for component `src/Button.tsx::Button`
- **THEN** the side index SHALL return the vec index in O(1) time
- **AND** the fragment at that index SHALL contain the component's base CSS

### Requirement: PerComponentSheets serialization in manifest

The `UniverseManifest` SHALL include a `component_fragments` field containing a `HashMap<String, PerComponentSheets>` where `PerComponentSheets` has optional fields for each splittable layer. Empty layers SHALL be omitted from serialization via `skip_serializing_if`.

#### Scenario: Manifest JSON includes fragments

- **WHEN** `analyzeProject()` returns the manifest JSON
- **THEN** the JSON SHALL include a `component_fragments` object keyed by component_id, with each value containing only non-empty layer fields (`base`, `variants`, `compounds`, `states`)

#### Scenario: Component with only base styles

- **WHEN** a component has base styles but no variants, compounds, or states
- **THEN** its `component_fragments` entry SHALL contain only `{ "base": "..." }` — no null or empty string fields

### Requirement: Reverse adjacency index for extension chains

The manifest SHALL include a `reverse_provenance` field mapping each component_id to its direct children (components that extend it). This enables transitive cache invalidation when a parent component's CSS changes.

#### Scenario: Parent with two children

- **WHEN** `PrimaryButton` and `DangerButton` both extend `Button`
- **THEN** `reverse_provenance["Button_id"]` SHALL contain both `PrimaryButton_id` and `DangerButton_id`

#### Scenario: Leaf component with no children

- **WHEN** a component is never extended by another component
- **THEN** it SHALL NOT appear as a key in `reverse_provenance`

#### Scenario: Transitive invalidation

- **WHEN** `Button` changes and `PrimaryButton` extends `Button` and `SpecialPrimary` extends `PrimaryButton`
- **THEN** a BFS traversal of `reverse_provenance` starting from `Button` SHALL reach both `PrimaryButton` and `SpecialPrimary`
