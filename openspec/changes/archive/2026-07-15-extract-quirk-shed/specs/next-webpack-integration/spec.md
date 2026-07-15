## MODIFIED Requirements

### Requirement: Webpack plugin orchestrates extraction pipeline

The Next.js webpack plugin SHALL run the full extraction pipeline (loadSystem → analyzeProject → applyUnitFallback) once per build, sharing results across all webpack compiler instances via a module-scope singleton promise mutex. The plugin SHALL pass the active config fields from `loadSystemModule()` to `analyzeProject()`, including `selectorAliasesJson`; the retained optional selector-order argument slot SHALL receive a placeholder after `selectorOrder` leaves the serialized config. CSS delivery SHALL inject assembled CSS through the `processAssets` hook rather than writing directly to disk.

#### Scenario: Single analysis across multi-compiler

- **WHEN** Next.js invokes the webpack config function three times (server-nodejs, server-edge, client)
- **THEN** `analyzeProject()` SHALL execute exactly once
- **AND** the assembled CSS SHALL be stored in a shared module-scope variable
- **AND** all three compiler instances' `processAssets` hooks SHALL inject the same CSS into their respective asset pipelines

#### Scenario: Plugin delivers CSS via processAssets

- **WHEN** analysis completes and CSS is assembled
- **THEN** the plugin SHALL store the CSS in the shared variable
- **AND** `processAssets` SHALL replace the `.animus/styles.css` asset content in each compiler's compilation
- **AND** disk writes SHALL serve only as HMR triggers, not as the authoritative CSS source

#### Scenario: Selector aliases passed to analysis

- **WHEN** `loadSystemModule()` returns `selectorAliases` without a serialized selector order
- **THEN** the plugin SHALL pass `selectorAliases` to `analyzeProject()` as non-null `selectorAliasesJson`
- **AND** the retained optional selector-order argument slot SHALL receive `null`
