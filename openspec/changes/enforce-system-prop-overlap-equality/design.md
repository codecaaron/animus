## Context

`SystemBuilder.addGroup()` and `SystemBuilder.addProps()` allow a prop key to
overlap an existing registration when the definitions match. The current
policy is duplicated and compares only four fields. A conflict in
`properties`, `variable`, `strict`, or `currentVar` therefore passes and the
later object spread silently replaces the original definition. The builder is
a high-risk public boundary; changes must preserve its type inference,
serialization shape, static `includes` discovery marker, and all unrelated
dirty-tree increments.

## Goals / Non-Goals

**Goals:**

- Reject overlapping prop definitions that differ in any `Prop` field.
- Keep valid identical overlaps working.
- Give both registration entry points one private equality policy.
- Add a focused runtime oracle without expanding the type-contract monolith.

**Non-Goals:**

- Deep-equality semantics for object/array scales or transform functions.
- Registry composition for `createSystem({ includes })`.
- Splitting `packages/system/__tests__/types.test-d.tsx`.
- Broad canonical-spec consolidation or public API changes.

## Decisions

### D1: Centralize prop-definition equality

- **Choice**: Add one private equality helper and call it from both
  `addGroup()` and `addProps()`.
- **Rationale**: The duplicated condition is the drift mechanism. One helper
  makes the complete policy reviewable and gives future `Prop` fields a single
  update seam.
- **Alternatives considered**: Adding comparisons inline twice preserves the
  defect-prone duplication. Comparing serialized output misses type/runtime
  fields that are not serialized.

### D2: Compare arrays structurally and preserve identity-sensitive fields

- **Choice**: Compare ordered `properties` entries by value; compare primitive
  fields directly; retain reference equality for non-primitive `scale` values
  and `transform` functions.
- **Rationale**: Separately allocated `properties` arrays with the same ordered
  targets express the same multi-property definition. Current scale and
  transform identity behavior is already shipped and has no requirement to
  broaden it.
- **Alternatives considered**: Generic deep equality changes inline-scale
  overlap semantics and introduces arbitrary object comparison into a narrow
  builder invariant.

### D3: Add a dedicated runtime contract

- **Choice**: Create `packages/system/__tests__/system-builder.test.ts` for
  positive overlap and conflict behavior across all `Prop` fields and both
  registration methods.
- **Rationale**: The existing 1,162-line type suite proves compile-time shape,
  not runtime throws. A focused test is a clearer ownership seam and begins to
  reduce the hotspot's uncovered behavioral surface.
- **Alternatives considered**: Appending runtime-like expressions to the type
  suite would not execute them and would worsen its churn concentration.

### D4: Preserve `includes` as a static discovery marker

- **Choice**: Do not consume `#includesRegistry` during build or serialization.
- **Rationale**: Git history and package-discovery tests prove the value exists
  to keep imported external systems visible to source analysis. It is not a
  registry-composition contract.
- **Alternatives considered**: Merging included configs would change local
  system semantics, transform resolution, and collision policy without a
  requirement.

## North Star

**Adversarial cadence K**: 1

- **NS1**: A valid overlap has one meaning across every group that names it.
- **NS2**: A conflicting overlap fails before a later registration can become
  observable.
- **NS3**: Equality policy has one implementation and one focused executable
  contract.
- **NS4**: Identity-sensitive scale/transform behavior remains stable —
  provisional — revisit when `external:inline-scale-overlap-contract` exists.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Structural equality for inline object/array scales | deferred | external:inline-scale-overlap-contract | external:inline-scale-overlap-contract | 3 reorientations \| 2026-08-19 |
| DEF-2 | Decompose the type-contract monolith | deferred | external:system-type-suite-decomposition-evidence | external:system-type-suite-decomposition-evidence | 3 reorientations \| 2026-08-19 |
| DEF-3 | Consolidate the stale canonical builder specification | deferred | external:system-builder-spec-consolidation-scope | external:system-builder-spec-consolidation-scope | 3 reorientations \| 2026-08-19 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT alter the `includesRegistry`/constructor-marker path; blind spot: renamed identifiers would evade this text check | inc:01 | STOP | active (calibrated 2026-07-19: empty) |
| G2 | The change SHALL NOT reject equal ordered `properties` arrays or a shared valid definition | inc:01 | STOP | active (inc 01: 2 passed, 13 skipped) |
| G3 | The change SHALL NOT leave either `addGroup()` or `addProps()` able to silently overwrite a conflicting definition | inc:01 | STOP | active (inc 01: 15 passed) |
| G4 | The change SHALL NOT broaden object-scale equality beyond reference identity | inc:01 | STOP | active (inc 01: object/array identity contract passed) |
| G5 | The change SHALL NOT modify the pre-existing Rust, integration, canary, or Next-plugin increments | all | STOP | active (calibrated 2026-07-19: `4d42711d632a83258751c6373f32e3b1148a6dbf7bc2d2b949ff655e2c2db0ad`) |
| G6 | The change SHALL NOT regress system compilation, type contracts, or TypeScript units | change-end | STOP | active (inc 01: 9 workspaces, types, 26 files / 266 tests passed) |

Checks — verbatim commands:

**G1** — expected: empty output

```bash
git diff -- packages/system/src/SystemBuilder.ts | rg '^[+][^+].*(includesRegistry|config[?][.]includes)|^[-][^-].*(includesRegistry|config[?][.]includes)' || true
```

**G2** — expected: targeted positive overlap test passes

```bash
repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts -t 'accepts equivalent ordered property targets'
```

**G3** — expected: all focused builder tests pass

```bash
repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts
```

**G4** — expected: identity-semantics test passes

```bash
repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts -t 'preserves object-scale identity semantics'
```

**G5** — expected:
`4d42711d632a83258751c6373f32e3b1148a6dbf7bc2d2b949ff655e2c2db0ad  -`

```bash
git diff -- 'AGENTS.md' 'openspec/specs/pipeline-integration-testing/spec.md' 'packages/_integration/CLAUDE.md' 'packages/_integration/__tests__/cascade-round-trip.test.ts' 'packages/_integration/__tests__/extraction.test.ts' 'packages/_integration/__tests__/run-pipeline.ts' 'packages/_integration/__tests__/selector-rules.test.ts' 'packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx' 'packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx' 'packages/_integration/fixtures/components/transforms.tsx' 'packages/extract/crates/extract-v2/src/analyze_css.rs' 'packages/extract/crates/extract-v2/src/cross_file.rs' 'packages/extract/crates/extract-v2/src/pipeline.rs' 'packages/extract/tests/canary.test.ts' 'packages/next-plugin/README.md' 'packages/next-plugin/src/with-animus.ts' | shasum -a 256
```

**G6** — expected: every command exits 0

```bash
repowise distill vp run verify:compile
repowise distill vp run verify:types
repowise distill vp run verify:unit:ts
```

## Risks / Trade-offs

- [Risk] A helper omits another `Prop` field -> Mitigation: table-driven tests
  enumerate every current field and review compares the helper against the
  interface.
- [Risk] The new tests accidentally assert implementation details ->
  Mitigation: exercise public `createSystem()` chains and observable throws or
  `toConfig()` output only.
- [Trade-off] Separately allocated object scales remain conflicts -> acceptable
  because it preserves the shipped comparison contract until a real consumer
  signal licenses a broader decision.

## Migration Plan

N/A — no deployment change. The source and regression test land together;
rollback is the independently revertible source/test increment. Acceptance
requires the focused test, mapped system verification, strict OpenSpec
validation, and independent review to pass.
