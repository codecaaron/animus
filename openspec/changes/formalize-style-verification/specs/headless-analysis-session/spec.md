## ADDED Requirements

### Requirement: Server-free workspace analysis

The harness SHALL analyze an Animus workspace — loading the system module, discovering files, and producing a production-mode universe manifest — with no dev server or bundler process running.

#### Scenario: Cold analysis with no server

- **WHEN** the harness is invoked on a workspace while no dev server is running
- **THEN** it produces a production-mode manifest and answers queries against it

### Requirement: Session state across queries

The harness session SHALL retain analysis state between queries: consecutive queries with no intervening file change SHALL be answered without re-analysis, and a file change SHALL trigger re-analysis before the next answer.

#### Scenario: Repeated queries without edits

- **WHEN** two queries arrive with no file change between them
- **THEN** the second answer derives from the same analysis as the first and no re-analysis occurs

#### Scenario: Query after an edit

- **WHEN** a watched file changes between queries
- **THEN** the next answer derives from a fresh whole-project analysis of the changed workspace

### Requirement: Dual invocation surfaces

Every query SHALL be invocable both as a one-shot CLI command with meaningful exit codes and as a session tool over the Model Context Protocol, and both surfaces SHALL return the same answer for the same query and workspace state.

#### Scenario: CLI and MCP parity

- **WHEN** the same query runs against the same workspace state via the CLI and via the MCP surface
- **THEN** both return the same verdict and evidence envelope

#### Scenario: CI usage

- **WHEN** a CLI query's verdict is `divergent` or a preserve violation is reported
- **THEN** the process exit code is non-zero

### Requirement: Core query set

The harness SHALL provide at minimum the queries `explain-component` (a component's full predicted style plan with provenance), `explain-property` (the winning declaration for one property in a given environment, with everything it overrides), and `diff-universe` (the semantic difference between two workspace states).

#### Scenario: Explaining a property

- **WHEN** `explain-property` is asked for property `padding` on a component in a stated environment
- **THEN** the answer names the winning declaration, its authoring site (file and span), the cascade position that made it win, and each overridden declaration with its own provenance

### Requirement: Mode-stamped answers

Every manifest held by the session SHALL be stamped with its analysis mode, and verdict-bearing queries SHALL refuse a dev-mode manifest rather than answer from it.

#### Scenario: Dev-mode manifest presented for a verdict

- **WHEN** a verdict-bearing query would resolve against a manifest stamped dev-mode
- **THEN** the query returns an error identifying the mode mismatch instead of an answer
