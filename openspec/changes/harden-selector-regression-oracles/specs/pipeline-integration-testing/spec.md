## MODIFIED Requirements

### Requirement: Selector-rule fixture matrix registered

The integration test suite SHALL maintain a permanent selector-rule authoring fixture matrix at `_integration/fixtures/components/selector-rules/` covering the authoring cross-product that previously exposed regressions: raw-selector + alias mixes, token references inside shorthand values, compound aliases (e.g. `_selected`), `createElement(bareIdent, ...)` usage patterns, unresolvable tokens (characterization), and full chains (`.styles+_hover+_focusVisible+.variant+.states`). The matrix SHALL serve as regression acceptance criteria. A currently broken behavior SHALL be expressed as a sealed test paired with a skipped acceptance test. Once fixed, its seal SHALL be removed, its acceptance test SHALL remain active, and its prose SHALL describe the current behavior. Engine-specific compatibility characterizations SHALL assert each engine's licensed observable result rather than force a shared expectation.

#### Scenario: Selector-rules fixture directory discoverable

- **WHEN** an integration test requires a selector-rule fixture
- **THEN** it SHALL be loadable via `readFixtureFile(join(__dirname, '..', 'fixtures', 'components', 'selector-rules'), filename)`

#### Scenario: Top-level fixture walk does not include the subdirectory

- **WHEN** a multi-file test calls `readFixtureFiles(COMPONENTS)` on the top-level `components/` directory
- **THEN** the walk SHALL NOT recurse into `selector-rules/` — selector-rule fixtures SHALL NOT leak into unrelated multi-file test scope

#### Scenario: Broken behavior is sealed until repaired

- **WHEN** a known selector regression still reproduces
- **THEN** a passing seal SHALL assert the current broken behavior and a paired skipped acceptance test SHALL state the expected post-fix behavior

#### Scenario: Fixed regression remains an active guard

- **WHEN** the selector regression no longer reproduces
- **THEN** the seal SHALL be absent, the acceptance test SHALL run, and its description and fixture prose SHALL state the fixed current behavior

#### Scenario: Unresolvable selector alias remains engine-local

- **WHEN** the v1 integration pipeline extracts the fixture containing `{colors.does-not-exist.999}` inside an `outline` alias
- **THEN** its active compatibility test SHALL observe the raw unresolved token in v1 CSS, while v2 parity SHALL observe the declaration omitted with an unresolvable-alias diagnostic
