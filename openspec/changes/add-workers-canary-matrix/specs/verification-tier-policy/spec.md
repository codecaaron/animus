## ADDED Requirements

### Requirement: Vinext atomic and focused verification

The verification graph SHALL provide atomic Vinext build and assertion tiers plus a focused composite that runs both in dependency order.

#### Scenario: Run focused Vinext verification

- **WHEN** a developer invokes the focused Vinext verification tier
- **THEN** the Vinext production build runs before its structural output assertions

### Requirement: React Router atomic and focused verification

The verification graph SHALL provide atomic React Router build and assertion tiers plus a focused composite that runs both in dependency order.

#### Scenario: Run focused React Router verification

- **WHEN** a developer invokes the focused React Router verification tier
- **THEN** the React Router production build runs before its structural output assertions

### Requirement: Worker deployment dry-run tiers

The verification graph SHALL provide credential-free deployment dry-run tiers for showcase, Vite, Vinext, and React Router targets.

#### Scenario: Run a deployment dry run

- **WHEN** a developer invokes one target's deployment dry-run tier after its production build
- **THEN** the tier validates that target's Worker bundle and assets without changing remote state

### Requirement: Complete verification includes Worker canaries

The complete local verification graph SHALL include the Vinext and React Router build/assert tiers and all four deployment dry runs while the fast inner-loop graph remains free of application builds.

#### Scenario: Run complete verification

- **WHEN** a developer invokes `vp run verify:full`
- **THEN** the existing gates and the complete Worker canary matrix execute

#### Scenario: Run the fast gate

- **WHEN** a developer invokes `vp run verify`
- **THEN** no showcase, Vite, Vinext, or React Router application build executes
