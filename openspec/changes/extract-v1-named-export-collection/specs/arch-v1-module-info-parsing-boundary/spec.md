## ADDED Requirements

### Requirement: Isolated behavior-stable V1 named-export collection

V1 named-export collection SHALL remain behind one private helper while
preserving exact module metadata and adjacent parsing boundaries.

#### Scenario: Named-export policy has one private owner

- **WHEN** the extraction is complete
- **THEN** the three G2 commands in `design.md` SHALL report `1`, `2`, and `0`
- **AND** the G1 public-boundary command SHALL return empty output and manual
  target review SHALL find no multiline public-signature change

#### Scenario: Existing named-export outcomes remain exact

- **WHEN** local, renamed, re-exported, ordered multiple-specifier,
  declaration-backed, and multiple-declaration named exports are parsed
- **THEN** the focused G3 ordered-field matrix SHALL pass one test before and
  after extraction

#### Scenario: Adjacent V1 policy and delivery remain stable

- **WHEN** the private helper is reviewed
- **THEN** the three G4 checks and G5 foreign-patch check SHALL return the exact
  SHA-256 hashes recorded in `design.md`
- **AND** G7 SHALL return the exact normalized formatter diagnostic hash
- **AND** every G6 mapped verification command SHALL exit zero

### Requirement: Behavior-stable V1 declaration-export construction

V1 declaration-backed exports SHALL construct local `ExportInfo` values
through one private owner while retaining exact supported and intentionally
ignored declaration coverage.

#### Scenario: Runtime declaration metadata remains exact

- **WHEN** multiple variable declarators and named function/class declarations
  are parsed
- **THEN** G9 SHALL preserve their exact ordered `exported_name`, `local_name`,
  `source`, and `is_default` fields

#### Scenario: Unsupported declaration bindings stay ignored

- **WHEN** destructuring, interface, or type-alias exports are parsed
- **THEN** G9 SHALL produce no declaration-backed `ExportInfo` values

#### Scenario: Declaration construction has one private owner

- **WHEN** increment 04 is complete
- **THEN** G8 SHALL report `1`, `4`, and `0`
- **AND** G10/G11, G1, G5, G7, and the mapped G6 chain SHALL remain exact

### Requirement: Behavior-stable V1 import and default-export collection

V1 import and default-export parsing SHALL remain behind two private helpers
while preserving exact module metadata, ignored import forms, and adjacent
parser ownership.

#### Scenario: Import and default-export policy have private owners

- **WHEN** increment 03 is complete
- **THEN** G12 SHALL report `1`, `2`, `1`, `2`, `0`, and `0`
- **AND** `parse_module_info()` SHALL retain statement dispatch without either
  inline collection body

#### Scenario: Existing import and default-export outcomes remain exact

- **WHEN** ordered mixed imports, bare and namespace imports, and named,
  anonymous, or expression default exports are parsed
- **THEN** the focused G13 matrix SHALL preserve exact order, names, source,
  default flags, and intentionally ignored forms
- **AND** G14, G1, G5, G7, and the mapped G6 chain SHALL remain exact

### Requirement: Stable downstream V1 project-analysis seams

The V1 project-analysis coordinator SHALL keep consumer-visible analysis
behavior exact while making its internal input, component-scan map ownership,
and cache-result construction explicit.

#### Scenario: Internal coordinator inputs are named without changing NAPI

- **WHEN** increment 08 is complete
- **THEN** G15 SHALL find one `AnalyzeInput`-based `analyze()` signature
- **AND** the positional `analyze_project()` NAPI signature SHALL remain exact

#### Scenario: Scan and cache policy retain one owner each

- **WHEN** evaluated components and cache hit/miss results are assembled
- **THEN** G15 SHALL find one component-scan helper definition plus one call
- **AND** one common `CachedFileResult` insertion SHALL preserve each branch's
  prior clone-versus-remove semantics
- **AND** ledger enrichment and dev/production reconciliation SHALL each have
  one private phase owner while `analyze()` retains timing and phase order
