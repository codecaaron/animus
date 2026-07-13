# next-config-wrapper

## ADDED Requirements

### Requirement: Engine selection option

The wrapper options SHALL include an optional engine field accepting v1 or v2, defaulting to v1, and the wrapper SHALL propagate the selection to every compiler instance's extraction calls, including non-owning instances.

#### Scenario: Unset engine preserves behavior

- WHEN wrapper options omit the engine field
- THEN builds behave identically to versions predating the field

#### Scenario: Selection reaches all compiler instances

- WHEN wrapper options set engine to v2 in a multi-compiler build
- THEN owning and non-owning compiler instances all route extraction through the v2 engine
