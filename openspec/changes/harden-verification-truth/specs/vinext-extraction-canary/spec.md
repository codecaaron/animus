## ADDED Requirements

### Requirement: Vinext served-client CSS proof

The Vinext assertion tier SHALL validate non-empty Animus semantic CSS beneath the Wrangler-served client asset root independently from server CSS.

#### Scenario: CSS exists only in server output

- **WHEN** valid Animus CSS exists under Vinext server output and no valid Animus CSS exists under `dist/client`
- **THEN** `verify:assert:vinext` exits non-zero and identifies the missing served-client CSS

#### Scenario: Client CSS contains extracted output

- **WHEN** `dist/client` contains the required layers, variables, and Animus class output
- **THEN** the served-client CSS assertion succeeds without reading server CSS

