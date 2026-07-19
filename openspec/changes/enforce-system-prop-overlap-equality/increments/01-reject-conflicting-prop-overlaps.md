# Increment 01: reject conflicting prop overlaps

## Scope

- **Registry row**: 01 · mode: delegate · review: subagent
- **Resolves**: D1, D2, D3, D4
- **Authors**: — (envelope)
- **Depends on (ordering — deps:)**: none
- **Inputs from (information — inputs:)**: none
- **Footprint**: `packages/system/src/SystemBuilder.ts`,
  `packages/system/__tests__/system-builder.test.ts`, and this packet's
  completion checkboxes/results only
- **Pushes to a later increment**: none; DEF-1, DEF-2, and DEF-3 remain
  externally signaled deferrals

> Resolving signal that licensed creating this increment now: the envelope
> decided D1-D4 and the live reproduction proves the row is safe to fix now.

## Context Capsule

- **Objective**: `createSystem()` chains must accept an overlapping prop only
  when every current `Prop` field is equivalent. Conflicts must throw from
  both `addGroup()` and `addProps()` before a later definition can be returned.
  Preserve public signatures, serialization fields, include discovery, and
  existing scale/transform identity semantics.
- **Root cause**: `SystemBuilder.addGroup()` and `addProps()` duplicate a
  condition that compares only `property`, `scale`, `transform`, and
  `negative`. The `Prop` interface at `packages/system/src/types/config.ts`
  also contains `properties`, `variable`, `strict`, and `currentVar`.
  `nextProps = { ...this.#propRegistry, ...config }` therefore replaces a
  conflicting earlier definition when one of those omitted fields differs.
- **Reproduction**: registering `x` with
  `properties: ['marginLeft', 'marginRight']` / `currentVar: '--first'` and
  then with `properties: ['marginTop', 'marginBottom']` /
  `currentVar: '--second'` succeeds today; `system.toConfig().propConfig`
  contains only the second definition.
- **Existing spec context**:
  `openspec/changes/enforce-system-prop-overlap-equality/specs/system-builder/spec.md`
  §`Complete overlap equality` is the black-box contract. The archived
  `openspec/changes/archive/2026-03-29-flatten-system-builder/specs/flat-system-builder/spec.md`
  §`Prop overlap tolerance` establishes that only identical definitions may
  overlap.
- **Relevant resolved decisions**:
  - D1: one private equality helper is used by both registration methods.
  - D2: ordered `properties` arrays compare by value; primitives compare
    directly; object scales and transforms retain reference equality.
  - D3: runtime behavior belongs in a focused new test file.
  - D4: `#includesRegistry` remains a static discovery marker and is not
    merged into serialization.
- **Upstream inputs**: none.
- **In-scope North Star criteria**: NS1 valid overlaps have one meaning; NS2
  conflicts fail before replacement; NS3 one policy/one focused contract; NS4
  preserve identity-sensitive scale/transform behavior.
- **Prohibitions**: no mutative version-control commands; read-only Git
  inspection required by the packet guardrails is allowed; no writes outside
  the declared footprint plus this increment file; never write `design.md`,
  `tasks.md`, `journal.md`, or `specs/`; do not edit the type-contract monolith;
  do not serialize new fields; do not merge included system registries.

### In-scope guardrails

- **G1 (STOP)**: SHALL NOT alter the include marker path.

  ```bash
  git diff -- packages/system/src/SystemBuilder.ts | rg '^[+][^+].*(includesRegistry|config[?][.]includes)|^[-][^-].*(includesRegistry|config[?][.]includes)' || true
  ```

  Expected: empty output.

- **G2 (STOP)**: SHALL NOT reject equal ordered `properties` arrays or a
  shared valid definition.

  ```bash
  repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts -t 'accepts equivalent ordered property targets'
  ```

- **G3 (STOP)**: SHALL NOT leave either registration entry point unprotected.

  ```bash
  repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts
  ```

- **G4 (STOP)**: SHALL NOT broaden object-scale equality.

  ```bash
  repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts -t 'preserves object-scale identity semantics'
  ```

