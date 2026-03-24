## ADDED Requirements

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
- **THEN** only elimination warnings print (no verbose output)

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
