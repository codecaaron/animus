## ADDED Requirements

### Requirement: Tool Binding

The `verify:hygiene:ts` atomic tier SHALL be bound to `fallow-rs` (the `fallow` CLI) as its invocation surface. The configuration file location SHALL resolve to `.fallowrc.json` at the repository root. Per-analysis baseline files SHALL resolve under a `.fallow/` directory at the repository root.

Specific rule severities, threshold values, boundary rules, suppression entries, and workspace inclusions are policy decisions set by separate changes.

#### Scenario: Fallow is the invoked tool

- **WHEN** `verify:hygiene:ts` runs
- **THEN** the tier invokes the `fallow` CLI with configuration loaded from `.fallowrc.json`

#### Scenario: Baselines directory convention

- **WHEN** fallow is configured to save a baseline
- **THEN** the target path is under `.fallow/` at the repository root
- **AND** other components (CI jobs, dev scripts) resolve baseline paths from the same location

### Requirement: Config Key Surface

The `.fallowrc.json` file SHALL expose, at minimum, the config keys fallow natively supports: `entry`, `workspaces`, `ignorePatterns`, `ignoreDependencies`, `ignoreExports`, `rules`, `health`, `boundaries`, `audit`, and `$schema`. The mere existence of each key as an accepted shape is the capability this spec installs; specific values within those keys are policy.

A policy change modifying any of these keys SHALL NOT require modifying this spec unless the change introduces a new top-level capability (e.g., a new subcommand surface fallow has not previously exposed).

#### Scenario: Config keys accept values

- **WHEN** a future policy change sets a value in any of the enumerated keys
- **THEN** fallow parses the config without error (the key is natively supported)
- **AND** the tier picks up the new value on next run

#### Scenario: Schema pointer enables editor support

- **WHEN** a developer opens `.fallowrc.json` in an IDE
- **THEN** the `$schema` pointer resolves to fallow's published JSON schema
- **AND** autocomplete works on supported keys

### Requirement: Suppression Mechanisms

The repository SHALL expose fallow's native suppression surface in three forms: (1) source-local annotations on declarations (e.g., JSDoc visibility tags), (2) file-scoped inline comment directives, and (3) config-level exclusion entries in `.fallowrc.json` (`ignoreExports`, `ignoreDependencies`, `ignorePatterns`). The specific syntax of each form is whatever fallow natively accepts; this spec does not pin the literal strings.

A rationale registry location SHALL be reserved at `.fallow/SUPPRESSIONS.md`. Whether specific suppressions must populate the file with rationale entries is a policy decision.

The mechanism for detecting stale suppressions SHALL be available through fallow's native interface. Whether stale suppressions fail the tier or are merely reported is a policy decision.

#### Scenario: All three suppression forms are accepted

- **WHEN** a source file uses any of the three suppression forms
- **THEN** fallow's scan respects the suppression on that specific finding

#### Scenario: Rationale registry location is stable

- **WHEN** a future policy change wants to add rationale entries
- **THEN** `.fallow/SUPPRESSIONS.md` is the canonical location
- **AND** CI jobs, dev scripts, and agents know to look there

#### Scenario: Stale suppressions surface

- **WHEN** a suppression targets code that is no longer unused
- **AND** the tier runs with the stale-suppression check enabled
- **THEN** the stale suppression appears in fallow's output

### Requirement: Workspace Scoping Mechanism

The `.fallowrc.json` `workspaces` and `ignorePatterns` keys SHALL provide the mechanism for scoping fallow's analysis across the monorepo. The file SHALL exist with a syntactically-valid shape. Specific package scoping choices (which packages appear in `workspaces`, additional globs in `ignorePatterns`) are policy.

The `legacy/**` path SHALL appear in `ignorePatterns` at capability-install time. The legacy archive exclusion is a topology invariant defined by root `CLAUDE.md` § Workspace Topology and § Legacy Packages — not a tunable. Fallow scanning `legacy/*` would violate the one-way independence rule ("the active graph must not depend on archived code") by producing cross-workspace findings for an archived tree. This exclusion is therefore mechanism, not policy.