- **G5 (STOP)**: SHALL NOT move the protected prior increments.

  ```bash
  git diff -- 'AGENTS.md' 'openspec/specs/pipeline-integration-testing/spec.md' 'packages/_integration/CLAUDE.md' 'packages/_integration/__tests__/cascade-round-trip.test.ts' 'packages/_integration/__tests__/extraction.test.ts' 'packages/_integration/__tests__/run-pipeline.ts' 'packages/_integration/__tests__/selector-rules.test.ts' 'packages/_integration/fixtures/components/selector-rules/selector-rules-create-element.tsx' 'packages/_integration/fixtures/components/selector-rules/selector-rules-unresolvable-token.tsx' 'packages/_integration/fixtures/components/transforms.tsx' 'packages/extract/crates/extract-v2/src/analyze_css.rs' 'packages/extract/crates/extract-v2/src/cross_file.rs' 'packages/extract/crates/extract-v2/src/pipeline.rs' 'packages/extract/tests/canary.test.ts' 'packages/next-plugin/README.md' 'packages/next-plugin/src/with-animus.ts' | shasum -a 256
  ```

  Expected:
  `4d42711d632a83258751c6373f32e3b1148a6dbf7bc2d2b949ff655e2c2db0ad  -`.

- **G6 (STOP)**: SHALL NOT regress mapped system verification.

  ```bash
  repowise distill vp run verify:compile
  repowise distill vp run verify:types
  repowise distill vp run verify:unit:ts
  ```

## Plan

## Task 01.1: Write the runtime contract (RED)

- [x] **Step 1:** Create
  `packages/system/__tests__/system-builder.test.ts` using Vitest and the public
  `createSystem()` API. Include:
  - a positive test named `accepts equivalent ordered property targets` that
    registers separately allocated but equal ordered `properties` arrays and
    asserts both group names plus the serialized targets;
  - a table-driven test enumerating differences in every current `Prop` field:
    `property`, `properties`, `scale`, `variable`, `negative`, `strict`,
    `currentVar`, and `transform`, asserting `addGroup()` throws an error that
    names the prop;
  - an `addProps()` conflict test using an omitted field such as `currentVar`;
  - a test named `preserves object-scale identity semantics` asserting two
    distinct equal-valued object scales remain a conflict.

  Use real definitions, no mocks. A suitable fixture helper shape is:

  ```ts
  function prop(overrides: Partial<Prop> = {}): Prop {
    return { property: 'margin', ...overrides };
  }
  ```

- [x] **Step 2:** Run the focused suite before changing production source:

  ```bash
  repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts
  ```

  Record RED evidence: the cases for omitted fields and the `addProps()` case
  must fail because no error is thrown. Existing-field and object-scale cases
  may already pass; that characterizes preserved behavior.

## Task 01.2: Centralize complete equality (GREEN)

- [x] **Step 1:** In `packages/system/src/SystemBuilder.ts`, add a private
  module-level ordered-array equality helper and a private
  `arePropDefinitionsEqual(existing: Prop, incoming: Prop)` helper. The latter
  must compare exactly these current fields:

  ```ts
  existing.property === incoming.property;
  orderedPropertiesEqual(existing.properties, incoming.properties);
  existing.scale === incoming.scale;
  existing.variable === incoming.variable;
  existing.negative === incoming.negative;
  existing.strict === incoming.strict;
  existing.currentVar === incoming.currentVar;
  existing.transform === incoming.transform;
  ```

  `orderedPropertiesEqual` accepts two optional readonly arrays, returns true
  for the same reference (including two `undefined` values), otherwise requires
  both arrays, equal lengths, and equal values at every index. Do not add deep
  equality for `scale` or `transform`.

- [x] **Step 2:** Replace both duplicated compound conditions in `addGroup()`
  and `addProps()` with `!arePropDefinitionsEqual(existing, incoming)`. Preserve
  each method's current error message and all builder/serialization signatures.

- [x] **Step 3:** Run the focused suite and confirm GREEN:

  ```bash
  repowise distill bunx vp test run packages/system/__tests__/system-builder.test.ts
  ```

