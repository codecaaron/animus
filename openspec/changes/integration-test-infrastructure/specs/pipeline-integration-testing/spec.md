## ADDED Requirements

### Requirement: Manifest shape validation test
The `_integration` test suite SHALL include a dedicated test file (`manifest-shape.test.ts`) that validates the structural shape and internal consistency of the `UniverseManifest` returned by `analyzeProject()`.

#### Scenario: Component descriptors are complete
- **WHEN** the manifest from `analyzeProject()` is inspected
- **THEN** every component in `components` SHALL have non-empty `file`, `binding`, `class_name`, `replacement`, `terminal`, and `tag` fields

#### Scenario: Files-to-components mapping is consistent
- **WHEN** `manifest.files` is inspected
- **THEN** every component_id in the values SHALL exist as a key in `manifest.components`

#### Scenario: Provenance is reciprocal
- **WHEN** `manifest.reverse_provenance` contains parent_id → [child_ids]
- **THEN** each child component's `extends_from` SHALL equal the parent_id
- **AND** each component with `extends_from` set SHALL appear in `reverse_provenance[extends_from]`

#### Scenario: Fragments are consistent with components
- **WHEN** `manifest.component_fragments` is inspected
- **THEN** every key SHALL exist in `manifest.components`
- **AND** extracted components SHALL have at least one non-empty fragment layer

### Requirement: Dynamic props boundary test
The `_integration` test suite SHALL assert that components with only static literal prop values produce zero dynamic_props entries, and components with non-static values produce correct dynamic prop metadata.

#### Scenario: Fully static component has no dynamic props
- **WHEN** a fixture component uses only static string literals for all style values
- **THEN** the manifest SHALL contain zero entries in `dynamic_props` for that component's prop names
- **AND** all style properties SHALL appear in the component's CSS output

#### Scenario: Mixed static/dynamic component produces correct split
- **WHEN** a fixture component has some static literal values and some non-static values (identifiers, function calls)
- **THEN** static values SHALL appear in the component's CSS output
- **AND** non-static values SHALL appear in `dynamic_props` with `var_name`, `slot_class`, and `property` fields
- **AND** the bailed properties SHALL NOT disappear — they MUST produce CSS variable slot rules in `@layer anm-system`

### Requirement: System prop map validation
The `_integration` test suite SHALL assert that `system_prop_map` contains entries for system props used in fixture JSX.

#### Scenario: Used system props appear in map
- **WHEN** a fixture component's JSX includes system prop usage (e.g., `<Box p={4}>`)
- **THEN** `manifest.system_prop_map` SHALL contain an entry for that prop name
- **AND** the value mapping SHALL map to class names prefixed with `animus-u-` (the Animus utility-class prefix; the original proposal's `anm-` was stale — that's the layer prefix, distinct from the class prefix)
