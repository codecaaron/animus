## Context

`rewrite_module_for_bundle()` is a private module-walking seam in the
engine-neutral system-loader crate shared by both NAPI bindings. It parses one
module, rewrites imports and exports into an internal CommonJS-like runtime,
applies span operations in reverse order, and appends local export assignments.

RepoWise identifies the function as a critical 208-NLOC method with CCN 30,
cognitive complexity 136, and nesting depth 8. Its high-confidence extraction
plan isolates the import-specifier rendering branch. That branch has stable,
directly observable string outputs and no external callers, while the remaining
export and evaluation policies are independent and stay in place.

## Goals / Non-Goals

**Goals:**

- Give import-specifier rendering one private named owner.
- Characterize every existing import form before production editing.
- Preserve exact rewritten bytes, require-key lookup, spans, and module order.
- Protect the public API, export walker, execution seam, and dirty tree.

**Non-Goals:**

- Refactor export rewriting, `resolve_all_deps()`, or bundle execution.
- Change parser diagnostics, namespace/default semantics, or stub behavior.
- Deduplicate all `ModuleExportName` conversion.
- Split the file or change V1/V2 extraction phases.
- Change rquickjs evaluation or its trust model.

## Decisions

### D1: Extract one private import-specifier renderer

- **Choice**: add `rewrite_import_specifiers()` taking a non-empty OXC import
  specifier slice and the resolved require key, returning the existing joined
  replacement string. Keep bare-import handling, span ownership, and op
  insertion in `rewrite_module_for_bundle()`.
- **Rationale**: this is the analyzer's highest-confidence bounded seam. It
  removes the nested binding-state policy from the main walker without moving
  parser, lookup, or rewrite-operation ownership.
- **Alternatives considered**: flattening all statement arms is too broad;
  extracting an entire declaration rewrite would mix key lookup and spans with
  rendering; deduplicating name conversion first has less impact on the
  critical method.

### D2: Characterize exact rewrite bytes before production editing

- **Choice**: add one direct private test matrix for bare, explicit-empty,
  named, aliased, default-plus-named, namespace, default-plus-namespace,
  canonical-key, and stub-key imports. Run it GREEN against the inline
  implementation, while the helper-count check remains honestly RED.
- **Rationale**: the returned string is the narrowest black-box contract for
  this pure refactor and pins ordering, punctuation, alias syntax, and fallback
  behavior independently of later bundle evaluation.
- **Alternatives considered**: canary-only coverage conflates this rendering
  with dependency resolution and rquickjs execution; snapshotting the entire
  bundle would obscure which compatibility edge changed.

### D3: Preserve namespace dominance as compatibility behavior

- **Choice**: when default and namespace specifiers coexist, retain the current
  namespace-only replacement and assert its exact output.
- **Rationale**: changing this oddity would turn a structural cleanup into an
  unrequested behavior change with unknown consumers.
- **Alternatives considered**: emitting both bindings is more intuitive but
  requires an explicit compatibility contract and broader downstream review.

### D4: Keep shared-loader boundaries and mapped verification intact

- **Choice**: edit only the private import renderer, its call site, and one
  colocated test. Protect public declarations, export/execution tokens, and the
  foreign dirty diff; then run the exact system-loader change-map chain.
- **Rationale**: the crate is engine-neutral and load-bearing for both NAPI
  bindings, so boundary preservation and the complete mapped oracle are part of
  the smallest honest claim.
- **Alternatives considered**: treating this as a local crate-only change would
  omit parity and integration evidence required by the repository map.

### D5: Resume only after the fixture owner repairs the committed parity oracle

- **Choice**: accept the reviewed completion signal from
  `harden-embedded-transform-integration#02`, treat its checked intent and
  generated baseline pair as a mid-run resumption signal rather than a packet
  creation input, and rerun the suspended loader chain from parity through
  integration. G5 excludes only that repair's exact tracked parity artifacts
  while preserving the original foreign-diff hash and pins their final hashes
  separately.
- **Rationale**: the stale corpus digest and transform-unit drift predated and
  were source-independent of the loader extraction. The fixture-owning change
  now proves its repair with an empty register, parity 48/48 in both modes, and
  integration 157/157; absorbing those files into this loader row would
  misassign ownership.