- [x] **Step 4:** Run formatter/lint diagnostic for the touched TypeScript:

  ```bash
  repowise distill vp run verify:lint
  ```

  If formatting drift is reported, use the repository formatter only on the
  two touched files, then rerun this command. Do not run broad fix commands.

## Task 01.3: Verification and self-review

- [x] **Step 1:** Run mapped verification in order:

  ```bash
  repowise distill vp run verify:compile
  repowise distill vp run verify:types
  repowise distill vp run verify:unit:ts
  ```

  If a command prints `[repowise#<ref>]`, expand that reference rather than
  rerunning the command.

- [x] **Step 2:** Run every guardrail in the gate below and record results.
- [x] **Step 3:** Run `git diff --check` and inspect only the two footprint
  paths with read-only `git diff -- <paths>`. Confirm the helper covers every
  field currently declared by `Prop` and no unrelated source changed.
- [x] **Step 4:** Update this packet's checkboxes and output contract; return
  exact RED/GREEN/verification evidence, proposed journal entries, and any
  surfaced variables. Do not tick `tasks.md`.

## Guardrail gate

- [x] G1: include-marker scoped diff check — result: PASS; exit 0 with empty
      output
- [x] G2: positive overlap targeted test — result: PASS; 2 passed, 13 skipped
- [x] G3: complete focused builder suite — result: PASS; 15 passed
- [x] G4: object-scale identity targeted test — result: PASS; 1 passed, 14
      skipped
- [x] G5: protected diff hash — result: PASS;
      `4d42711d632a83258751c6373f32e3b1148a6dbf7bc2d2b949ff655e2c2db0ad  -`
- [x] G6: compile/types/TS units — result: PASS; compile reported all nine
      workspaces exited 0, types exited 0, and TS units reported 26 files / 266
      tests passed

## Output contract (delegate mode)

- [x] Plan checkboxes above ticked to reflect actual completion
- [x] Authors is envelope-covered; no requirement draft is owed
- [x] Guardrail gate results recorded above, with command output excerpts
- [x] Proposed journal entries (surprise / friction / signal), 1-3 lines each
- [x] Surfaced variables (spawn candidates): recorded below

### Execution evidence

- RED: focused suite exited 1 with 5 failures / 11 tests. The `properties`,
  `variable`, `strict`, and `currentVar` `addGroup()` cases plus the
  `currentVar` `addProps()` case each failed because no error was thrown; the
  6 existing-behavior cases passed.
- GREEN: focused suite exited 0 with 1 file / 15 tests passed after the Phase 2
  test-quality augmentation.
- Lint/format: targeted formatting completed on the two footprint files. The
  repository-wide `verify:lint` rerun still exited 1 naming only root
  `AGENTS.md`, which is outside this increment's footprint and was not edited.
- Self-review: `git diff --check` exited 0; the shared helper compares exactly
  `property`, ordered `properties`, `scale`, `variable`, `negative`, `strict`,
  `currentVar`, and `transform`; both registration methods use it.

### Proposed journal entries

- `signal` — RED isolated five replacement paths that accepted conflicting
  overlaps; GREEN closes both registration entry points with one eight-field
  policy.
- `friction` — repository-wide lint remains externally red because root
  `AGENTS.md` has formatter drift; targeted formatting cleared both increment
  footprint files and the rerun named only `AGENTS.md`.
- `surprise` — none; existing-field conflict behavior and object identity
  semantics matched the capsule and remained green throughout.

### Surfaced variables (spawn candidates)

- V1: root `AGENTS.md` formatter drift prevents a clean repository-wide lint
  claim; candidate for the root-document owner, outside increment 01.

## Spec authorship checklist (orchestrator)

- [x] Confirmed §system-builder/Complete overlap equality remains authored and
      leakage-clean
- [x] Confirmed no Decision Ledger row resolves in this increment
- [x] Appended accepted journal entries attributed via inc 01 subagent
- [x] Reorientation entry written with the full three-stance pass (K=1)
- [x] Ticked registry row 01 with the reorientation timestamp
