## ADDED Requirements

### Requirement: Selector registry passed to extraction pipeline
The Vite plugin SHALL pass the selector registry from the serialized system config to the Rust extraction functions. The registry SHALL be included in the config JSON alongside prop config and group registry.

#### Scenario: Selector registry forwarded at build start
- **WHEN** the system is loaded at `buildStart` and `serialize()` returns a `selectors` field
- **THEN** the plugin SHALL include the selector registry in all subsequent calls to `analyze_project()` and `extract()`

#### Scenario: No selectors in serialized config
- **WHEN** `serialize()` returns no `selectors` field (or `undefined`)
- **THEN** the plugin SHALL pass an empty registry (or omit the field) — extraction proceeds without selector expansion

#### Scenario: Selector registry available in dev mode
- **WHEN** the dev server is running and a geological reset reloads the system
- **THEN** the updated selector registry SHALL be used for all subsequent HMR extractions
