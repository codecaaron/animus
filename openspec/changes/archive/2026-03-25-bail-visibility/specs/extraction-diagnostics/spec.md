## ADDED Requirements

### Requirement: Extraction diagnostics in manifest
The project analysis manifest SHALL include a `diagnostics` array containing bail reasons and per-property skip warnings for all analyzed components.

#### Scenario: Bail diagnostic included
- **WHEN** a chain bails during project analysis (e.g., unknown method, spread element)
- **THEN** the manifest SHALL include a diagnostic with `kind: "bail"`, the component binding name, the file path, and the bail reason message

#### Scenario: Skip diagnostic included
- **WHEN** a property is skipped during extraction (e.g., variable reference, function call)
- **THEN** the manifest SHALL include a diagnostic with `kind: "skip"`, the component binding name, the file path, and a message describing which property was skipped and why

#### Scenario: No diagnostics when fully extracted
- **WHEN** all chains extract successfully with no skipped properties
- **THEN** the `diagnostics` array SHALL be empty

### Requirement: Diagnostics are always-on in console
The Vite plugin SHALL print extraction diagnostics (bail and skip warnings) to the console by default, NOT gated by the `verbose` flag. This matches the existing behavior of elimination warnings.

#### Scenario: Bail warning printed by default
- **WHEN** the manifest contains a bail diagnostic
- **THEN** the plugin SHALL print `[animus] ⚠ ComponentName not extracted: reason` via the Vite logger warn channel

#### Scenario: Skip warning printed by default
- **WHEN** the manifest contains a skip diagnostic
- **THEN** the plugin SHALL print `[animus] ⚠ ComponentName: skipped property 'propName' (reason)` via the Vite logger warn channel

#### Scenario: Verbose mode not required
- **WHEN** the `verbose` option is false and `ANIMUS_DEBUG` is not set
- **THEN** bail and skip warnings SHALL still be printed