- **Alternatives considered**: waive parity, refresh under the loader row, or
  recompute an unbounded foreign hash. All are rejected because they either
  weaken NS4, transfer oracle ownership, or hide unrelated dirty-tree motion.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Every current import form produces byte-for-byte identical output
  for canonical and stub require keys.
- **NS2**: Import-specifier policy has one private owner; the main walker owns
  only dispatch, key lookup, spans, and rewrite-op insertion.
- **NS3**: Export rewriting, reverse-span application, trailing exports,
  dependency resolution, execution, and public APIs remain stable.
- **NS4**: Strict Clippy, dependency hygiene, Rust units, NAPI canary, parity,
  and integration remain the downstream oracle.
- **NS5**: Namespace dominance remains byte-stable — provisional — revisit
  only when `external:system-loader-namespace-default-contract` appears.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Split remaining export routes | deferred | external:system-loader-export-rewrite | external:system-loader-export-rewrite-plan | 6 reorientations \| 2026-08-19 |
| DEF-2 | Refactor dependency resolution | deferred | external:system-loader-dependency-resolution | external:system-loader-dependency-resolution-plan | 6 reorientations \| 2026-08-19 |
| DEF-3 | Deduplicate module export-name conversion | deferred | external:module-export-name-deduplication | external:module-export-name-third-consumer | 6 reorientations \| 2026-08-19 |
| DEF-4 | Change namespace-plus-default semantics | deferred | external:system-loader-namespace-default | external:system-loader-namespace-default-contract | 6 reorientations \| 2026-08-19 |
| DEF-5 | Change malformed-module handling | deferred | external:system-loader-malformed-module | external:system-loader-malformed-module-matrix | 6 reorientations \| 2026-08-19 |
| DEF-6 | Change rquickjs evaluation boundary | deferred | external:system-loader-eval-boundary | external:system-loader-eval-threat-model | 6 reorientations \| 2026-08-19 |
| DEF-7 | Split the loader file | deferred | external:system-loader-file-split | external:system-loader-file-split-cohesion | 6 reorientations \| 2026-08-19 |
| DEF-8 | Synchronize the intentionally changed embedded-transform fixture with the committed parity oracle | resolved → D5 | change:harden-embedded-transform-integration#02 | change:harden-embedded-transform-integration#02 | resolved 2026-07-19 11:37 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public system-loader type or function signature | footprint:packages/extract/crates/system-loader/src/lib.rs | STOP | active |
| G2 | Import rendering SHALL gain exactly one private helper and one call while old inline binding state leaves the main walker; blind spot: count checks do not prove semantics | inc:01 | STOP | active |
| G3 | Exact import output SHALL NOT drift across the characterized bare, explicit-empty, binding, key, and namespace matrix | inc:01 | STOP | active |
| G4 | Changed production lines SHALL NOT touch named export, trailing-export, reverse-span, execution, extraction, or eval tokens; blind spot: diff-token search is paired with manual target review | footprint:packages/extract/crates/system-loader/src/lib.rs | STOP | active |
| G5 | The increment SHALL NOT move pre-existing tracked work outside the target file or the reviewed fixture-owner parity repair; the exact repair artifacts and retained failing diagnostic SHALL remain byte-stable | all | STOP | active |
| G6 | The increment SHALL NOT regress the exact mapped shared-loader verification chain | change-end | STOP | active |

Checks — verbatim commands:

**G1** — expected: empty output. Calibrated before inc 01: empty.

```bash
git diff --unified=0 -- packages/extract/crates/system-loader/src/lib.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true
```

**G2** — baseline expected: `0`, `0`, `3`. Final expected: `1`, `2`, `0`.

```bash
rg '^fn rewrite_import_specifiers\(' packages/extract/crates/system-loader/src/lib.rs | wc -l
rg 'rewrite_import_specifiers\(' packages/extract/crates/system-loader/src/lib.rs | wc -l
sed -n '/^fn rewrite_module_for_bundle(/,/^fn collect_declaration_export_names(/p' packages/extract/crates/system-loader/src/lib.rs | rg 'let mut (destructure_parts|default_name|namespace_name)' | wc -l
```

