## ADDED Requirements

### Requirement: Type-level representation of token alias syntax for color properties
The TypeScript type system SHALL include a `ColorTokenRef` template literal type that represents the `{colors.X}` and `{colors.X/alpha}` token alias syntax already supported by the Rust extraction pipeline. This type SHALL be exported from the system package's type surface.

#### Scenario: ColorTokenRef matches token alias patterns
- **WHEN** a string matches the pattern `` `${string}{colors.${string}}${string}` ``
- **THEN** it SHALL be assignable to the `ColorTokenRef` type

#### Scenario: ColorTokenRef rejects strings without braces
- **WHEN** a string is `"rebeccapurple"` or `"rgba(255,0,0,0.5)"`
- **THEN** it SHALL NOT be assignable to the `ColorTokenRef` type
