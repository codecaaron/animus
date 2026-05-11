## ADDED Requirements

### Requirement: Unit fallback in transform post-processing
The Vite plugin SHALL apply unit fallback after resolving `__TRANSFORM__` placeholders. Both the in-memory path (`applyTransformPlaceholders`) and the subprocess fallback path (`resolveTransformPlaceholders`) SHALL include the unit fallback pass.

#### Scenario: In-memory path applies unit fallback
- **WHEN** the system provides transforms via `serialize().transforms` and CSS is resolved in-memory
- **THEN** unit fallback SHALL be applied after transform resolution

#### Scenario: Subprocess path applies unit fallback
- **WHEN** transform resolution falls back to the bun subprocess
- **THEN** the subprocess output SHALL have unit fallback applied before being used