**G3** — baseline expected: zero tests with nine filtered; after
characterization and production edit: one passing test.

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/crates/system-loader/Cargo.toml tests::import_rewrite_preserves_existing_output_matrix --lib
```

**G4** — expected: empty output. Calibrated before inc 01: empty.

```bash
git diff --unified=0 -- packages/extract/crates/system-loader/src/lib.rs | rg '^[+-][^+-].*(Statement::Export|trailing_exports|ops\.sort_by_key|replace_range|execute_bundle|extract_system_config|ctx\.eval)' || true
```

**G5** — expected protected source/config hash:
`73cdd94fbb9e62a831fc9dc36ab749e72c6d24ddd7cea416416556eebd8668e8  -`.
The exact external-repair hashes below must also match, and the retained
pre-repair diagnostic must still contain the three fixture-only transitions
that attributed the original G6 STOP.

```bash
git diff -- . ':(exclude)packages/extract/crates/system-loader/src/lib.rs' ':(exclude)packages/_parity/baseline-intents.md' ':(exclude)packages/_parity/baselines/v2/development.json' ':(exclude)packages/_parity/baselines/v2/production.json' ':(exclude)packages/_parity/last-failure.txt' | shasum -a 256
shasum -a 256 packages/_parity/register.json packages/_parity/baseline-intents.md packages/_parity/baselines/v2/development.json packages/_parity/baselines/v2/production.json packages/_parity/last-failure.txt
rg -n 'a8f689d51f6b832c1a3024e00cb15f83130e3c78cd8c708ccafc25b25803a622 -> 760b26c47722f7c7936d9c45120631dc685c7474eeb36469f1ef84deb0ed9f58|22790ac78746ab5eba70735939a34d61af00b8f061895ead6d3f869cc1b0a33c -> a6384cae245bef8af0e374e6c9313432242da435e5585ae390bbaafaf0bf946c|8edb3872e21f031bd4bd19a9427af186509395e9bcbd3878ef6304445d127d94 -> d2e51fab188d4f910184cc5c80651d21b8adeb9701a67129f092934659950841' packages/_parity/last-failure.txt
```

Expected repair artifact hashes:

```text
37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570  packages/_parity/register.json
3d19fc34bd8d8cba529f7240780b641bf092fd83ec7338338356c2e317cf07e8  packages/_parity/baseline-intents.md
9227b850063f7d5d3f2ca2037f87ea0c2a61397a378861468cad82ef321128aa  packages/_parity/baselines/v2/development.json
a1b2e39f7d4cbe130bbbe9770d1d48fc9ad7e43bd273c207a3e72a3e80cd0592  packages/_parity/baselines/v2/production.json
86b7b77ab2259afcbc5bb08f85cabdb517adecf2ac47c7eaa25d59141fe36f3d  packages/_parity/last-failure.txt
```

**G6** — expected: every command exits zero after exact printed prerequisite
remediation.

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:hygiene:rust
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:parity
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Slice typing or OXC arena coercion changes ownership semantics ->
  Mitigation: keep borrowed AST data inside the rewrite call and require strict
  Clippy plus full Rust units.
- [Risk] Bare imports take a subtly different `None` versus empty-specifier
  path -> Mitigation: keep both outside the helper and pin the exact output.
- [Risk] Default/named ordering or alias punctuation drifts -> Mitigation: use
  exact strings in the direct pre/post matrix.
- [Risk] The namespace oddity is accidentally “fixed” -> Mitigation: assert
  the current default-plus-namespace output and retain DEF-4.
- [Risk] Shared-loader blast radius is under-tested -> Mitigation: run the
  complete map through parity and integration, not just local units.
- [Trade-off] Export routing remains complex -> accepted; DEF-1 requires a
  separate evidence-backed seam and keeps this increment independently
  revertible.

## Migration Plan

N/A — private Rust refactor with no deployment change. Acceptance requires a
GREEN behavior matrix against the inline implementation, genuine structural
RED before editing, final GREEN, G1-G6, strict OODA validation, and independent
two-phase review.
