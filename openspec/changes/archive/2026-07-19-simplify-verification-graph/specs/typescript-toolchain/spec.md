## MODIFIED Requirements

### Requirement: Soak Path for Type-Check Implementation Swaps

When the canonical type-check implementation changes, the change SHALL provide a parallel fallback script set invoking the prior implementation for at least one inner-loop cycle before removal in a follow-on change.

The fallback set MUST include a root diagnostic and per-package implementations with equivalent arguments. Fallback diagnostics MUST remain excluded from root `verify`, root `verify:full`, and every package-owned `verify` claim.

#### Scenario: Type-check swap ships with fallback diagnostics

- **WHEN** a change swaps the canonical type-check implementation
- **THEN** the same change adds a root fallback diagnostic
- **AND** per-package fallback commands mirror the prior invocation

#### Scenario: Fallback is excluded from complete claims

- **WHEN** a developer runs root or package-owned verification
- **THEN** no fallback diagnostic executes
- **AND** only the canonical implementation contributes to the verification claim

#### Scenario: Fallback is removed after soak

- **WHEN** the canonical implementation has remained stable for at least one calendar week
- **THEN** a follow-on change removes the root and per-package fallback commands
