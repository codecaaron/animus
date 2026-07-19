## Context

RepoWise ranks `packages/extract/src/project_analyzer.rs` as the repository's
worst health outlier (score 1.4, 99% hotspot, bus factor 1). Its `analyze()`
body is 1,198 lines with CCN 217 and nine nesting levels. The queue's claim
that the file has no governing decision is nevertheless incomplete:
`packages/extract/CLAUDE.md`, canonical `semantic-const-resolution`, archived
phase-order decisions, and integration tests all govern the V1 pipeline.

V1 is the compatibility oracle for v2. This change therefore isolates only
the existing Phase 2a/2b static-resolution block behind a private, engine-local
function. It must not alter observable behavior, timing ownership, NAPI ABI,
manifest serialization, caching, or any pre-existing dirty increment.

## Goals / Non-Goals

**Goals:**

- Give Phase 2 static-value enrichment one named private implementation seam.
- Directly test local statics, aliased imported consts, imported keyframes, and
  same-file keyframe exports at that seam.
- Preserve the existing semantic-const and keyframe black-box contracts.
- Reduce the `analyze()` brain method without crossing engine boundaries.

**Non-Goals:**

- Change static-value precedence, keyframe collision policy, or extraction output.
- Move code into a shared V1/V2 module or a new Rust source file.
- Rework other analyzer phases, the cache, timing schema, manifest, or NAPI API.
- Reduce the entire RepoWise health deficit in one increment.

## Decisions

### D1: Extract the complete Phase 2 static-enrichment block

- **Choice**: Add one private `resolve_project_static_values(...)` helper in
  `project_analyzer.rs` that owns keyframe-registry shaping and per-file static
  enrichment, then call it immediately after `resolve_bindings`.
- **Rationale**: Phase 2a/2b is cohesive, already specified, and already
  bracketed by one timing envelope. Moving the whole block creates a real seam
  without inventing a new abstraction or changing order.
- **Alternatives considered**: Tiny duplicate-snippet helpers do not reduce the
  brain method meaningfully. A new module expands ownership before reuse exists.
  A broad phase rewrite is too risky for the V1 oracle.

### D2: Keep exact insertion and timing order

- **Choice**: Preserve this order inside the helper: clone local statics,
  enrich imported exported statics, inject imported keyframe collections,
  inject same-file keyframe collections. Keep `phase2_start` before binding
  resolution and `import_resolution_ms` after the helper returns.
- **Rationale**: Map overwrite order and timing ownership are existing
  behavior even where only indirectly visible. A refactor must not normalize
  either.
- **Alternatives considered**: Separating keyframes into another call would
  split the phase contract and make precedence easier to drift.

### D3: Test the wished-for private seam before implementing it

- **Choice**: Add a module unit test that calls the absent helper and constructs
  real `FileModuleInfo`, `ResolvedBinding`, static-export, and keyframe maps.
  Observe RED from the missing seam, then add the minimal helper and rerun.
- **Rationale**: This satisfies test-first development while directly locking
  the phase's data contract; the existing integration tests remain the
  black-box safety net.
- **Alternatives considered**: A test that only reruns existing NAPI behavior
  would pass before the refactor and would not prove the new seam exists.
  Source-text assertions would test implementation syntax rather than data flow.

### D4: Preserve engine locality and private visibility

- **Choice**: Keep the helper non-`pub` in `project_analyzer.rs`; do not touch
  v2 or `system-loader`.
- **Rationale**: Cross-engine duplication has no co-change requirement here,
  and V1 remains an independent compatibility oracle.
- **Alternatives considered**: A shared helper would couple two engines with
  different phase shapes and verification roles.

## North Star

**Adversarial cadence K**: 1

- **NS1**: V1 semantic-const and keyframe output remains byte-equivalent for
  identical inputs.
- **NS2**: `analyze()` reads as phase orchestration; Phase 2 enrichment has one
  named implementation and one direct executable contract.
- **NS3**: V1 remains an independent behavioral oracle with no new shared-code
  dependency.
- **NS4**: Timing, cache, manifest, NAPI, canary, and integration boundaries
  remain stable.
