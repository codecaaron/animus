## ADDED Requirements

### Requirement: Linter and Formatter Decoupled from Type-Checker

The `verify:lint`, `verify:compile`, and `verify:types` atomic tiers SHALL remain invokable as separate, independently isolatable units. Unified CLI commands that conflate linting, formatting, and type-checking into a single invocation (for example, a single `check` command that runs all three) SHALL NOT replace the granular atomic tiers.

When a tool's CLI offers both unified and granular subcommands, the granular subcommands SHALL be used so each tier preserves its own loud-fail isolation contract per the `Atomic Tier Isolation` requirement. The `verify:lint` tier body SHALL invoke only the linter and formatter — typecheck logic SHALL NOT execute as part of `verify:lint`. The `verify:compile` and `verify:types` tier bodies SHALL each invoke their own dedicated entry points without sharing a unified-command surface with `verify:lint`.

This invariant exists because the `Atomic Tier Isolation` requirement mandates that each tier's failure surface is distinct. Bundling lint + fmt + typecheck into one command would force a tier failure to be reported at the unified-command level, losing the precise tier identification that the Change-Type Map and CI logs depend on. Maintainers consulting CI failure logs SHALL be able to identify the failing tier by name (`verify:lint`, `verify:compile`, or `verify:types`) without parsing the output of a unified command.

This invariant is orchestrator-agnostic. It applies regardless of whether the underlying linter is biome, oxlint, or a future tool; regardless of whether the orchestrator is bun, Vite+, or a future binding. Any tool's unified-CLI surface (e.g., Vite+'s `vp check` which combines `vp lint`, `vp fmt --check`, and a typecheck pass into one invocation) SHALL be rejected as a tier binding in favor of the tool's granular subcommands.

#### Scenario: Linter is invoked as its own tier

- **WHEN** the canonical linter binding offers both a unified command (e.g., `vp check`) and granular subcommands (e.g., `vp lint`, `vp fmt`)
- **AND** `verify:lint` is invoked
- **THEN** the tier body invokes only the linter and formatter subcommands — not the typecheck pass
- **AND** `verify:compile` and `verify:types` are NOT invoked as a side effect

#### Scenario: Tier failure is identifiable from CI logs

- **WHEN** a linter rule violation surfaces in CI
- **AND** the developer or agent inspects CI logs to identify the failing tier
- **THEN** the failing job step is named `verify:lint` (or its canonical alias under the active orchestrator)
- **AND** the failure is NOT attributed to a unified command name (e.g., `vp check`) that would mask which underlying tier failed

#### Scenario: Linter failure does not block typecheck reporting

- **WHEN** `verify:lint` fails because of a lint rule violation
- **AND** `verify:compile` is subsequently invoked (independently or as part of a composite orchestrator)
- **THEN** `verify:compile` runs and reports its own pass/fail status against the typecheck implementation
- **AND** the typecheck failure surface (if any) is reported separately from the lint failure surface

#### Scenario: Formatter check failure is independent of linter pass

- **WHEN** `verify:lint` task body invokes a linter subcommand followed by a formatter check subcommand (e.g., `vp lint && vp fmt --check`)
- **AND** the linter subcommand passes but the formatter check subcommand fails
- **THEN** the tier exits non-zero with the formatter's failure message visible
- **AND** the failure is attributable to the formatter, not the linter
