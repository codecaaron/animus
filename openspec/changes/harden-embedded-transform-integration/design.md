## Context

RepoWise identified `packages/_integration/__tests__/extraction.test.ts` as a
high-churn file without a governing decision. The repository already has
canonical integration-test and behavioral-organization specifications, so that
broad diagnosis is a false positive. Inspection nevertheless found a real,
narrow defect: the named-transform test only asserts placeholder resolution if
the NAPI output already contains a placeholder, and its fixture does not define
a self-contained named transform.

The current Vite and Next integrations treat Rust output as transform-resolved
and only apply unit fallback. The shared integration helper and canonical
pipeline capability still describe the superseded TypeScript placeholder
post-processing path. Archived embedded-evaluation decisions, current Rust
code, and a live NAPI probe agree that valid transform callbacks execute
in-process. The stakeholders are extractor maintainers and contributors who
rely on the integration suite as production-path evidence.

Constraints include the repository's no-mutative-git rule, preservation of
unrelated working-tree increments, one independently revertible change, and the
`packages/_integration/__tests__/**` verification route.

## Goals / Non-Goals

**Goals:**

- Make the named-transform integration assertion non-vacuous.
- Make the shared integration helper mirror the current production plugin
  transform boundary.
- Align the pipeline-integration capability with in-process transform
  evaluation while retaining unit coverage for the compatibility utility.
- Preserve a small, test-owned and independently reversible footprint.

**Non-Goals:**

- Change v1 or v2 Rust transform evaluation or error fallback behavior.
- Remove the exported `resolveTransformPlaceholders` compatibility utility or
  its focused unit tests.
- Tune RepoWise hotspot heuristics or sweep other queue items.
- Generalize integration fixtures or introduce a new shared test abstraction.

## Decisions

### D1: The integration helper follows the current plugin boundary

- **Choice**: Remove placeholder resolution from `runPipeline`; the helper
  consumes Rust-resolved CSS and applies unit fallback, matching the Vite and
  Next integrations.
- **Rationale**: Keeping a compatibility post-processor in the authoritative
  helper can hide output that the production plugins would deliver unchanged.
- **Alternatives considered**: Keep the conditional resolver for defensive
  compatibility. Rejected because it makes integration evidence less faithful;
  the utility retains focused coverage in `post-processing.test.ts`.

### D2: The fixture overrides `size` with a discriminating callback

- **Choice**: Define a self-contained `createTransform('size', ...)` callback
  in the real fixture that doubles numeric inputs, then style a component with
  `width: 4`.
- **Rationale**: The serialized width property selects the `size` transform.
  An emitted `width: 8px` proves the extracted callback ran; raw fallback and
  the built-in size transform would each produce `4px`.
- **Alternatives considered**: Continue using a string transform in `.props()`
  or assert only that no marker appears. Both are rejected because neither
  proves callback extraction and execution.

### D3: Assert the Rust result directly and unconditionally

- **Choice**: Call `analyzeProject` with the real fixture, assert
  `width: 8px`, and always assert that `__TRANSFORM__` is absent.
- **Rationale**: The two assertions jointly prove successful in-process
  evaluation and prevent a conditional from skipping the named behavior.
- **Alternatives considered**: Pass the output through the TypeScript resolver
  before asserting. Rejected because that would test the compatibility utility,
  not the production engine boundary.

### D4: Correct the existing capability through a delta spec

- **Choice**: Modify the `pipeline-integration-testing` requirement through its
  delta spec and directly correct the canonical capability's normative Purpose
  so both describe serialize → NAPI embedded evaluation → unit fallback. The
  Purpose edit is explicit because OpenSpec archive replaces requirement blocks
  but preserves the canonical preamble.
- **Rationale**: The current canonical text names a superseded normal path and
  must be corrected without leaving archive-time ambiguity. Requirements flow
  through the delta tree; the canonical Purpose is corrected directly because
  the installed archive merger preserves that preamble.
- **Alternatives considered**: Treat the mismatch as documentation-only, or
  assume archive will merge the Purpose. Both are rejected: the Purpose is
  normative, and review of the installed archive merger proved it only replaces
  requirement blocks.

### D5: Keep production extractor behavior untouched

