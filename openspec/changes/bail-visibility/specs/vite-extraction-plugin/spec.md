## ADDED Requirements

### Requirement: Plugin reads and prints extraction diagnostics
The Vite plugin SHALL read the `diagnostics` array from the project analysis manifest and print each diagnostic via the `warn()` helper during `buildStart`. Diagnostics SHALL NOT be gated by the `verbose` flag.

#### Scenario: Diagnostics printed after analysis
- **WHEN** `buildStart` completes project analysis and the manifest contains diagnostics
- **THEN** the plugin SHALL print each diagnostic immediately after the existing elimination warnings

#### Scenario: No diagnostics produces no output
- **WHEN** the manifest has an empty `diagnostics` array
- **THEN** no additional warnings SHALL be printed
