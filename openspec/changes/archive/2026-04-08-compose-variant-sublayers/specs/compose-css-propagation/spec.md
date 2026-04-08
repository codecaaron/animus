## MODIFIED Requirements

### Requirement: Two-rule composed variant emission
For each shared variant option on each child slot in a composed family, the extraction pipeline SHALL emit two CSS rules within `@layer variants.composed`: an inheritance rule and an override rule.

#### Scenario: Inheritance rule structure
- **WHEN** a composed family has Root with variant `size` (options: `sm`, `md`) and Child is a slot with a `size` variant
- **THEN** the pipeline SHALL emit an inheritance rule: `.{root-class}--size-sm .{child-class} { ...child's size-sm declarations... }` for each option

#### Scenario: Override rule structure
- **WHEN** a composed family has Root with variant `size` and Child has a `size` variant
- **THEN** the pipeline SHALL emit an override rule: `.{root-class} .{child-class}.{child-class}--size-sm { ...child's size-sm declarations... }` for each option

#### Scenario: Specificity contract within composed sublayer
- **WHEN** both the inheritance rule and override rule are emitted for the same variant option
- **THEN** the inheritance rule SHALL have specificity (0,2,0) and the override rule SHALL have specificity (0,3,0) — a structural invariant of the selector shapes

#### Scenario: Override beats inheritance by specificity
- **WHEN** both inheritance and override rules match within `@layer variants.composed`
- **THEN** the override rule SHALL win by specificity regardless of source order

### Requirement: Layer placement
Composed variant rules SHALL be emitted within `@layer variants.composed` when sublayers are provisioned, or within `@layer variants` directly when no compose families exist.

#### Scenario: Sublayered placement
- **WHEN** composed variant rules are emitted and sublayers are provisioned
- **THEN** they SHALL appear inside `@layer variants { @layer composed { ... } }`, separate from standalone variant rules in `@layer variants { @layer standalone { ... } }`

#### Scenario: Flat placement without compose
- **WHEN** no compose families exist in the project
- **THEN** all variant rules SHALL appear inside `@layer variants { }` directly (unchanged behavior)

## REMOVED Requirements

### Requirement: Equal specificity contract
**Reason**: Replaced by structural specificity invariant. Inheritance is now (0,2,0) and override is (0,3,0) — a structural gap inherent to the selector shapes, not engineered via doubled class names.
**Migration**: No action needed. The new selectors produce the correct cascade ordering via their natural specificity.

### Requirement: Source order determines override
**Reason**: Source order between inheritance and override is no longer the cascade mechanism. Override beats inheritance by specificity (0,3,0 > 0,2,0), which is order-independent.
**Migration**: No action needed. The specificity gap is structural.