- **AND** strict Clippy, Rust units, NAPI canary, and integration SHALL pass

#### Scenario: Parse, provenance, and ordering phases retain explicit owners

- **WHEN** project files are parsed, extension parents are resolved, and
  extractable components are ordered
- **THEN** G15 SHALL find one definition and one call for each phase helper
- **AND** cache-hit take semantics, cache-miss parallel parsing and sequential
  merge, transform alias discovery, unresolved-parent exclusion, same-file and
  imported parent resolution, deterministic ordering, and cycle fallback SHALL
  remain exact
- **AND** `analyze()` SHALL retain each phase timer and the original phase order

#### Scenario: Chain evaluation and inheritance retain explicit owners

- **WHEN** extractable chains are evaluated in topological order
- **THEN** G15 SHALL find one definition and one call for the evaluation,
  parent-merge, and active-prop inheritance helpers
- **AND** transform/bail/skip diagnostic order, cache-hit pre-merge reuse,
  cache-miss static evaluation, pre-merge cache storage, base/pseudo/responsive
  overrides, inherited variants/states/compounds/runtime configs, active props,
  and the Phase 7 chain lookup SHALL remain exact
- **AND** `analyze()` SHALL retain the Phase 5a timer and ordering boundary

#### Scenario: JSX scanning and utility construction retain explicit owners

- **WHEN** compose families, JSX usages, and dynamic/custom utility metadata
  are collected
- **THEN** G15 SHALL find one definition and one call for the JSX-scan and
  utility-output phase helpers
- **AND** compose scanning SHALL precede JSX scanning, cached dev results SHALL
  retain additive reuse, imported aliases SHALL augment all three scan maps,
  and usage/cache output order SHALL remain exact
- **AND** dynamic and custom metadata SHALL retain scale resolution,
  inline-transform filtering, per-component slot identities, and downstream
  cache ownership
- **AND** `analyze()` SHALL retain the Phase 5b timer and ordering boundary

#### Scenario: Runtime metadata and CSS production retain explicit owners

- **WHEN** component runtime metadata, replacements, and project CSS are built
- **THEN** G15 SHALL find one definition and one call for the runtime-metadata
  and CSS-output helpers
- **AND** system/custom prop metadata, dynamic flags, replacement order,
  reconciled component order, compose variants, standalone/composed sublayers,
  utility/custom sheets, global/keyframe assembly, and compatibility CSS
  exclusion SHALL remain exact
- **AND** `analyze()` SHALL retain the Phase 5c and Phase 6 timers with usage
  ledger construction and reconciliation between them

#### Scenario: Manifest data and cache persistence retain explicit owners

- **WHEN** Phase 7 builds consumer metadata and persists per-file analysis
- **THEN** G15 SHALL find one definition and one call for the manifest-data and
  cache-persistence helpers
- **AND** component/file/provenance order, terminal and replacement fields,
  utility values, usage JSON, and compose descriptors SHALL remain exact
- **AND** compose descriptors SHALL be materialized before cache storage drains
  per-file compose data
- **AND** cache hits SHALL retain clone semantics, cache misses SHALL retain
  remove semantics, common insertion and removed-file eviction SHALL remain
  exact, and `analyze()` SHALL retain the Phase 7 timer

#### Scenario: Remaining resolution and manifest policies retain explicit owners

- **WHEN** Phase 2 resolves project imports/static values and Phase 7 finishes
  diagnostics and reverse provenance
- **THEN** G15 SHALL find one definition and one call for the import-resolution,
  invalid-transform-diagnostic, and reverse-provenance helpers
- **AND** relative imports SHALL precede alias expansion and package resolution,
  static/keyframe enrichment order SHALL remain exact, invalid diagnostics
  SHALL retain transform/diagnostic order and bytes, and reverse provenance
  SHALL contain only each component's direct parent
- **AND** `analyze()` SHALL retain the Phase 2 and Phase 7 timing boundaries
