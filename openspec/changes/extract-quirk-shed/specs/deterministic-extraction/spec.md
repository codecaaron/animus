# deterministic-extraction

## ADDED Requirements

### Requirement: Emitted CSS is always parseable
The extraction pipeline SHALL NOT emit CSS that fails standards-based parsing. An unresolvable token alias SHALL NOT pass through as a raw `{scale.path}` literal; the carrying declaration SHALL be dropped or replaced with a diagnosed fallback.

#### Scenario: Unresolvable alias in a component style
- **WHEN** a style value references a token alias absent from the theme and variable map
- **THEN** the emitted sheets SHALL parse cleanly under the harness css-validity check and a diagnostic SHALL identify the component, property, and unresolved alias