- **NS5**: The helper remains in-file — provisional — revisit when
  `external:second-v1-static-resolution-consumer` appears.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Move static resolution into its own module | deferred | external:second-v1-static-resolution-consumer | external:second-v1-static-resolution-consumer | 3 reorientations \| 2026-08-19 |
| DEF-2 | Extract another `analyze()` phase | deferred | external:next-project-analyzer-phase-plan | external:next-project-analyzer-phase-plan | 3 reorientations \| 2026-08-19 |
| DEF-3 | Define keyframe/static export-name collision policy | deferred | external:keyframe-export-name-collision | external:keyframe-export-name-collision | 3 reorientations \| 2026-08-19 |
| DEF-4 | Replace `analyze()` positional inputs with a parameter object | deferred | external:next-analyze-input | external:next-analyze-input | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public analyzer type/function, NAPI/manifest/cache shape, or parser counter; blind spot: a renamed private identifier containing none of the searched tokens would evade this text check | footprint:packages/extract/src/project_analyzer.rs | STOP | active (inc 01 final: empty) |
| G2 | The change SHALL NOT move the existing Phase 2 timing boundaries | footprint:packages/extract/src/project_analyzer.rs | STOP | active (inc 01 final: empty) |
| G3 | The helper SHALL NOT become public or move into a second source file | footprint:packages/extract/src/project_analyzer.rs | STOP | active (inc 01 final: private/in-file) |
| G4 | Static enrichment SHALL NOT lose local values, imported aliases, imported keyframes, or same-file keyframes | footprint:packages/extract/src/project_analyzer.rs | STOP | active (inc 01 final: focused 1/1; keyframe 3/3) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust units 273 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff -- packages/extract/src/project_analyzer.rs | rg '^[+][^+].*(pub (fn|struct|enum)|UniverseManifest|CachedFileResult|PipelineTiming|ANALYZE_PARSE_COUNT)|^[-][^-].*(pub (fn|struct|enum)|UniverseManifest|CachedFileResult|PipelineTiming|ANALYZE_PARSE_COUNT)' || true
```

**G2** — expected: empty output

```bash
git diff -- packages/extract/src/project_analyzer.rs | rg '^[+][^+].*(phase2_start|import_resolution_ms)|^[-][^-].*(phase2_start|import_resolution_ms)' || true
```

**G3** — expected: empty output and exit 0

```bash
rg -n '^pub.*resolve_project_static_values' packages/extract/src/project_analyzer.rs || true
test ! -e packages/extract/src/static_resolution.rs
```

**G4** — expected: focused Rust unit and keyframe-binding integration tests pass

```bash
repowise distill cargo test --manifest-path packages/extract/Cargo.toml project_analyzer::tests::resolves_project_static_values_across_phase_two --lib
repowise distill bunx vp test run packages/_integration/__tests__/keyframes-binding-substitution.test.ts
```

**G5** — expected:
`95572cc99f8487ef872fa077ff8279ee7378e0995f4e5f57a7e16095ef65f514  -`

```bash
git diff -- . ':(exclude)packages/extract/src/project_analyzer.rs' | shasum -a 256
```

**G6** — expected: every command exits 0 after applying any exact prerequisite remediation it prints

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Moving code changes overwrite precedence -> Mitigation: direct test
  asserts all four data sources and black-box keyframe tests remain green.
- [Risk] The helper signature becomes another parameter-heavy boundary ->
  Mitigation: keep it private and limited to the five maps/value inputs the
  existing block already reads; defer a parameter object until a real new input.
- [Risk] Existing dirty Rust work is accidentally moved -> Mitigation: G5
  protects every tracked diff outside the one-file footprint by calibrated hash.
- [Trade-off] RepoWise's overall health score may barely move after one seam ->
  acceptable because the change creates a tested phase boundary without
  trading V1 oracle safety for a metric-driven rewrite.

## Migration Plan

N/A — no deployment change. The source and in-module test form one reversible
increment. Acceptance requires RED for the absent seam, GREEN for the direct
contract, all G1-G6 checks, strict OpenSpec validation, and independent review.
