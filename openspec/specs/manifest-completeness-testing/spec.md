## Purpose

The `_integration` test suite SHALL include assertions validating the structural shape of the `UniverseManifest` returned by `analyzeProject()`. These assertions protect the NAPI manifest contract against silent field drift: fragments, provenance, dynamic-prop metadata, and system-prop maps must all remain internally consistent with the `components` registry.

## Requirements

### Requirement: Manifest shape assertions
The `_integration` test suite SHALL include assertions that validate the structural shape of the `UniverseManifest` returned by `analyzeProject()`.

#### Scenario: Components have required fields
- **WHEN** the manifest is inspected
- **THEN** every entry in `components` SHALL have non-empty: `file`, `binding`, `class_name`, `replacement`, `terminal`, `tag`

#### Scenario: Files mapping is consistent
- **WHEN** the manifest is inspected
- **THEN** every component_id referenced in `files` values SHALL exist as a key in `components`

### Requirement: Provenance reciprocity
The manifest's provenance and reverse_provenance fields SHALL be reciprocally consistent.

#### Scenario: Reverse provenance matches provenance
- **WHEN** a component A appears in `reverse_provenance[B]` (B is parent, A is child)
- **THEN** component A's `extends_from` field SHALL equal B's component_id

#### Scenario: Extension chains are complete
- **WHEN** a component has `extends_from` set to a parent_id
- **THEN** the parent_id SHALL exist in `components`
- **AND** the component's id SHALL appear in `reverse_provenance[parent_id]`

### Requirement: Fragment coverage
The manifest's `component_fragments` SHALL be consistent with `components`.

#### Scenario: Fragments exist for extracted components
- **WHEN** a component in `components` has extractable CSS (not fully bailed)
- **THEN** a corresponding entry SHALL exist in `component_fragments` with at least one non-empty layer (base, variants, compounds, or states)

#### Scenario: No orphan fragments
- **WHEN** `component_fragments` is inspected
- **THEN** every key SHALL correspond to a component_id that exists in `components`

### Requirement: Dynamic props correctness
The manifest's `dynamic_props` SHALL only contain props with detected non-static usage.

#### Scenario: Dynamic prop has required metadata
- **WHEN** a prop appears in `dynamic_props`
- **THEN** it SHALL have non-empty `var_name`, `slot_class`, and `property` fields

#### Scenario: Static-only component has no dynamic props
- **WHEN** a fixture component uses only static string literal values for all props
- **THEN** the manifest SHALL have zero entries in `dynamic_props` for that component's prop names

### Requirement: System prop map population
The manifest's `system_prop_map` SHALL contain entries for system props used across all extracted components.

#### Scenario: Used system props are mapped
- **WHEN** any extracted component's JSX usage includes system props (e.g., `p={4}`)
- **THEN** `system_prop_map` SHALL contain an entry for that prop with the used value mapping to a class name

#### Scenario: System prop class names use correct prefix
- **WHEN** `system_prop_map` entries are inspected
- **THEN** all class name values SHALL start with `animus-u-` (the Animus utility-class prefix; `anm-` in the integration-test-infrastructure proposal was stale from the layer-prefix rename in session 60 — the class prefix is distinct from the layer prefix)
