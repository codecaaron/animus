## Context

`extract_shared_keys()` is a private V1 AST helper called only by
`extract_compose_family()`. Its caller converts `None` to an empty key vector in
the emitted family record. The helper scans the compose options object for the
first valid object-valued `shared` property and collects statically evaluable
keys from its inner object.

The outer `eval_property_key(...)?` creates an intentional compatibility edge:
an unresolvable object property aborts the helper, while a spread is skipped
before key evaluation. Inner unresolvable keys are skipped. Neighboring context
and name readers use different skip semantics. V2 carries an identical engine-
local compatibility implementation and remains independently owned.

## Goals / Non-Goals

**Goals:**

- Flatten outer property/value routing with explicit guards.
- Collect inner keys through one ordered `filter_map`.
- Characterize abort, skip, duplicate, key-kind, and ordering behavior first.
- Preserve every caller/runtime and engine boundary.

**Non-Goals:**

- Change the top-level unresolvable-key abort policy.
- Refactor neighboring context/name readers or compose-family extraction.
- Generalize options parsing across incompatible policies.
- Edit or share the V2 scanner implementation.

## Decisions

### D1: Preserve outer abort separately from structural skips

- **Choice**: use `let ... else { continue }` for non-object properties, retain
  `eval_property_key(&prop.key)?`, then continue for non-`shared` keys and
  non-object `shared` values.
- **Rationale**: the early `?` remains byte-local and legible while structural
  skips stop adding nesting.
- **Alternatives considered**: `filter_map` over outer properties would make
  abort versus skip difficult to preserve and review.

### D2: Collect inner keys with one source-ordered `filter_map`

- **Choice**: map only inner object properties whose keys evaluate statically,
  then collect into `Vec<String>`.
- **Rationale**: it exactly matches the existing inner spread/unresolvable skip
  and source-order behavior without a mutable nested loop.
- **Alternatives considered**: a second private helper adds a seam with no
  second consumer; manual `let ... else` inside the loop remains more nested.

### D3: Characterize the asymmetric matrix before production editing

- **Choice**: add `compose_shared_keys_preserve_abort_skip_and_order` through
  the existing `parse_compose_families()` black-box helper.
- **Rationale**: one source snippet can prove top-level spread skip, wrong-type
  continuation, first-valid duplicate selection, inner spread/unresolvable-
  expression skip, computed string/numeric literal order, and top-level
  unresolvable-expression abort in exact per-index emitted family records.
- **Alternatives considered**: direct private AST construction would couple the
  test to OXC allocation details rather than the caller contract.

### D4: Keep V1 and V2 independent

- **Choice**: edit only V1 `jsx_scanner.rs`; protect V2 `jsx_scan.rs` by hash.
- **Rationale**: the engines own separate AST phases despite identical source.
- **Alternatives considered**: sharing couples distinct OXC dependency surfaces
  without co-change evidence.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Shared-key abort, skip, duplicate, key-kind, and order behavior remain
  exact.
- **NS2**: Two flat outer guards and one inner `filter_map` own extraction.
- **NS3**: Compose family, slot, context, name, and public scanner boundaries
  stay stable.
- **NS4**: NAPI, canary, and integration boundaries remain green.
- **NS5**: V2 remains independent — provisional — revisit on
  `repowise:v2-compose-shared-key-plan`.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Flatten neighboring context/name option readers | deferred | external:compose-option-readers-plan | repowise:compose-option-readers-plan | 3 reorientations \| 2026-08-19 |
