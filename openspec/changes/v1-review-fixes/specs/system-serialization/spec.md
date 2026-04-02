## MODIFIED Requirements

### Requirement: System module export detection
The plugin's `loadSystem` subprocess SHALL detect SystemInstance exports by interface (`toConfig()` method presence), not by name convention.

#### Scenario: Non-standard export name
- **WHEN** the system file exports `export const myDs = createSystem().build()` (not named `ds`, `default`, or `system`)
- **THEN** the subprocess SHALL detect `myDs` as a valid SystemInstance via its `.toConfig()` method

#### Scenario: No valid export found
- **WHEN** no export satisfies `.toConfig()`
- **THEN** the subprocess SHALL throw with a message listing all found export names and stating that none had a `.toConfig()` method

#### Scenario: Multiple candidates
- **WHEN** multiple exports satisfy `.toConfig()`
- **THEN** the subprocess SHALL throw with a message listing the candidate export names and asking the user to specify which one

### Requirement: Error message accuracy
Error messages from `loadSystem` SHALL reference the actual method being checked (`.toConfig()`), not a different method (`.serialize()`).

#### Scenario: Error message content
- **WHEN** the system module fails to load or has no valid SystemInstance
- **THEN** the error message SHALL reference `.toConfig()` and SHALL NOT reference `.serialize()`
