## Context

V1 `parse_module_info()` dispatches import, named-export, and default-export
statements while also implementing the nested named-export collection policy.
RepoWise rates `import_resolver.rs` at health 5.85 and 85%-hotspot risk; the
method is 72 NLOC, CCN 13, cognitive complexity 42, and nesting 5. Its
high-confidence plan isolates the named-export paragraph with an estimated
three-CCN reduction.

This is the first increment in a persistent V1 module-analysis epic; completing
it does not authorize epic-level verification, retrospective, or archive.
Later rows remain packetless until their exact signals and live evidence exist.

After row 01, fresh live-source and RepoWise reorientation identifies
`collect_declaration_exports()` as the next honest seam: its source is
unchanged by row 01, and it remains 39 NLOC / CCN 9 / cognitive 22 / nesting
4. The broader `parse_module_info()` extraction plan still points at the
already-completed named-export span, so that stale recommendation is rejected.
Increment 04 instead normalizes only declaration-backed `ExportInfo`
construction while preserving its supported and intentionally ignored binding
coverage.

After rows 01 and 04, verified live source shows two remaining inline parsing
paragraphs in `parse_module_info()`: imports and default exports. The user
explicitly requested less ceremony for rote same-file work, so increment 03
combines both private extractions behind one characterization, implementation,
verification, and review cycle. RepoWise's numeric health/refactoring plan is
still indexed at `fd168798` and points at the already-completed row-01 span; it
is retained as historical context, not credited as current-state proof.

The target is clean and has fifteen passing local tests. `project_analyzer.rs`
calls this parser in V1 Phase 1 and consumes its result in Phase 2 binding and
static-export resolution. This increment must preserve exact `ExportInfo`
order and fields without changing any import-resolution policy.

## Goals / Non-Goals

**Goals:**

- Give named-export collection one private owner.
- Characterize local, renamed, re-exported, and declaration-backed named
  exports before production editing.
- Preserve all callers, public types, ordering, and downstream behavior.
- Run the exact V1 Rust change map while protecting ambient dirty work.
- Keep later epic work as separately reviewed and revertible packets rather
  than broadening this source diff.
- Give declaration-backed local exports one private constructor without
  changing which declarations produce runtime bindings.

**Non-Goals:**

- Change accepted import/export grammar or any `ExportInfo` field semantics.
- Refactor import parsing, default exports, re-export traversal, path
  resolution, or static value resolution. Increment 04 may refactor
  declaration-backed metadata construction but SHALL NOT change its coverage.
- Edit V2 or introduce shared cross-engine code.
- Format the pre-existing `follow_export_chain` drift.

## Decisions

### D1: Extract one private named-export collector

- **Choice**: add `collect_named_exports()` taking the OXC named-export node
  and mutable `Vec<ExportInfo>`. `parse_module_info()` retains statement
  dispatch and delegates only that branch.
- **Rationale**: the slice is cohesive, has no external caller, and already
  delegates declaration-backed cases to a neighboring private helper.
- **Alternatives considered**: one helper per specifier, a generic statement
  visitor, or a whole-parser rewrite. Each adds abstraction or rollback radius
  without stronger evidence.

### D2: Characterize exact ordered fields before extraction

- **Choice**: add one direct matrix through `parse_module_info()` covering
  local and renamed local specifiers, direct and renamed re-exports, ordered
  multiple re-export specifiers, variable, function, class, and multiple
  declaration bindings.
- **Rationale**: the helper output is the caller-visible contract. Exact
  `exported_name`, `local_name`, `source`, `is_default`, and order assertions
  prove more than method shape or broad integration alone.
- **Alternatives considered**: rely only on fifteen existing tests or test the
  new private helper after extraction. Both weaken pre-edit behavior evidence.

### D3: Preserve adjacent module-resolution policies

- **Choice**: protect import parsing, default-export parsing, and
  `collect_declaration_exports` with exact marker-bounded hashes; leave
  re-export traversal and path resolution untouched.
- **Rationale**: those policies are compatibility-sensitive and do not need to
  move for this seam.
