# verification-tier-policy

## MODIFIED Requirements

### Requirement: Parity Tier

The task graph SHALL provide a `verify:parity` atomic tier that runs fresh-process and thread-count v2 self-checks, the v2 seam battery, and committed production/development baseline comparison. It SHALL fail loud with a remediation message when the v2 binary, its Rust inputs, fixture corpus, or committed baselines are missing or stale, and ordinary execution SHALL exit non-zero on any baseline drift.

#### Scenario: Parity tier runs the committed oracle

- **WHEN** `vp run verify:parity` executes with a fresh v2 binary, fixtures, and both committed mode baselines present
- **THEN** the v2 self-checks, seam battery, and baseline comparisons run and the tier's exit code equals their combined verdict

#### Scenario: Missing or stale upstream fails loud

- **WHEN** `vp run verify:parity` executes and a required v2 artifact is missing or older than a Rust source or crate metadata input
- **THEN** the tier exits non-zero with a message naming the stale or missing artifact and the command that builds it, without rebuilding it silently

### Requirement: Parity Tier Change-Type Coverage

The root Change-Type Map SHALL map v2 engine and shared loader changes to tier sets that include `verify:parity`, and CI SHALL exercise the same standing parity tier after the v2 artifact is available.

#### Scenario: Map and CI cover the standing oracle

- **WHEN** the v2 engine or shared loader source changes
- **THEN** the authoritative minimum tier set includes `verify:parity` and CI runs the committed v2 oracle