- **Choice**: Limit implementation changes to the integration test, fixture,
  shared test helper, local contributor documentation, and the canonical
  capability's Purpose sentence.
- **Rationale**: Current production behavior already satisfies the intended
  contract; the defect is in its evidence and description.
- **Alternatives considered**: Change Rust placeholder fallback or transform
  diagnostics in the same increment. Rejected as a separate compatibility
  decision with materially higher risk.

### D6: Synchronize the intentional fixture through the privileged parity refresh

- **Choice**: record one checked refresh intent, register only the exact CSS,
  code, and observables transitions for `integration/transforms.tsx`, run the
  atomic production/development refresh, then return the transient register to
  `[]` and rerun parity plus integration. Accept the atomic refresh's raw-code
  resnapshot only for two already-reviewed, AST-equivalent selector-fixture
  comment corrections; every non-code selector surface and other unit remains
  identical.
- **Rationale**: the fixture is part of parity's live corpus. Its callback-only
  `width: 8px` behavior was independently proved by increment 01, while the
  later shared-loader gate proved 47/48 baseline units unchanged and isolated
  all drift to this fixture.
- **Alternatives considered**: waive the downstream parity failure, refresh
  under the unrelated loader increment, or remove integration fixtures from
  the corpus. Each would weaken or misassign oracle ownership.

## North Star

**Adversarial cadence K**: 1

- **NS1**: Integration tests demonstrate the production extraction boundary
  with outputs that distinguish intended behavior from compatible fallbacks.
- **NS2**: Assertions for the behavior named by a test remain unconditional.
- **NS3**: Analyzer leads are verified against callers, tests, neighbors,
  decisions, and runtime evidence before they justify edits.
- **NS4**: Test helpers track consumer plugin semantics — provisional — revisit
  when a supported consumer introduces a different post-analysis contract.
- **NS5**: An intentional edit to a parity-enumerated integration fixture is
  incomplete until the checked, exact production/development oracle pair and
  the integration suite agree.

## Decision Ledger

| ID | Decision | Status | Owner increment | Resolving signal | Review-by |
| --- | --- | --- | --- | --- | --- |
| DEF-1 | Replace v1-compatible silent transform-error fallback with diagnostics | deferred | external:v2-transform-diagnostics-scope | external:v2-transform-diagnostics-contract | 6 reorientations \| 2026-10-19 |
| DEF-2 | Remove the exported TypeScript placeholder resolver | deferred | external:placeholder-reachability-audit | external:placeholder-zero-reachability-proof | 6 reorientations \| 2026-10-19 |
| DEF-3 | Audit other integration fixtures for vacuous behavior assertions | deferred | external:integration-oracle-audit | external:integration-oracle-defect-evidence | 6 reorientations \| 2026-10-19 |
| DEF-4 | Tune RepoWise hotspot heuristics | deferred | external:repowise-hotspot-calibration | external:repowise-false-positive-measurement | 6 reorientations \| 2026-10-19 |
| DEF-5 | Synchronize the changed transform fixture with parity | resolved → D6 | 02 | external:embedded-transform-parity-drift | resolved 2026-07-19 11:06 |

## Guardrail Register

| ID | Invariant | Scope | On trip | Status |
| --- | --- | --- | --- | --- |
| G1 | The change SHALL NOT modify the calibrated contents of the two Rust transform authorities; blind spot: unrelated Rust files are outside this check | all | STOP | active (calibrated 2026-07-19: hashes below) |
| G2 | Production Vite and Next plugin source SHALL NOT gain TypeScript placeholder resolution; blind spot: generated output is excluded | all | STOP | active (calibrated 2026-07-19: exit 0) |
| G3 | The named-transform integration assertion SHALL NOT remain conditional on a marker already existing | footprint:packages/_integration/__tests__/extraction.test.ts | STOP | active (inc 01 landed 2026-07-19: exit 0) |
| G4 | The authoritative integration helper SHALL NOT post-process transform placeholders | footprint:packages/_integration/__tests__/run-pipeline.ts | STOP | active (inc 01 landed 2026-07-19: exit 0) |
| G5 | The canonical pipeline capability Purpose SHALL NOT name TypeScript placeholder resolution as part of the production path | footprint:openspec/specs/pipeline-integration-testing/spec.md | STOP | active (review calibration 2026-07-19: one pre-fix match; expected empty after accepted objection) |
| G6 | The baseline repair SHALL classify only the exact two-mode CSS, code, and observables drift from `integration/transforms.tsx` plus its corpus digest | inc:02 | STOP | active |
| G7 | The privileged refresh SHALL require a checked named intent and SHALL leave no active divergence register entry | inc:02 | STOP | active |
| G8 | The refreshed baseline pair SHALL differ from HEAD only in envelope refresh metadata, the `integration/transforms.tsx` unit, and raw code for two reviewed AST-equivalent selector comments; selector non-code surfaces and all other code/units remain identical | inc:02 | STOP | active |
| G9 | The repair SHALL NOT regress parity TypeScript units, committed parity, or full integration | inc:02 | STOP | active |
| G10 | The repair SHALL NOT move tracked work outside its parity footprint | inc:02 | STOP | active |
| G11 | The already-reviewed transform fixture, two selector-comment fixtures, and in-flight system-loader refactor SHALL remain byte-stable during oracle repair | inc:02 | STOP | active |