- **Alternatives considered**: combine all statement branches in one cleanup.
  That would cease to be independently revertible.

### D4: Treat formatter drift as calibrated baseline debt

- **Choice**: require the normalized Rust 1.97 formatter diagnostic to retain
  its exact baseline hash rather than formatting the whole file.
- **Rationale**: whole-file formatting would absorb unrelated committed code;
  the normalized diagnostic catches any new authored drift while tolerating
  line-number movement caused by insertion.
- **Alternatives considered**: accept any nonzero formatter result or format
  the target wholesale. The former hides new debt; the latter widens scope.

### D5: Preserve the exact V1 owner claim

- **Choice**: run strict Clippy, Rust units, NAPI canary, then integration in
  repository-map order after all focused guardrails pass.
- **Rationale**: module metadata crosses the Rust/NAPI/project-analysis
  boundary, so local units alone are insufficient.

### D6: Normalize declaration-backed metadata through one constructor

- **Choice**: add one private `local_export()` constructor and make
  `collect_declaration_exports()` extend its output from ordered iterator/
  option values for variable, function, and class declarations.
- **Rationale**: all three branches construct byte-for-byte identical local
  `ExportInfo` values. Centralizing that invariant removes three repeated
  struct literals and flattens branch nesting without changing AST coverage.
- **Alternatives considered**: broaden `binding_pattern_name()` to
  destructuring, use boxed dynamic iterators, or combine this with default
  exports. Those options change behavior, add runtime machinery, or cross a
  separate rollback boundary.

### D7: Pin supported and intentionally ignored declaration coverage

- **Choice**: add one direct ordered-field matrix covering multiple variable
  declarators, function/class declarations, destructuring, interface, and type
  alias declarations before the production refactor.
- **Rationale**: declaration coverage is a compatibility contract: simple
  runtime bindings are emitted in source order, while destructuring and
  type-only declarations are intentionally ignored.
- **Alternatives considered**: rely on row 01's supported-case matrix alone.
  It does not prove the ignored cases and therefore cannot falsify accidental
  coverage expansion.

### D8: Preserve row 01 and rerun the V1 owner claim

- **Choice**: protect row 01's exact matrix and named-export collector, plus
  import/default parsing, public boundaries, ambient work, formatter baseline,
  and the full mapped V1 verification chain.
- **Rationale**: increment 04 shares a file with row 01 but must remain a
  separately reviewable/revertible patch over its exact completed baseline.

### D9: Extract import and default-export parsing together

- **Choice**: add private `collect_imports()` and `collect_default_export()`
  helpers in one row; `parse_module_info()` retains only statement dispatch.
- **Rationale**: these are the two remaining inline paragraphs in the same
  function/file, share the same public output boundary and mapped verification,
  and are rote moves with independent exact behavior assertions. Splitting
  them would add process without reducing rollback or semantic risk.
- **Alternatives considered**: separate rows per branch or a generic visitor.
  The former is ceremonial; the latter widens abstraction and behavior risk.

### D10: Characterize both branches through one direct matrix

- **Choice**: one test pins ordered mixed imports, bare/namespace skips, and
  named/anonymous/expression default-export hints plus all output fields.
- **Rationale**: a single public-parser matrix proves the combined rollback
  unit while retaining per-case failure labels.

### D11: Preserve completed owners and exact V1 delivery

- **Choice**: protect row-01/04 helpers and matrices, binding/resolution policy,
  public/foreign/formatter boundaries, and rerun the full V1 owner chain once.
- **Rationale**: the file is intentionally cumulative; one consolidated
  preservation guard replaces repeated micro-increment ceremony.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Every named-export form preserves exact ordered `ExportInfo` bytes
  and flags.
- **NS2**: `parse_module_info` owns dispatch; one private helper owns named
  export collection.
- **NS3**: Import, default-export, declaration binding, re-export traversal,
  path resolution, static resolution, and public types remain stable.
- **NS4**: V1 remains an engine-local, independently revertible unit; V2 stays
  untouched unless `external:cross-engine-import-cochange-contract` appears.
