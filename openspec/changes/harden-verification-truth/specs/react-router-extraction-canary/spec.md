## ADDED Requirements

### Requirement: React Router served-client CSS proof

The React Router assertion tier SHALL validate non-empty Animus semantic CSS beneath the Wrangler-served client asset root independently from server CSS.

#### Scenario: CSS exists only in server output

- **WHEN** valid Animus CSS exists under React Router server output and no valid Animus CSS exists under `build/client`
- **THEN** `verify:assert:react-router` exits non-zero and identifies the missing served-client CSS

#### Scenario: Client CSS contains extracted output

- **WHEN** `build/client` contains the required layers, variables, and Animus class output
- **THEN** the served-client CSS assertion succeeds without reading server CSS
