# extraction-diagnostics

## ADDED Requirements

### Requirement: V2 boundary error reporting

Every fallible v2 native export SHALL report failures either as structured error data in its result or as a thrown error carrying a reason; malformed input SHALL always yield at least one diagnostic, and no v2 export SHALL return a success-shaped result with empty diagnostics for input it failed to process.

#### Scenario: Malformed options are visible

- WHEN a v2 native export receives unparseable or schema-violating input
- THEN the caller observes either a thrown error with a reason or a result whose diagnostics are non-empty

#### Scenario: No silent passthrough

- WHEN a v2 transform call cannot process its input
- THEN the returned result identifies the failure rather than presenting unmodified source as a successful no-op

### Requirement: Diagnostics are comparable as multisets

Engine diagnostics for a build SHALL be exposed in a form comparable as a multiset across engines, with stable fields for severity, message, and originating file.

#### Scenario: Harness consumes diagnostics

- WHEN the parity harness collects diagnostics from both engines for a fixture
- THEN each diagnostic exposes severity, message, and file such that multiset comparison is well-defined
