## Purpose

Extraction diagnostics surface bail reasons, per-property skip warnings, reconciliation eliminations, and verbose phase logging from the Rust crate and Vite plugin to the console.
## Requirements
### Requirement: Reconciliation elimination warnings always print

The plugin SHALL print a warning via Vite's logger for every component eliminated during reconciliation, regardless of verbose mode. Each warning SHALL include the component binding name and the elimination reason from `manifest.report.eliminated_details`.

#### Scenario: Component eliminated as not rendered

- **WHEN** `analyzeProject` produces a manifest where `report.eliminated_details` contains an entry with `kind: "component"` and `reason: "component not rendered and not a parent"`
- **THEN** the plugin prints `[animus] ⚠ <binding> eliminated: not rendered and not a parent` via `logger.warn()`

#### Scenario: Variant option eliminated

- **WHEN** `report.eliminated_details` contains an entry with `kind: "variant"`
- **THEN** the plugin prints `[animus] ⚠ <binding> variant '<name>' pruned: <reason>` via `logger.warn()`

#### Scenario: No eliminations

- **WHEN** `report.eliminated_details` is empty
- **THEN** no elimination warnings are printed

### Requirement: Extraction bail and skip warnings always print

The plugin SHALL print bail reasons and per-property skip warnings from the manifest's `diagnostics` array, regardless of verbose mode.

#### Scenario: Bail warning printed by default

- **WHEN** the manifest contains a diagnostic with `kind: "bail"`
- **THEN** the plugin prints `[animus] ⚠ <component> not extracted: <message>` via `logger.warn()`

#### Scenario: Skip warning printed by default

- **WHEN** the manifest contains a diagnostic with `kind: "skip"`
- **THEN** the plugin prints `[animus] ⚠ <component>: skipped <message>` via `logger.warn()`

#### Scenario: No diagnostics produces no output

- **WHEN** the manifest has an empty `diagnostics` array
- **THEN** no additional warnings are printed

### Requirement: Verbose mode activation

The plugin SHALL activate verbose logging when either `ANIMUS_DEBUG=1` environment variable is set OR `verbose: true` is passed in plugin options. The `verbose` option SHALL be added to `AnimusExtractOptions`.

#### Scenario: Env var activation

- **WHEN** `process.env.ANIMUS_DEBUG` is `"1"` or `"true"`
- **THEN** verbose logging is active for all phases

#### Scenario: Plugin option activation

- **WHEN** `animusExtract({ verbose: true })` is configured
- **THEN** verbose logging is active for all phases

#### Scenario: Default off

- **WHEN** neither env var nor option is set
- **THEN** only elimination and extraction diagnostics print (no verbose output)

### Requirement: buildStart phase logging

When verbose mode is active, the plugin SHALL log checkpoints at each phase of `buildStart` with timing.

#### Scenario: System load checkpoint

- **WHEN** system subprocess completes
- **THEN** plugin logs `[animus] System loaded: <n> props, <n> groups (<ms>ms)`

#### Scenario: File discovery checkpoint

- **WHEN** file discovery completes
- **THEN** plugin logs `[animus] Discovered <n> files (<n> from packages)`

#### Scenario: Analysis checkpoint

- **WHEN** `analyzeProject` returns
- **THEN** plugin logs `[animus] Extracted <extracted>/<total> components (<ms>ms)`

#### Scenario: Reconciliation summary

- **WHEN** manifest report is parsed
- **THEN** plugin logs `[animus] Reconciliation: <n> components, <n> variants pruned, <n> states pruned`

#### Scenario: CSS summary

- **WHEN** CSS string is assembled
- **THEN** plugin logs `[animus] CSS: <n> bytes (<n> components)`

### Requirement: Transform phase logging

When verbose mode is active, the plugin SHALL log each file transformation.

#### Scenario: File with components transformed

- **WHEN** `transformFile` returns `hasComponents: true`
- **THEN** plugin logs `[animus] transform <relative-path>: <n> components`

#### Scenario: File with no components

- **WHEN** `transformFile` returns `hasComponents: false`
- **THEN** no transform log is emitted (to reduce noise)

### Requirement: HMR phase logging

When verbose mode is active, the plugin SHALL log HMR decisions.

#### Scenario: File unchanged by content hash

- **WHEN** HMR detects a file change but content hash matches cached value
- **THEN** plugin logs `[animus] HMR skip: <filename> (unchanged)`

#### Scenario: Geological reset triggered

- **WHEN** HMR detects a change to the system file, triggering full re-analysis
- **THEN** plugin logs `[animus] HMR geological reset: <filename>`

### Requirement: Grep-friendly output format

All diagnostic output from the plugin SHALL be prefixed with `[animus]` to enable filtering in mixed Vite output.

#### Scenario: Output prefix

- **WHEN** any diagnostic message is emitted
- **THEN** the message starts with `[animus]`

#### Scenario: Grep filtering

- **WHEN** a developer runs `ANIMUS_DEBUG=1 bun run build 2>&1 | grep '\[animus\]'`
- **THEN** all and only extraction diagnostic output is captured

### Requirement: Extraction diagnostics in manifest

The project analysis manifest SHALL include a `diagnostics` array containing bail reasons and per-property skip warnings for all analyzed components.

#### Scenario: Bail diagnostic included

- **WHEN** a chain bails during project analysis (e.g., unknown method, spread element)
- **THEN** the manifest SHALL include a diagnostic with `kind: "bail"`, the component binding name, the file path, and the bail reason message

#### Scenario: Skip diagnostic included

- **WHEN** a property is skipped during extraction (e.g., variable reference, function call)
- **THEN** the manifest SHALL include a diagnostic with `kind: "skip"`, the component binding name, the file path, and a message describing which property was skipped and why

#### Scenario: No diagnostics when fully extracted

- **WHEN** all chains extract successfully with no skipped properties
- **THEN** the `diagnostics` array SHALL be empty

### Requirement: Diagnostics are always-on in console

The Vite plugin SHALL print extraction diagnostics (bail and skip warnings) to the console by default, NOT gated by the `verbose` flag. This matches the existing behavior of elimination warnings.

#### Scenario: Bail warning printed by default

- **WHEN** the manifest contains a bail diagnostic
- **THEN** the plugin SHALL print `[animus] ⚠ ComponentName not extracted: reason` via the Vite logger warn channel

#### Scenario: Skip warning printed by default

- **WHEN** the manifest contains a skip diagnostic
- **THEN** the plugin SHALL print `[animus] ⚠ ComponentName: skipped property 'propName' (reason)` via the Vite logger warn channel

#### Scenario: Verbose mode not required

- **WHEN** the `verbose` option is false and `ANIMUS_DEBUG` is not set
- **THEN** bail and skip warnings SHALL still be printed

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

