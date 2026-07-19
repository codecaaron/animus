## MODIFIED Requirements

### Requirement: Engine identity in verification receipts

Consumer owner claims, their package-owned assertion diagnostics, and packed verification SHALL record engine identity in their existing receipts. Renaming or relocating the command owner SHALL not weaken default/override engine evidence.

#### Scenario: Consumer lane completes

- **WHEN** a package-owned consumer `verify` claim or `verify:packed` completes
- **THEN** its receipt records the selected engine and relevant default/override identity

#### Scenario: Default engine flips for a consumer

- **WHEN** a consumer's default engine changes
- **THEN** the receipt identifies the new default distinctly from an explicit override