Checks — verbatim commands:

**G1** — expected: the two exact hashes shown below

```bash
shasum -a 256 packages/extract/src/theme_resolver.rs packages/extract/crates/extract-v2/src/theme.rs
```

Expected output:

```text
c87c4ec9ccc833e22f510ba7a5bbac03209d777d1a1698df833ef5e82052a79f  packages/extract/src/theme_resolver.rs
d44ffaff43500783117b4341aff2efaa9f41da84396573413f1ecd9e9120c2c1  packages/extract/crates/extract-v2/src/theme.rs
```

**G2** — expected: exit 0 and empty output

```bash
! rg -n "resolveTransformPlaceholders" packages/vite-plugin/src packages/next-plugin/src
```

**G3** — expected after increment 01: exit 0 and empty output

```bash
! rg -n "if \\(rawCss\\.includes\\('__TRANSFORM__'\\)\\)" packages/_integration/__tests__/extraction.test.ts
```

**G4** — expected after increment 01: exit 0 and empty output

```bash
! rg -n "resolveTransformPlaceholders" packages/_integration/__tests__/run-pipeline.ts
```

**G5** — expected after the accepted review fix: exit 0 and empty output

```bash
! sed -n '/^## Purpose$/,/^## Requirements$/p' openspec/specs/pipeline-integration-testing/spec.md | rg -n 'resolveTransformPlaceholders'
```

**G6** — expected counts: `2`, `2`, `6`, `2`, and exact old/new hashes.

```bash
rg -c 'integration/transforms\.tsx · css' packages/_parity/last-failure.txt
rg -c 'integration/transforms\.tsx · code' packages/_parity/last-failure.txt
rg -c 'integration/transforms\.tsx · observables' packages/_parity/last-failure.txt
rg -c 'baseline corpus digest differs' packages/_parity/last-failure.txt
rg -n 'a8f689d51f6b832c1a3024e00cb15f83130e3c78cd8c708ccafc25b25803a622 -> 760b26c47722f7c7936d9c45120631dc685c7474eeb36469f1ef84deb0ed9f58|22790ac78746ab5eba70735939a34d61af00b8f061895ead6d3f869cc1b0a33c -> a6384cae245bef8af0e374e6c9313432242da435e5585ae390bbaafaf0bf946c|8edb3872e21f031bd4bd19a9427af186509395e9bcbd3878ef6304445d127d94 -> d2e51fab188d4f910184cc5c80651d21b8adeb9701a67129f092934659950841' packages/_parity/last-failure.txt
```

**G7** — expected: one checked intent match and `true`.

```bash
rg -n '^- \[x\] `embedded-transform-fixture-20260719`' packages/_parity/baseline-intents.md
jq -e '. == []' packages/_parity/register.json
```

**G8** — expected: all six commands exit zero with empty output. The first pair
protects every other unit; the second pair protects selector non-code surfaces;
the third permits only the two named selector code-map entries.

