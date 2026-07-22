# next-turbopack-integration Specification

## Purpose
TBD - created by archiving change turbopack-next-plugin-support. Update Purpose after archive.
## Requirements
### Requirement: Turbopack mode gating

The Next.js plugin SHALL accept a `turbopack` option with a `mode` of `'auto'`, `'on'`, or `'off'`, defaulting to `'auto'` when absent. Turbopack wiring SHALL be produced when the mode resolves to active: `'on'` always, `'auto'` exactly when the `TURBOPACK` environment variable is set. When the mode resolves to inactive, the returned Next config SHALL contain no plugin-generated `turbopack` rules or aliases and the webpack integration SHALL behave exactly as without the option. The legacy `unstable_turbopack` option SHALL be honored as a deprecated alias with a one-time warning; the stable `turbopack` option wins when both are present.

#### Scenario: Zero-config activation under Turbopack

- **WHEN** a consumer configures `withAnimus({ system: './src/ds.ts' })` with no turbopack option and the process runs under Turbopack (`TURBOPACK` set)
- **THEN** the resolved config SHALL contain the plugin's `turbopack.rules` and `turbopack.resolveAlias` entries

#### Scenario: Option absent outside Turbopack

- **WHEN** the option is absent and the `TURBOPACK` environment variable is not set
- **THEN** the returned config SHALL contain no plugin-generated `turbopack.rules` entries
- **AND** the webpack integration SHALL be configured unchanged

#### Scenario: Mode off suppresses Turbopack wiring unconditionally

- **WHEN** a consumer configures `turbopack: { mode: 'off' }`
- **THEN** no plugin-generated Turbopack wiring SHALL be produced, even when `TURBOPACK` is set

#### Scenario: Mode on

- **WHEN** a consumer configures `turbopack: { mode: 'on' }`
- **THEN** the resolved config SHALL contain the plugin's `turbopack.rules` and `turbopack.resolveAlias` entries

#### Scenario: Deprecated alias honored with a warning

- **WHEN** a consumer configures only `unstable_turbopack: { mode: 'on' }`
- **THEN** the plugin SHALL behave as if `turbopack: { mode: 'on' }` were set
- **AND** SHALL emit a deprecation warning once per process

### Requirement: Path aliases under Turbopack

When Turbopack mode is active, the plugin SHALL derive path aliases from the project's `tsconfig.json` — tolerating comments, following `extends` chains (missing parents skipped), applying nearest-`paths`-wins and nearest-`baseUrl` resolution, and taking the first target per pattern — and SHALL forward them to analysis in the same serialized alias contract the webpack and Vite integrations use.

#### Scenario: Wildcard alias reaches analysis

- **WHEN** the project tsconfig declares `paths: { "@/*": ["./src/*"] }` and Turbopack mode is active
- **THEN** the analysis inputs SHALL contain a prefix alias mapping `@/` to the project's `src/` directory

#### Scenario: Alias inherited through extends

- **WHEN** the alias is declared in a parent config reachable via `extends`
- **THEN** it SHALL be forwarded exactly as if declared locally

#### Scenario: No tsconfig present

- **WHEN** the project has no readable tsconfig
- **THEN** analysis SHALL proceed with no path aliases and no error

### Requirement: Pre-bundling extraction under Turbopack

When Turbopack mode is active, resolving the Next config SHALL complete a full extraction before bundling can begin: the resolved config value SHALL only become available after `.animus/styles.css`, `.animus/system-props.js`, `.animus/manifest.json`, and `.animus/analysis-inputs.json` exist on disk with the current analysis results. The analysis-inputs artifact SHALL contain the analysis inputs sufficient for an isolated process to reproduce the analysis, and SHALL be rewritten only when its content changes.

#### Scenario: Config resolution produces the artifacts