- **NS5**: The exact V1 source-map verification remains authoritative.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Change named-export field semantics or ordering | deferred | 02 | external:v1-module-info-behavior-contract | 12 reorientations \| 2026-08-19 |
| DEF-2 | Refactor import/default-export parsing | decided: combine both remaining inline branches | 03 | external:v1-module-info-next-branch (observed 2026-07-19) | independent Phase 1/2 review |
| DEF-3 | Change declaration binding coverage | decided: preserve current coverage while normalizing construction | 04 | external:v1-declaration-export-contract (observed 2026-07-19) | independent Phase 1/2 review |
| DEF-4 | Change re-export traversal or path policy | deferred | 05 | external:v1-import-resolution-policy | 12 reorientations \| 2026-08-19 |
| DEF-5 | Share V1/V2 import-resolution code | deferred | 06 | external:cross-engine-import-cochange-contract | 12 reorientations \| 2026-08-19 |
| DEF-6 | Format unrelated target debt | deferred | 07 | external:v1-import-resolver-format-cleanup | 12 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | No public declaration header or public field in `import_resolver.rs` SHALL be added/removed, and manual target review SHALL find no multiline public-signature change; blind spot: private behavior requires G3/G6 | footprint:packages/extract/src/import_resolver.rs | STOP | active (calibrated 2026-07-19: empty) |
| G2 | Named-export collection SHALL gain exactly one private helper and one production call while the inline source collection leaves `parse_module_info`; blind spot: counts do not prove semantics | inc:01 | STOP | satisfied(inc 01); baseline `0/0/1`, final `1/2/0` |
| G3 | Exact ordered named-export fields SHALL remain stable across the direct matrix | inc:01 | STOP | satisfied(inc 01); baseline focused filter zero, characterization/final one |
| G4 | Import parsing, default-export parsing, and declaration collection SHALL retain exact marker-bounded bytes | footprint:packages/extract/src/import_resolver.rs | STOP | satisfied(inc 01); import/default regions intentionally reopened by inc 03, completed owners move to G14 |
| G5 | The increment SHALL NOT move pre-existing tracked work outside the clean target | all | STOP | active (exact hash below) |
| G6 | The increment SHALL NOT regress the mapped V1 verification chain | change-end | STOP | active |
| G7 | The increment SHALL add no formatter drift beyond the normalized committed baseline diagnostic | footprint:packages/extract/src/import_resolver.rs | STOP | active (exact hash below) |
| G8 | Declaration construction SHALL gain exactly one private constructor, three production references, and remove all three direct struct pushes from its collector | inc:04 | STOP | satisfied(inc 04); baseline `0/0/3`, final `1/4/0` |
| G9 | Supported declaration order/fields and intentionally ignored destructuring/type-only coverage SHALL remain exact | inc:04 | STOP | satisfied(inc 04); baseline focused filter zero, characterization/final one |
| G10 | Import parsing, default-export parsing, named-export collection, and simple binding-name policy SHALL retain exact marker-bounded bytes | inc:04 | STOP | satisfied(inc 04); import/default regions intentionally reopened by inc 03, remaining owners move to G14 |
| G11 | Row 04 SHALL start from the exact reviewed row-01 file/diff and preserve its ordered-field matrix bytes | inc:04 | STOP | satisfied(inc 04); cumulative preservation moves to G14 |
| G12 | Import/default parsing SHALL gain exactly two private helpers/two production calls and remove both inline markers | inc:03 | STOP | armed(inc 03); baseline `0/0/0/0/1/1`, final `1/2/1/2/0/0` |
| G13 | Exact import ordering/skips and default-export hints/fields SHALL remain stable in one combined matrix | inc:03 | STOP | armed(inc 03); baseline filter zero, characterization/final one |
| G14 | Completed named/declaration owners, matrices, binding-name policy, and resolution chain SHALL retain exact bytes | inc:03 | STOP | armed(inc 03); six exact hashes below |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff --unified=0 -- packages/extract/src/import_resolver.rs | rg '^[+-][[:space:]]*pub(\([^)]*\))?[[:space:]]+' || true
```

**G2** — baseline expected `0`, `0`, `1`; final expected `1`, `2`, `0`

```bash
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg '^fn collect_named_exports\(' | wc -l
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg 'collect_named_exports\(' | wc -l
sed -n '/^pub fn parse_module_info(/,/^fn collect_declaration_exports/p' packages/extract/src/import_resolver.rs | rg 'let source_opt = export_decl' | wc -l
```

**G3** — before characterization expected zero tests; after characterization
and after extraction expected one pass

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml import_resolver::tests::named_exports_preserve_existing_matrix --lib
```