#### Scenario: Workspaces key scopes analysis

- **WHEN** `workspaces` is set to one or more glob patterns
- **THEN** fallow analyzes files under matching directories
- **AND** files outside matching directories are not analyzed as workspace members

#### Scenario: Ignore patterns exclude files

- **WHEN** `ignorePatterns` includes a glob
- **THEN** fallow's scan skips files matching that glob
- **AND** no findings are produced for those files

#### Scenario: Legacy exclusion is present at install time

- **WHEN** a developer inspects `.fallowrc.json` after this capability is installed
- **THEN** `legacy/**` appears in `ignorePatterns`
- **AND** no `fallow` run produces findings against files under `legacy/*`

### Requirement: Architecture Boundaries Mechanism

The `.fallowrc.json` `boundaries` key SHALL be available as the mechanism for encoding import-direction rules across the repository. Both fallow's presets (if used) and custom rules SHALL be supported shapes under this key. Specific boundary rules are policy and are set by a separate change.

The tier SHALL classify boundary-rule violations under a finding class fallow exposes (e.g., `boundary-violation`); the severity assignment for that finding class is a policy decision set in the `rules` key by a separate change.

#### Scenario: Boundary key accepts custom rules

- **WHEN** a policy change adds custom rules under `boundaries`
- **THEN** fallow loads them and enforces them on next scan

#### Scenario: Violations appear as findings

- **WHEN** source code violates any configured boundary rule
- **THEN** fallow produces a finding on that file:line with the boundary-violation class

### Requirement: Dead-Code Detection

The `verify:hygiene:ts` tier SHALL invoke fallow's dead-code analysis covering the full set of issue subclasses fallow natively detects (such as: unused files/exports/deps, unresolved imports, circular deps, boundary violations, stale suppressions — the authoritative enumeration is fallow's own documentation, not this spec).

Per-subclass severity SHALL be configurable via the `rules` key. Specific severity assignments are policy.

#### Scenario: All subclasses available

- **WHEN** fallow's scan completes
- **THEN** any enabled dead-code subclass producing findings surfaces them in the output

#### Scenario: Severity reconfiguration is policy-driven

- **WHEN** a policy change updates a rule's severity in `.fallowrc.json`
- **THEN** the tier's next run applies the new severity without code changes

### Requirement: Duplicate Code Detection

The tier SHALL invoke fallow's `dupes` analysis with a configurable detection mode (strict | mild | weak | semantic) and SHALL produce findings for detected duplications. The specific mode selection is policy.

#### Scenario: Dupes analysis runs

- **WHEN** the tier invokes fallow with dupes detection enabled
- **THEN** duplication findings are produced and surface in the output

### Requirement: Health Metrics

The tier SHALL invoke fallow's `health` analysis collecting complexity and maintainability metrics. Threshold keys (e.g., `maxCyclomatic`, `maxCognitive`, `maxCrap`) SHALL be configurable via the `health` key in `.fallowrc.json`. Specific threshold values and whether they are enforced as hard gates or baseline-tracked are policy.

#### Scenario: Health analysis produces metrics

- **WHEN** the tier invokes fallow with health collection enabled
- **THEN** complexity and maintainability metrics are produced in the output

### Requirement: Audit Orchestrator

The tier SHALL be invokable through fallow's `audit` orchestrator, which combines dead-code + dupes + health into a single verdict-returning pass. The base reference (`--base <ref>`) SHALL be a configurable input; whether the tier defaults to a specific branch is a policy decision.

Exit-code semantics (how verdicts map to process exit codes) are defined by fallow's own interface and SHALL be relied on unchanged; this spec does not pin the mapping.

#### Scenario: Audit returns a verdict

- **WHEN** `fallow audit --base <ref>` runs
- **THEN** output includes a pass/warn/fail verdict from fallow
- **AND** the tier's process exit code follows fallow's native verdict-to-exit-code mapping

