# verification-tier-policy

## ADDED Requirements

### Requirement: Parity Tier

The task graph SHALL provide a `verify:parity` atomic tier that runs the extraction parity harness over the fixture corpus, fails loud with a remediation message when either engine binary or the fixture corpus is missing, and exits non-zero on any unregistered divergence.

#### Scenario: Parity tier runs the harness

- WHEN `vp run verify:parity` executes with both engines built and fixtures present
- THEN the harness runs and the tier's exit code equals the harness verdict

#### Scenario: Missing upstream fails loud

- WHEN `vp run verify:parity` executes and a required engine artifact is missing
- THEN the tier exits non-zero with a message naming the missing artifact and the command that builds it, without rebuilding it silently

### Requirement: Parity Tier Change-Type Coverage

The root Change-Type Map SHALL include a row mapping v2 engine source changes to a tier set that includes `verify:parity`, added in the same change that introduces the v2 source surface.

#### Scenario: Map row exists alongside the surface

- WHEN the v2 engine source tree exists in the repository
- THEN the root `CLAUDE.md` Change-Type Map contains a row whose edit surface covers that tree and whose tier set includes `verify:parity`
