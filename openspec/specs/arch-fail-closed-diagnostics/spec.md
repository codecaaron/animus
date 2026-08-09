# arch-fail-closed-diagnostics Specification

## Purpose

kind:"error" analysis diagnostics fail every plugin build; static hard errors never demote to CSS-emitting warnings.

## Requirements
### Requirement: Error diagnostics fail the build in every plugin

A `kind:"error"` analysis diagnostic SHALL fail the build in every plugin host, and the static path SHALL NOT demote a hard error to a warning that still emits CSS: no declaration is emitted for the failing transform, and the plugin throws rather than completing. A build that stays green while an error diagnostic is present has converted a contract violation into silent output.

#### Scenario: Integration fixture proves the fail-closed path

- **WHEN** the following command is run

```bash
vp run verify:integration
```

- **THEN** it exits 0, including a fixture asserting that analyze diagnostics contain `kind:"error"` for an object-returning transform, that no declaration is emitted for it, and that the plugin throws

