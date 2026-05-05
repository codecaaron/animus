## MODIFIED Requirements

### Requirement: Side-effect imports are preserved

The cascade SHALL NOT remove side-effect imports (`import 'module-name';` without bindings). The active linter does not flag side-effect imports as unused by design, and the home-roll deleter SHALL NOT augment the linter's detection to include them.

#### Scenario: Side-effect import survives cascade

- **WHEN** a source file contains `import 'some-side-effect-module';` at the top
- **AND** the cascade runs in fix mode
- **THEN** the resulting file SHALL still contain that import statement

### Requirement: Positional function parameters preserve arity via rename, not delete

The cascade SHALL NOT DELETE positional function parameters. When the active linter offers an unsafe auto-fix that renames unused positional parameters to `_`-prefixed names, the cascade SHALL leave that rule's reporting as a warning (not auto-applied) for human review; it SHALL NOT auto-rename positional parameters as part of the cascade.

oxlint's `no-unused-vars` rule does not offer rename-as-fix for positional parameters; under the oxlint binding, parameters are reported as errors and left for human resolution. The home-roll deleter (Layer C) SHALL NOT delete positional parameters because doing so would change function arity, which is a public-API contract.

#### Scenario: Positional param is not deleted

- **WHEN** a function `function f(a: number, unusedB: string) { return a; }` is present
- **AND** the cascade runs in fix mode
- **THEN** the function signature SHALL still contain two parameters (arity = 2) after the cascade

### Requirement: Preconditions fail loud with actionable messages

The orchestrator SHALL require knip, the active linter (oxlint via vite-plus), and typescript to be available; it SHALL detect missing tooling at startup and exit non-zero with an actionable "Run: <command>" message in the format established by `scripts/verify/_preconditions.sh`.

#### Scenario: knip missing emits actionable error

- **WHEN** `knip` is not installed (not present in `node_modules/`)
- **AND** the orchestrator starts
- **THEN** it SHALL exit non-zero with the message "ERROR: knip missing. Run: bun install"

#### Scenario: Linter missing emits actionable error

- **WHEN** the active linter binary is not reachable via `bunx vp lint --version`
- **THEN** the orchestrator SHALL exit non-zero with the message "ERROR: vp lint missing. Run: bun install"

### Requirement: Diagnostic-logging-stripping rules are excluded from cascade auto-fix

Cascade layers that invoke the active linter's auto-fix capability SHALL NOT enable rules whose auto-fix removes diagnostic logging output (e.g., a `no-console` rule in any linter). The cascade preserves `console.log` / `console.warn` / `console.error` calls as runtime-observable diagnostic surfaces; the linter's safe-fix configuration in cascade layers MUST exclude any rule whose fix strips these calls.

This requirement is linter-neutral and applies to any cascade layer using auto-fix — historically Layer B (biome `--unsafe` scoped to specific rules), now Layer A (oxlint `--fix-suggestions`). It survives layer-set restructuring as long as some cascade layer invokes auto-fix.

#### Scenario: console.warn survives cascade auto-fix layer

- **WHEN** a source file contains `console.warn('diagnostic')` as a genuine runtime-observable line
- **AND** the cascade's auto-fix layer runs against that file
- **THEN** the `console.warn` call SHALL remain in the resulting file

### Requirement: Layer C code-drift is detected at startup

When Layer C (`delete-unused.ts`) reads the active linter's JSON diagnostic output and finds diagnostics present but ZERO of those diagnostics match `TARGET_CODES` after normalization, Layer C SHALL emit a sentinel receipt with `layer="C"`, `verb="drift-suspected"`, `kind="code-drift"`, and `extras.codesSeen` containing the list of distinct codes observed in the diagnostic stream. The orchestrator's summary SHALL surface this as a `WARN` indicating possible linter rule renaming and listing the codes seen.

This requirement is linter-neutral. Under biome the discriminator was the `category` field; under oxlint it is the `code` field (with `eslint(...)` wrapper unwrap normalization). The drift-detection mechanism is preserved across linter rebinds.

#### Scenario: Linter diagnostics with no matching codes produce a drift receipt

- **WHEN** the active linter reports five diagnostics all under code `eslint(no-renamed-rule)` (a renamed rule)
- **AND** Layer C's `TARGET_CODES` includes only `eslint(no-unused-vars)`
- **THEN** Layer C SHALL emit one receipt with `verb="drift-suspected"` and `extras.codesSeen=["eslint(no-renamed-rule)"]`
- **AND** the run summary SHALL include `WARN: oxlint diagnostics present but none matched known codes — oxlint may have renamed. Codes seen: eslint(no-renamed-rule)`

#### Scenario: Linter diagnostics with at least one matching code do not trigger drift

- **WHEN** the active linter reports diagnostics including at least one under a known target code
- **THEN** Layer C SHALL NOT emit a `drift-suspected` receipt for that iteration
- **AND** the run summary SHALL NOT include the code-drift WARN