```bash
diff -u <(git show HEAD:packages/_parity/baselines/v2/production.json | jq 'del(.refreshIntent,.corpusSha256,.units["integration/transforms.tsx"],.units["integration/selector-rules"])') <(jq 'del(.refreshIntent,.corpusSha256,.units["integration/transforms.tsx"],.units["integration/selector-rules"])' packages/_parity/baselines/v2/production.json)
diff -u <(git show HEAD:packages/_parity/baselines/v2/development.json | jq 'del(.refreshIntent,.corpusSha256,.units["integration/transforms.tsx"],.units["integration/selector-rules"])') <(jq 'del(.refreshIntent,.corpusSha256,.units["integration/transforms.tsx"],.units["integration/selector-rules"])' packages/_parity/baselines/v2/development.json)
diff -u <(git show HEAD:packages/_parity/baselines/v2/production.json | jq '.units["integration/selector-rules"] | del(.code)') <(jq '.units["integration/selector-rules"] | del(.code)' packages/_parity/baselines/v2/production.json)
diff -u <(git show HEAD:packages/_parity/baselines/v2/development.json | jq '.units["integration/selector-rules"] | del(.code)') <(jq '.units["integration/selector-rules"] | del(.code)' packages/_parity/baselines/v2/development.json)
diff -u <(git show HEAD:packages/_parity/baselines/v2/production.json | jq '.units["integration/selector-rules"].code | del(."selector-rules-create-element.tsx", ."selector-rules-unresolvable-token.tsx")') <(jq '.units["integration/selector-rules"].code | del(."selector-rules-create-element.tsx", ."selector-rules-unresolvable-token.tsx")' packages/_parity/baselines/v2/production.json)
diff -u <(git show HEAD:packages/_parity/baselines/v2/development.json | jq '.units["integration/selector-rules"].code | del(."selector-rules-create-element.tsx", ."selector-rules-unresolvable-token.tsx")') <(jq '.units["integration/selector-rules"].code | del(."selector-rules-create-element.tsx", ."selector-rules-unresolvable-token.tsx")' packages/_parity/baselines/v2/development.json)
```

**G9** — expected: every command exits zero.

```bash
repowise distill vp run verify:unit:ts
repowise distill vp run verify:parity
repowise distill vp run verify:integration
```

**G10** — expected:
`a1a1a5c58a8d99904c0dcf488bb553b3cca2c11ee0bb9180cc1a709455d93887  -`.

```bash
git diff -- . ':(exclude)packages/_parity/baseline-intents.md' ':(exclude)packages/_parity/register.json' ':(exclude)packages/_parity/baselines/v2/development.json' ':(exclude)packages/_parity/baselines/v2/production.json' ':(exclude)packages/_parity/last-failure.txt' | shasum -a 256
```

**G11** — expected the exact four hashes shown below.

```bash
shasum -a 256 packages/_integration/fixtures/components/transforms.tsx packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx packages/extract/crates/system-loader/src/lib.rs
```

```text
fcb666c835812153064d8c012da563aa967ac81f3cebb834bc14468c8587f818  packages/_integration/fixtures/components/transforms.tsx
0b512ac0334b7cf082e67df168514e8335629198d1267f13ec50b1e87ba904cf  packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx
d4fa8e35996102d0ca50918f15d00121cbfb7a189be2b46ee171377a3aa1cdc8  packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx
03c1af1070cc31b39e82a79213d002ca458f8ab2a2a8aed68c8591614bc7f9bf  packages/extract/crates/system-loader/src/lib.rs
```

## Risks / Trade-offs

- [Risk] Removing helper-side resolution exposes a legacy marker in another
  fixture -> Mitigation: run the entire integration suite; any marker-caused
  regression fails in the same increment and stops it.
- [Risk] Overriding the built-in `size` name could become disallowed ->
  Mitigation: the canonical named-transform capability currently requires
  overrides; NS4 names the signal for revisiting the fixture.
- [Risk] A passing `8px` assertion could come from unrelated output ->
  Mitigation: the dedicated fixture contains one width declaration and is
  analyzed directly in the named-transform test.
- [Trade-off] The compatibility resolver remains exported and unit-tested even
  though the production plugins do not use it -> acceptable because removal
  requires separate reachability and public-API evidence (DEF-2).

## Migration Plan

N/A — no deployment change. Apply the test expectation first to capture RED,
then update the fixture/helper/docs and require the full integration suite to
pass. Rollback is a manual reversal of this focused increment; no mutative git
operation is used.
