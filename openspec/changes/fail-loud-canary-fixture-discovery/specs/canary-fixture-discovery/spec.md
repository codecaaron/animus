## ADDED Requirements

### Requirement: Real-document fixture discovery fails loud

The NAPI canary SHALL surface a path-bearing filesystem error when a configured real-document fixture root or discovered entry cannot be read or inspected, and MUST NOT continue extraction with an empty or partial corpus produced by that failure.

#### Scenario: Configured fixture root is missing

- **WHEN** the canary's fixture-discovery regression supplies a deterministic nonexistent root
- **THEN** discovery throws a filesystem error that identifies the nonexistent path before project extraction runs

#### Scenario: Configured fixture entry cannot be inspected

- **WHEN** filesystem inspection fails for an entry reached beneath a configured fixture root
- **THEN** discovery propagates the inspection error instead of omitting the entry and returning a partial corpus

### Requirement: Healthy real-document discovery remains complete

The NAPI canary SHALL continue to recursively discover the checked-in UI and documentation fixture roots and preserve its existing real-document extraction assertions and snapshots when all fixture paths are readable.

#### Scenario: Repository fixtures are healthy

- **WHEN** a developer runs `vp run verify:canary` with the checked-in fixture roots present and readable
- **THEN** the real-document component, extraction, determinism, report, dynamic-property, and CSS snapshot assertions pass
