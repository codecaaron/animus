## MODIFIED Requirements

### Requirement: System serialize() output
The `SystemInstance.serialize()` method SHALL return a `SerializedConfig` object containing `tokens`, `propConfig` (JSON string), `groupRegistry` (JSON string), `transforms` (name → function map), and optionally `globalStyles` (selector → style object map) when `.withGlobalStyles()` was called on the builder.

#### Scenario: Serialize with global styles
- **WHEN** `ds.serialize()` is called on a system built with `.withGlobalStyles({ 'html, body': { m: 0, bg: 'background' } })`
- **THEN** the returned object SHALL include `globalStyles: { 'html, body': { m: 0, bg: 'background' } }` as unresolved style objects

#### Scenario: Serialize without global styles
- **WHEN** `ds.serialize()` is called on a system built without `.withGlobalStyles()`
- **THEN** the returned object SHALL NOT include a `globalStyles` field

#### Scenario: Vite plugin reads globalStyles from serialize
- **WHEN** the Vite plugin calls `ds.serialize()` via bun subprocess at build start
- **THEN** the `globalStyles` field SHALL be available in the parsed output for the plugin to resolve and emit
