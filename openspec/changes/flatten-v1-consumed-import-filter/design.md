## Context

`apply_replacements()` invokes `strip_consumed_imports()` only when both
consumed sources and extracted bindings are non-empty. The private stripper
walks source lines, removes only named imports that parse successfully, target
a consumed source, and have every binding extracted, then restores the input's
trailing-newline shape.

The behavior is correct and canonically specified. The maintainability issue is
that the loop nests four independent decision layers. V2 carries its own
compatibility implementation and remains an engine-local oracle consumer.

## Goals / Non-Goals

**Goals:**

- Make the fully-consumed import decision one flat private predicate.
- Keep the source loop focused on line order and newline preservation.
- Characterize the complete conservative line matrix before editing.
- Preserve every emitter/caller/runtime and engine boundary.

**Non-Goals:**

- Support multiline or default/namespace imports.
- Rewrite partial named imports or change alias interpretation.
- Refactor `apply_replacements()` or `parse_named_import()`.
- Edit/share V2 assembly code.

## Decisions

### D1: Extract a guard-clause decision helper

- **Choice**: add private `should_strip_consumed_import()` with fast shape
  guards, a `let Some(...) else` parse guard, and the existing source/all-
  bindings conjunction; call it once from the line loop.
- **Rationale**: recognition becomes readable top-to-bottom and the loop loses
  the nested control tree without changing work performed.
- **Alternatives considered**: separate helpers per condition add indirection;
  a parser rewrite changes behavior.

### D2: Characterize the conservative matrix first

- **Choice**: add `consumed_import_filter_preserves_line_matrix` and run it
  against the nested implementation before production editing.
- **Rationale**: this is a pure refactor, so the honest test-first baseline is
  GREEN. The matrix covers fully consumed, partial, non-target, and
  import-looking non-import lines plus absent final newline.
- **Alternatives considered**: existing tests cover only full and partial paths
  through the larger emitter and do not pin non-target/newline behavior locally.

### D3: Preserve parser and source-shape ownership

- **Choice**: leave `parse_named_import()`, `split('\n')`, append order, and
  trailing-newline restoration unchanged.
- **Rationale**: those are observable transform semantics; only decision
  placement is changing.
- **Alternatives considered**: iterator collection or AST parsing would mingle
  source-shape changes with the nesting refactor.

### D4: Keep V1 and V2 independent

- **Choice**: edit only V1 `transform_emitter.rs`; protect V2 `assemble.rs` by
  content hash.
- **Rationale**: V1 remains the behavioral oracle, and V2's assembly/removal
  metadata phase is intentionally independent.
- **Alternatives considered**: shared parsing code would couple engine-local
  phase boundaries despite zero demonstrated co-change need.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Full consumed named imports are removed; partial and non-target
  imports remain byte-stable.
- **NS2**: One private flat predicate owns the removal decision.
- **NS3**: Line order and trailing-newline shape remain byte-equivalent.
- **NS4**: Public emitter, caller, NAPI, canary, and integration boundaries stay
  stable.
- **NS5**: V2 remains independent — provisional — revisit on
  `repowise:v2-consumed-import-filter-plan`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Parse and remove multiline named imports | deferred | external:multiline-consumed-import | test:multiline-consumed-import | 3 reorientations \| 2026-08-19 |
| DEF-2 | Define aliased-binding removal semantics | deferred | external:aliased-consumed-binding | test:aliased-consumed-binding | 3 reorientations \| 2026-08-19 |
| DEF-3 | Rewrite partial imports to remove only extracted specifiers | deferred | external:partial-import-pruning | external:partial-import-pruning | 3 reorientations \| 2026-08-19 |
| DEF-4 | Apply a parallel source refactor to V2 | deferred | external:v2-consumed-import-filter-plan | repowise:v2-consumed-import-filter-plan | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public emitter type/function signature or caller boundary | footprint:packages/extract/src/transform_emitter.rs | STOP | active (inc 01 final: empty) |
| G2 | Exactly one private predicate SHALL have exactly one production call and the old three-deep decision shape SHALL be absent | footprint:packages/extract/src/transform_emitter.rs | STOP | active (inc 01 final: definition 1; occurrences 2; old nesting empty) |
| G3 | Full/partial/non-target/non-import lines and newline shape SHALL remain characterized | footprint:packages/extract/src/transform_emitter.rs | STOP | active (inc 01 final: focused 1/1) |
| G4 | The V2 assembly implementation SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/assemble.rs | STOP | active (inc 01 final: `8f6e419b67d647563cd954b534593a34a596ea90a87443e07bb33eea8f948bd1`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `4df2a79c93f5864b709eba9e615835879feb9e8ce5dc4d32f9baec4132ff4fd0  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust units 276 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff -- packages/extract/src/transform_emitter.rs | rg '^[+][^+].*(pub struct EmitterConfig|pub struct SourceReplacement|pub struct ComponentReplacement|pub struct VariantPropConfig|pub struct CompoundConfig|pub fn generate_replacement|pub fn generate_compose_replacement|pub fn apply_replacements)|^[-][^-].*(pub struct EmitterConfig|pub struct SourceReplacement|pub struct ComponentReplacement|pub struct VariantPropConfig|pub struct CompoundConfig|pub fn generate_replacement|pub fn generate_compose_replacement|pub fn apply_replacements)' || true
```

**G2** — expected: counts 1 and 2, then empty output

```bash
test "$(rg -c '^fn should_strip_consumed_import\(' packages/extract/src/transform_emitter.rs)" = 1
test "$(rg -c 'should_strip_consumed_import\(' packages/extract/src/transform_emitter.rs)" = 2
rg -n -U 'if trimmed\.starts_with\("import"\).*\n\s*if let Some\(\(bindings, source_str\)\).*\n\s*if consumed_sources\.contains' packages/extract/src/transform_emitter.rs || true
```

**G3** — expected: focused characterization passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml transform_emitter::tests::consumed_import_filter_preserves_line_matrix --lib
```

**G4** — expected:
`8f6e419b67d647563cd954b534593a34a596ea90a87443e07bb33eea8f948bd1  packages/extract/crates/extract-v2/src/assemble.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/assemble.rs
```

**G5** — expected:
`4df2a79c93f5864b709eba9e615835879feb9e8ce5dc4d32f9baec4132ff4fd0  -`

```bash
git diff -- . ':(exclude)packages/extract/src/transform_emitter.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] A guard accidentally broadens line recognition -> Mitigation: preserve
  the exact starts/contains checks and characterize an import-looking string.
- [Risk] Refactoring newline handling changes source bytes -> Mitigation: leave
  the loop/tail restoration intact and characterize a source with no final LF.
- [Risk] Cross-engine duplication appears actionable -> Mitigation: V2 is
  hash-protected and engine-local; DEF-4 names the only reopening signal.
- [Trade-off] `apply_replacements()` remains large -> accepted; this increment
  owns only the highest-impact bounded nested helper.

## Migration Plan

N/A — private V1 refactor with no rollout. Acceptance requires GREEN→GREEN
characterization, G1-G6, strict OODA validation, and independent two-phase
review.