**G4** — expected, in order:
`d3a539f2287ec41a03dbdbb44399c2c438df446e4c62974d5a1e099d8ddb792c  -`,
`70b21697acff55422ff4df9d132d8abbcd5c6361506b6658ba2a50ca6ebf4818  -`,
and `83fc0497451e720e4442d8b27c8cc2c91d613288aae57e6309e18206f6181c5b  -`

```bash
sed -n '/Statement::ImportDeclaration(import_decl) => {/,/Statement::ExportNamedDeclaration(export_decl) => {/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/Statement::ExportDefaultDeclaration(export_decl) => {/,/            _ => {}/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^fn collect_declaration_exports(/,/^fn binding_pattern_name(/p' packages/extract/src/import_resolver.rs | shasum -a 256
```

**G5** — expected:
`d3757dd3068d58cb8928d583ff1b72ec9570f99706215700544754bee894241f  -`

```bash
git diff -- . ':(exclude)packages/extract/src/import_resolver.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after any exact printed
prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

**G7** — expected:
`35dec0da7b73e8e03df01d681973d9e5b017572d84ec0a53fad65c79130982eb  -`

```bash
RUSTUP_TOOLCHAIN=1.97.0 rustfmt --edition 2021 --check packages/extract/src/import_resolver.rs 2>&1 | perl -pe 's{^Diff in .*:\d+:\n$}{Diff in TARGET:LINE:\n}' | shasum -a 256
```

**G8** — baseline expected `0`, `0`, `3`; final expected `1`, `4`, `0`

```bash
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg '^fn local_export\(' | wc -l
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg 'local_export' | wc -l
sed -n '/^fn collect_declaration_exports(/,/^fn binding_pattern_name(/p' packages/extract/src/import_resolver.rs | rg 'exports\.push\(ExportInfo' | wc -l
```

**G9** — before characterization expected zero tests; after characterization
and after production refactor expected one pass

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml import_resolver::tests::declaration_exports_preserve_supported_and_ignored_bindings --lib
```

**G10** — expected, in order:
`d3a539f2287ec41a03dbdbb44399c2c438df446e4c62974d5a1e099d8ddb792c  -`,
`70b21697acff55422ff4df9d132d8abbcd5c6361506b6658ba2a50ca6ebf4818  -`,
`68ac8b39b6b4832fff197c63d5b226f81193074ffbf26860fc951c5f4f5979b8  -`,
and `ae4f0901cce5e6313ddc94fbc5ede358df4a1469eca40eea6bbdc6eb71486e68  -`

```bash
sed -n '/Statement::ImportDeclaration(import_decl) => {/,/Statement::ExportNamedDeclaration(export_decl) => {/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/Statement::ExportDefaultDeclaration(export_decl) => {/,/            _ => {}/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^fn collect_named_exports(/,/^}$/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^fn binding_pattern_name(/,/^\/\/ ---------------------------------------------------------------------------/p' packages/extract/src/import_resolver.rs | shasum -a 256
```

**G11** — pre-edit expected, in order:
`34eea14e1cfaccc76da61f5eae433b8c982d8f6ce53ff31a7aa5a66d9df3e0c1`,
`e75f06b50b98cb67537407ef92ad8fda799a7b1700164fffe618778dae9bed0c  -`,
and `cdf4131362399c5d3aac828265d11abaca8690af29216bc42755ade117d8682c  -`;
after editing, only the third hash remains an active invariant

