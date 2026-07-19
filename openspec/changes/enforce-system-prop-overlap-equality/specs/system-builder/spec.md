## ADDED Requirements

### Requirement: Complete overlap equality

The system builder SHALL accept a repeated prop key only when the existing and incoming definitions are equivalent across every current `Prop` field.

#### Scenario: Equivalent ordered property targets overlap

- **WHEN** two registrations use the same prop key and separately allocated `properties` arrays containing the same targets in the same order
- **THEN** both registrations complete without an error
- **AND** the prop remains present in every registered group

#### Scenario: A behavior-bearing field conflicts

- **WHEN** a repeated prop key differs in `property`, `properties`, `scale`, `variable`, `negative`, `strict`, `currentVar`, or `transform`
- **THEN** registration throws a descriptive error naming the conflicting prop
- **AND** no builder containing the replacement definition is returned

#### Scenario: Ungrouped registration uses the same policy

- **WHEN** `addProps()` repeats a prop key registered by an earlier group with a conflicting definition
- **THEN** registration throws a descriptive error naming the conflicting prop

#### Scenario: Non-primitive scale identity remains strict

- **WHEN** a repeated prop key supplies two distinct object or array scale instances
- **THEN** registration treats the definitions as conflicting even when those instances contain equal values
