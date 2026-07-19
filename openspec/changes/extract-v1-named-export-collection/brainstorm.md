# Brainstorm: extract V1 named-export collection

This exploration is grounded in live RepoWise evidence, the clean target,
callers, colocated tests, archived extraction decisions, and the repository
verification map.

## Decision chain

1. The original `project_analyzer.rs` queue lead is real, but its live file
   already contains the independently verified static-resolution phase
   extraction from an earlier increment. RepoWise is indexed at `fd168798bbc4`
   and cannot credit that uncommitted improvement yet.
2. The next clean Rust lead is `packages/extract/src/import_resolver.rs`:
   health 5.85, hotspot risk 85% and stable, three dependents, no test gap, and
   a high-severity `parse_module_info` nesting finding (72 NLOC, CCN 13,
   cognitive 42, nesting 5).
3. RepoWise plan `50ce675b9639444d8ec10bfaa9b83a4e` is high-confidence and isolates the
   named-export paragraph at indexed lines 119–137. It estimates a three-CCN
   slice and has no external callers.
4. Live source confirms that paragraph owns one coherent policy: collect
   `export { ... }` specifiers with optional source, otherwise delegate a
   declaration-backed named export to `collect_declaration_exports`.
5. Existing tests cover re-exports and several declarations, but do not pin
   local specifier exports, local renames, all source/local/exported fields,
   ordered multi-specifier re-exports, or ordered declaration bindings in one
   exact matrix. Characterize those outcomes before production editing.
6. Import parsing, default-export parsing, declaration binding rules,
   re-export traversal, path resolution, V2, and public types remain outside
   this rollback unit.

## Known now

- The target is clean at SHA-256
  `9f2c8665caa7687518010aa41349ace914fdd31b18c4dab8afbee447cd31a17f`.
- The protected foreign tracked patch hashes to
  `d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f`.
- Fifteen existing `import_resolver::tests` pass; the proposed focused test
  name selects zero tests before characterization.
- `parse_module_info` is called from V1 Phase 1 after the shared OXC parse and
  before Phase 2 binding resolution. Its returned order and field values feed
  static-export collection and cross-file binding resolution.
- Local specifiers use `source: None`; re-export specifiers copy the module
  source; renamed specifiers retain the source-module name in `local_name` and
  the outward name in `exported_name`.
- Declaration-backed named exports remain delegated to the existing private
  `collect_declaration_exports` policy.
- Namespace imports are intentionally ignored; default exports have a separate
  branch. Neither is part of this helper.
- Whole-file Rust 1.97 formatting has one pre-existing committed diagnostic in
  `follow_export_chain`. Its normalized diagnostic hash is
  `35dec0da7b73e8e03df01d681973d9e5b017572d84ec0a53fad65c79130982eb`.

## Deferred variables and resolving signals

- **Change named-export field semantics or ordering** — defer until
  `external:v1-module-info-behavior-contract` supplies a consumer-visible
  incompatibility and failing oracle.
- **Refactor import or default-export parsing** — defer until
  `external:v1-module-info-next-branch` identifies a separately characterized
  branch.
- **Change declaration binding coverage, including destructuring or TS-only
  declarations** — defer until `external:v1-declaration-export-contract`
  provides explicit accepted forms.
- **Change re-export chain depth, default flags, or path resolution** — defer
  until `external:v1-import-resolution-policy` lands.
- **Share V1/V2 module-resolution code** — defer until
  `external:cross-engine-import-cochange-contract` demonstrates sustained
  co-change while preserving engine-local phase boundaries.
- **Format unrelated committed Rust drift** — defer until
  `external:v1-import-resolver-format-cleanup` owns a dedicated formatting
  footprint.

## Candidate North Stars

- Every current named-export form preserves exact ordered `ExportInfo` fields.
- `parse_module_info` reads as statement dispatch while named-export detail has
  one private owner.
- Import, default-export, declaration-binding, re-export traversal, and path
  policies remain byte-stable.
- The target remains the sole source footprint and the mixed dirty tree is
  protected exactly.
- The V1 Rust change map remains the downstream truth.

## Candidate guardrails

- No added/removed public declaration headers or fields, plus manual proof that
  no multiline public signature changes.
- Exactly one private helper and one production call replace the inline
  named-export paragraph.
- A direct ordered output matrix passes before and after extraction.
- Marker-bounded import, default-export, and declaration-collector regions
  retain exact hashes.
- The protected foreign tracked patch remains exact.
- The normalized whole-file formatter diagnostic remains the single baseline
  hunk; no new formatter drift is accepted.
- Strict Clippy, Rust units, NAPI canary, and integration pass in map order.

The smallest honest first increment is therefore one pre-edit characterization
matrix followed by one private named-export collector extraction. This OODA
change remains the V1 module-analysis epic: later rows may be packetized only
after their exact signals and live evidence appear, and each remains a separate
rollback unit.