```bash
shasum -a 256 packages/extract/src/import_resolver.rs
git diff -- packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^    fn named_exports_preserve_existing_matrix()/,/^    }$/p' packages/extract/src/import_resolver.rs | shasum -a 256
```

**G12** — baseline expected `0/0/0/0/1/1`; final expected
`1/2/1/2/0/0`

```bash
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg '^fn collect_imports\(' | wc -l
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg 'collect_imports' | wc -l
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg '^fn collect_default_export\(' | wc -l
sed -n '1,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | rg 'collect_default_export' | wc -l
sed -n '/^pub fn parse_module_info(/,/^fn collect_named_exports/p' packages/extract/src/import_resolver.rs | rg 'let source = import_decl\.source' | wc -l
sed -n '/^pub fn parse_module_info(/,/^fn collect_named_exports/p' packages/extract/src/import_resolver.rs | rg 'let local_hint = match' | wc -l
```

**G13** — before characterization expected zero tests; after characterization
and after extraction expected one pass

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml import_resolver::tests::imports_and_default_exports_preserve_existing_matrix --lib
```

**G14** — expected, in order:
`68ac8b39b6b4832fff197c63d5b226f81193074ffbf26860fc951c5f4f5979b8  -`,
`81c8c7684c45e81ca48bb9ec4bfab5a8afa984c4040e1efcdb4cdd4d73776497  -`,
`ae4f0901cce5e6313ddc94fbc5ede358df4a1469eca40eea6bbdc6eb71486e68  -`,
`cdf4131362399c5d3aac828265d11abaca8690af29216bc42755ade117d8682c  -`,
`7c15860a0c03ad79189e3d21510b2c8e100c774bed4447da17dd4747b31a65d5  -`,
and `950c40837bea1d680c297b89bbc5716803f95f536e2e61c18742425aa4f3a59f  -`

```bash
sed -n '/^fn collect_named_exports(/,/^}$/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^fn local_export(/,/^fn binding_pattern_name(/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^fn binding_pattern_name(/,/^\/\/ ---------------------------------------------------------------------------/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^    fn named_exports_preserve_existing_matrix()/,/^    }$/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^    fn declaration_exports_preserve_supported_and_ignored_bindings()/,/^    }$/p' packages/extract/src/import_resolver.rs | shasum -a 256
sed -n '/^pub fn resolve_bindings(/,/^#\[cfg(test)\]/p' packages/extract/src/import_resolver.rs | shasum -a 256
```

## Risks / Trade-offs

- [Risk] Extraction changes local-versus-exported names or order -> Mitigation:
  G3 asserts every field and ordered multiple declarations before and after.
- [Risk] A broad cleanup changes neighboring grammar -> Mitigation: G4 protects
  all adjacent branches and D1 limits the helper to one AST variant.
- [Risk] Whole-file formatting absorbs unrelated baseline code -> Mitigation:
  G7 requires the exact normalized diagnostic and prohibits wholesale format.
- [Risk] Local units pass while project analysis changes -> Mitigation: G6
  includes the full V1 Rust/NAPI/integration owner map.
- [Trade-off] Other parser nesting remains -> acceptable; each remaining seam
  has a separate external signal and lazy owner.
- [Risk] Iterator normalization accidentally widens declaration coverage ->
  Mitigation: G9 pins supported and ignored cases before production editing.
- [Risk] A same-file increment obscures row 01 -> Mitigation: G10/G11 pin the
  completed helper, matrix, neighboring branches, and exact starting diff.
- [Risk] Combining branches hides a per-branch regression -> Mitigation: G13
  labels every import/default case and asserts each branch's exact fields;
  G12 requires both moves independently inside the combined rollback unit.

## Migration Plan

N/A — no deployment or API change. Row 01 added its direct matrix, proved the
inline behavior, extracted only named-export collection, passed G1–G7, and was
independently reviewed; row 04 likewise completed its declaration contract.
Active row 03 adds one combined import/default matrix, proves both inline
branches, extracts both private collectors together, and requires D9–D11/
G12–G14 plus shared G1/G5/G6/G7 in one review cycle. Rollback is manual
reversal of the combined same-file row diff; never use mutative Git.