| DEF-2 | Introduce a generic compose-options reader | deferred | external:shared-option-policy | external:shared-option-policy | 3 reorientations \| 2026-08-19 |
| DEF-3 | Apply the source refactor to V2 | deferred | external:v2-compose-shared-key-plan | repowise:v2-compose-shared-key-plan | 3 reorientations \| 2026-08-19 |
| DEF-4 | Revisit outer unresolvable-key abort semantics | deferred | external:compose-invalid-key-contract | spec:compose-invalid-key-contract | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter a public JSX scanner type/function signature | footprint:packages/extract/src/jsx_scanner.rs | STOP | active (inc 01 final: empty) |
| G2 | Shared-key extraction SHALL use two flat outer guards and one inner filter, with the old nested branch absent | footprint:packages/extract/src/jsx_scanner.rs | STOP | active (inc 01 final: counts 1/1/1; old branch empty) |
| G3 | Abort, skip, duplicate, key-kind, and order behavior SHALL remain characterized | footprint:packages/extract/src/jsx_scanner.rs | STOP | active (inc 01 final: focused 1/1) |
| G4 | The V2 JSX scanner SHALL remain byte-stable | footprint:packages/extract/crates/extract-v2/src/jsx_scan.rs | STOP | active (inc 01 final: `0febdbe45470bfdcded6f21eeb8f9d005c0c106e77598d370127c92e9336fb1f`) |
| G5 | The change SHALL NOT move any pre-existing dirty increment | all | STOP | active (inc 01 final: `4f61c873c91bcad8900bcf56e21f764ccf914865f6642d3b440f9d843417d036  -`) |
| G6 | The change SHALL NOT regress mapped V1 extraction verification | change-end | STOP | active (inc 01 final: Clippy 0; Rust 280 + 8/1 ignored + 348; canary 200; integration 157) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff --unified=0 -- packages/extract/src/jsx_scanner.rs | rg '^[+][^+].*pub (struct|fn|enum|const|type)|^[-][^-].*pub (struct|fn|enum|const|type)' || true
```

**G2** — expected: counts 1, 1, and 1, then empty output

```bash
test "$(rg -c '^        let ObjectPropertyKind::ObjectProperty\(prop\) = prop else \{' packages/extract/src/jsx_scanner.rs || true)" = 1
test "$(rg -c '^        let Expression::ObjectExpression\(shared_obj\) = &prop.value else \{' packages/extract/src/jsx_scanner.rs || true)" = 1
test "$(rg -c '\.filter_map\(\|shared_prop\|' packages/extract/src/jsx_scanner.rs || true)" = 1
rg -n -U 'if let ObjectPropertyKind::ObjectProperty\(prop\) = prop \{\n\s*let key = eval_property_key\(&prop.key\)\?;\n\s*if key == "shared"' packages/extract/src/jsx_scanner.rs || true
```

**G3** — expected: focused characterization passes

```bash
RUSTUP_TOOLCHAIN=1.97.0 repowise distill cargo test --manifest-path packages/extract/Cargo.toml jsx_scanner::tests::compose_shared_keys_preserve_abort_skip_and_order --lib
```

**G4** — expected:
`0febdbe45470bfdcded6f21eeb8f9d005c0c106e77598d370127c92e9336fb1f  packages/extract/crates/extract-v2/src/jsx_scan.rs`

```bash
shasum -a 256 packages/extract/crates/extract-v2/src/jsx_scan.rs
```

**G5** — expected:
`4f61c873c91bcad8900bcf56e21f764ccf914865f6642d3b440f9d843417d036  -`

```bash
git diff -- . ':(exclude)packages/extract/src/jsx_scanner.rs' | shasum -a 256
```

**G6** — expected: every command exits zero after exact printed prerequisite remediation

```bash
repowise distill vp run verify:clippy
repowise distill vp run verify:unit:rust
repowise distill vp run verify:canary
repowise distill vp run verify:integration
```

## Risks / Trade-offs

- [Risk] Flat guards convert top-level abort into skip -> Mitigation: retain the
  outer `?` exactly and characterize `[outerDynamic]` before `shared`.
- [Risk] Iterator collection changes duplicate or source order -> Mitigation:
  characterize wrong-typed then valid, first-valid then duplicate, and mixed
  identifier/string/numeric keys in exact order.
- [Risk] An inner unresolvable computed expression or spread leaks into the
  result -> Mitigation: characterize `[innerDynamic]` and the spread as skipped
  while computed string/numeric literals remain ordered keys.
- [Risk] Cross-engine duplication appears actionable -> Mitigation: V2 is
  hash-protected and engine-local; DEF-3 names the reopening signal.
- [Trade-off] Neighboring option-reader nesting remains -> accepted; their
  invalid-key semantics differ and DEF-1/DEF-2 preserve the boundary.

## Migration Plan

N/A — private V1 refactor with no rollout. Acceptance requires GREEN behavior,
pre-edit structural RED, final GREEN, G1-G6, strict OODA validation, and
independent two-phase review.
