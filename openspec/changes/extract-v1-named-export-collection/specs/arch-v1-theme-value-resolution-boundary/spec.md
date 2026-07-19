## ADDED Requirements

### Requirement: V1 theme values retain exact scale and transform precedence

V1 theme-value resolution SHALL preserve scale lookup, transform eligibility,
evaluator fallback, legacy placeholder bytes, and negative-value behavior.

#### Scenario: Registered evaluator outcomes are executable

- **WHEN** increment 09 is complete
- **THEN** G16 SHALL pass one matrix covering scale hits, scale misses, no
  scale, empty-array phantom scales, evaluator success, and evaluator failure
- **AND** negative integers and floats SHALL use absolute lookup values before
  applying one final negation
- **AND** integer and f64 key representations SHALL remain distinct

#### Scenario: Private helpers retain one policy owner each

- **WHEN** `resolve_value()` normalizes lookup input and resolves a transform
- **THEN** G16 SHALL find one definition and one production call for each
  private helper
- **AND** evaluator errors SHALL fall through to the resolved/raw value
- **AND** an absent evaluator SHALL retain exact legacy placeholder bytes
- **AND** strict Clippy, Rust units, NAPI canary, and integration SHALL pass

#### Scenario: Engine ownership remains local

- **WHEN** V1 theme-value resolution is stabilized
- **THEN** V2 source and public NAPI/manifest contracts SHALL remain unchanged
- **AND** no shared cross-engine helper SHALL be introduced
