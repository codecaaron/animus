# next-config-wrapper

## MODIFIED Requirements

### Requirement: Engine selection option

The wrapper options SHALL include an optional engine field accepting v1 or v2, defaulting to v2, and the wrapper SHALL propagate the selection to every compiler instance's extraction calls, including non-owning instances. `'v1'` SHALL remain selectable and functional until v1 is retired.

#### Scenario: Unconfigured wrapper uses v2

- **WHEN** `withAnimus` is applied without an `engine` option
- **THEN** the shared engine selection SHALL be `'v2'` and the loader SHALL transform through the v2 handle

#### Scenario: Selection reaches all compiler instances

- **WHEN** wrapper options set engine to v2 in a multi-compiler build
- **THEN** owning and non-owning compiler instances all route extraction through the v2 engine