- **WHEN** a Next config wrapped with an active Turbopack mode is resolved
- **THEN** awaiting the returned config SHALL leave `.animus/styles.css`, `.animus/system-props.js`, `.animus/manifest.json`, and `.animus/analysis-inputs.json` present under the project root
- **AND** the manifest file SHALL parse as JSON and enumerate the analyzed files

#### Scenario: Hydration reproduces the analysis in an isolated process

- **WHEN** a process that has run no analysis replays the persisted analysis inputs
- **THEN** the resulting manifest SHALL equal the persisted `.animus/manifest.json`

### Requirement: Manifest disk artifact

Every completed analysis SHALL write the manifest JSON to `.animus/manifest.json` under the project root, in webpack and Turbopack modes alike, guarded by a content hash so byte-identical manifests are not rewritten.

#### Scenario: Full pipeline writes the manifest

- **WHEN** the extraction pipeline completes on a project with extractable components
- **THEN** `.animus/manifest.json` SHALL exist and parse as JSON containing the per-file component map

#### Scenario: Unchanged manifest is not rewritten

- **WHEN** a re-analysis produces a byte-identical manifest
- **THEN** the plugin SHALL NOT rewrite `.animus/manifest.json`

### Requirement: Stateless per-file transformation

The Turbopack loader SHALL derive its output solely from the incoming source text, its serializable loader options, and the `.animus/` disk artifacts. Two invocations in unrelated processes given identical inputs and disk state SHALL produce identical output. When `.animus/manifest.json` is absent or unreadable, the loader SHALL return the source unchanged. The single-stylesheet-import policy SHALL match the webpack loader: emitter-injected stylesheet imports are stripped from every file and one import is injected only at the detected root entry or the configured `cssImportTarget`.

#### Scenario: Identical output across isolated workers

- **WHEN** the same file is transformed by two loader invocations in separate processes with the same `.animus/` contents
- **THEN** both invocations SHALL return identical output

#### Scenario: Missing manifest passthrough

- **WHEN** the loader runs before any analysis has written `.animus/manifest.json`
- **THEN** the loader SHALL return the source unchanged

#### Scenario: File outside the manifest

- **WHEN** the loader receives a file the manifest does not list
- **THEN** no component transformation SHALL occur for that file
- **AND** the stylesheet-import policy SHALL still apply

### Requirement: Generated Turbopack configuration

When Turbopack mode is active, the plugin SHALL register glob-keyed Turbopack loader rules whose options survive JSON serialization unchanged, and SHALL register resolve aliases mapping `virtual:animus/system-props` and `.animus/styles.css` to the on-disk artifacts, plus one alias per collected external design-system package specifier to that package's source entry.

#### Scenario: Loader options are serializable

- **WHEN** the plugin generates its Turbopack loader rule
- **THEN** `JSON.parse(JSON.stringify(options))` SHALL deep-equal the options

#### Scenario: Virtual ids resolve to disk artifacts

- **WHEN** the generated config is inspected
- **THEN** `resolveAlias` SHALL map `virtual:animus/system-props` and `.animus/styles.css` to paths under `.animus/`

#### Scenario: External packages alias to source entries

- **WHEN** the system file declares external design-system packages that resolve to workspace sources
- **THEN** `resolveAlias` SHALL map each package specifier to its collected source entry path

### Requirement: Dev watch re-extraction under Turbopack

When Turbopack mode is active in development, the plugin SHALL observe project source changes outside the bundler and re-run analysis, refreshing the `.animus/` artifacts under the same content-hash guards as the webpack watch path.

#### Scenario: Component change refreshes artifacts

- **WHEN** a source file containing extractable components is modified during an active dev session
- **THEN** the plugin SHALL re-run analysis and update `.animus/manifest.json` and `.animus/styles.css`

#### Scenario: Irrelevant change leaves artifacts untouched

- **WHEN** a modified file produces no manifest-relevant change
- **THEN** the `.animus/` artifacts SHALL NOT be rewritten