### Requirement: Baseline and Ratchet Mechanism

Fallow's baseline mechanism (`--save-baseline <path>`, `--baseline <path>`, `--fail-on-regression`, `--tolerance <pct>`) SHALL be the supported path for staged enforcement. Per-analysis baseline file paths SHALL resolve under `.fallow/` (`dead-code-baseline.json`, `health-baseline.json`, `dupes-baseline.json`).

Whether baselines are committed to the repository, regenerated on what cadence, invoked with what tolerance, and transitioned-out-of when empty — all of those are policy decisions set by separate changes. The capability installed here is the baseline mechanism's presence and file-location convention.

#### Scenario: Baselines persist under .fallow

- **WHEN** a developer or CI job invokes fallow with `--save-baseline`
- **THEN** the generated baseline file lands under `.fallow/` at the expected filename

#### Scenario: Regression comparison is mechanism-level supported

- **WHEN** fallow is invoked with `--baseline <path> --fail-on-regression`
- **THEN** new findings not present in the baseline fail the invocation per fallow's native semantics

### Requirement: MDX Dynamic-Discovery Surface

The spec SHALL record as a mechanism claim that `.mdx` files under `packages/showcase/src/content/**` (presently 26 files) constitute a dynamic-discovery surface fallow's static analyzer cannot resolve. Components referenced only from MDX content will surface as dead-code findings unless covered by a suppression mechanism.

The three suppression mechanisms defined under "Suppression Mechanisms" SHALL be the available coverage for this gap. Which mechanism is preferred for MDX cases, whether rationale entries are required, and whether a future custom fallow plugin should eventually replace the suppression approach are all policy decisions set by separate changes.

#### Scenario: MDX surface is registered

- **WHEN** a maintainer investigates why an MDX-only-consumed component surfaces as unused
- **THEN** this spec's MDX requirement names the gap with file-location specificity
- **AND** the three suppression mechanisms are documented as available coverage

#### Scenario: Suppression resolves MDX-only unused finding

- **WHEN** a component referenced only from `.mdx` carries any of the three suppression forms targeting it
- **AND** `verify:hygiene:ts` runs
- **THEN** fallow does not produce a dead-code finding for that component

### Requirement: CI Integration Surface

The repository SHALL expose a CI job invoking fallow in the GitHub Actions workflow. The invocation mechanism (a dedicated fallow GitHub Action, a manual `fallow` step, or equivalent) is an implementation detail, verified at implementation time. Fallow's native output formats SHALL be available for CI consumers; which formats the job emits and whether they are uploaded to GitHub Code Scanning are policy decisions.

The CI job SHALL be structured as a standalone parallel gate (not blocking other jobs' critical path, not required by other jobs' `needs:` lists).

#### Scenario: Action integrates with GitHub

- **WHEN** the CI workflow invokes the fallow Action on a PR
- **THEN** fallow runs in the CI environment and produces output per the configured flags

#### Scenario: Standalone gate

- **WHEN** the CI workflow's job graph is inspected
- **THEN** the fallow CI job does not appear in any other job's `needs:` list
- **AND** other jobs run independently of the fallow job's outcome

### Requirement: Dev Script Surface

Root `package.json` SHALL carry a `fallow:*` namespace for developer-on-demand scripts invoking fallow subcommands. The namespace SHALL NOT be invoked by any `verify:*` composite orchestrator. Which specific `fallow:*` scripts are registered (e.g., `fallow:audit`, `fallow:fix`, `fallow:watch`, `fallow:baseline`) is a policy decision.

#### Scenario: Dev namespace exists

- **WHEN** a developer inspects root `package.json` scripts
- **THEN** the `fallow:*` prefix is a recognized namespace for dev-on-demand fallow invocations

#### Scenario: Dev scripts are not in verify orchestrators

- **WHEN** any `verify:*` composite orchestrator runs
- **THEN** no `fallow:*` dev script is invoked as part of the composition
