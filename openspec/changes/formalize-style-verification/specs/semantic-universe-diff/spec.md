## ADDED Requirements

### Requirement: Normalized universe diffing

Given two universe manifests of the same mode and contract schema version, the harness SHALL produce a normalized semantic diff covering components added and removed, declaration-level changes per component and layer, dynamic-residue changes, drop-outcome changes, and provenance-edge changes.

#### Scenario: Variant option added

- **WHEN** an edit adds a variant option to a component between two analyses
- **THEN** the diff lists the new option under that component with its generated declarations

#### Scenario: Identical states

- **WHEN** two analyses of an unchanged workspace are diffed
- **THEN** the diff is empty

### Requirement: Equivalence verdicts are bounded

Every equivalence result SHALL name the observable contract it compared and the covered input region, and SHALL NOT claim equivalence beyond them.

#### Scenario: Refactor equivalence

- **WHEN** a chain refactor produces a manifest whose diff against the pre-refactor manifest is empty over the enumerated universe
- **THEN** the result reports equivalence over the named observable contract and the named covered region, with symbolic holes listed as exclusions

### Requirement: Governance comment artifact

The harness SHALL render a universe diff as a review artifact summarizing semantic changes, provenance, residue and drop deltas, and per-item verdicts with confidence, suitable for posting on a pull request.

#### Scenario: PR with a styling change

- **WHEN** a pull request changes a component's styles
- **THEN** the rendered artifact names each affected component, the declaration-level change, its provenance, and a verdict for each claimed effect

### Requirement: Invisible-edit alarm

The harness SHALL flag any edit whose code diff touches style-bearing expressions while its universe diff is empty.

#### Scenario: Styling moved into a spread

- **WHEN** an edit relocates a static prop into a spread-carried object and the universe diff is empty
- **THEN** the harness reports an invisible-edit flag naming the touched sites rather than reporting a clean result
