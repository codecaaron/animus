## Purpose

Shared, position-aware CSS assertion utilities SHALL live in `packages/_assertions/` (importable as `@animus-ui/assertions`) and replace shell `grep` / `find` for post-build validation. Character-position comparison lets assertions detect layer-order regressions that string containment cannot; centralizing the utilities also ensures Vite and Next consumer fixtures validate the same invariants against the same code.
## Requirements
### Requirement: Position-aware layer order validation
A shared assertion utility SHALL validate that CSS output contains all expected `@layer` blocks in the correct structural order using character position comparison, not string containment.

#### Scenario: Layer order assertion passes for correct CSS
- **WHEN** CSS contains `@layer` declaration, `:root` variables, `@layer anm-global`, `@layer anm-base`, `@layer anm-variants` in that positional order
- **THEN** the layer order assertion SHALL pass

#### Scenario: Layer order assertion fails for misordered CSS
- **WHEN** CSS contains `:root` variables AFTER `@layer anm-base` (as in the confirmed Lightning CSS cascade bug)
- **THEN** the layer order assertion SHALL fail with a message identifying which layers are misordered

#### Scenario: Layer order assertion fails for missing layers
- **WHEN** CSS is missing an expected `@layer` block
- **THEN** the assertion SHALL fail identifying the missing layer by name

### Requirement: Class name format validation
A shared assertion utility SHALL validate that CSS output contains class names matching the Animus naming convention.

#### Scenario: Class names use animus prefix
- **WHEN** the CSS output is inspected
- **THEN** it SHALL contain class names matching the `animus-` prefix pattern

### Requirement: Placeholder and token guards
Shared assertion utilities SHALL check for absence of extraction artifacts that indicate pipeline failures.

#### Scenario: No transform placeholders
- **WHEN** the CSS output is inspected
- **THEN** it SHALL NOT contain `__TRANSFORM__` strings

#### Scenario: No unresolved token references
- **WHEN** the CSS output is inspected against the theme's variable map
- **THEN** no raw token path strings (e.g., `{colors.primary}`) SHALL appear — all MUST be resolved to `var(--*)` references

#### Scenario: No Emotion runtime references
- **WHEN** the JS output is inspected
- **THEN** no file SHALL contain `@emotion` import references

### Requirement: Assertion utilities are importable
The structural CSS assertion utilities SHALL be importable by both `e2e/vite-app` assertions and `e2e/next-app` assertions as a shared workspace module.

#### Scenario: Shared utility location
- **WHEN** the assertion utilities are authored
- **THEN** they SHALL live in `packages/_assertions/src/` (the post-topology home for shared assertions, established by `e2e-workspace-topology` and `shared-assertions-scaffold`)
- **AND** they SHALL be importable as `@animus-ui/assertions` from any `e2e/*` workspace package, from any `packages/*` script, and from `packages/_integration/`
- **AND** the import direction SHALL respect the one-way dependency rule (`e2e/* → packages/*`, never reverse)

### Requirement: Assertions replace shell grep
Post-build assertions for vite-app, showcase, and next-app SHALL use the structural assertion utilities instead of shell `grep`/`find` commands.

#### Scenario: Shell scripts replaced
- **WHEN** post-build assertion scripts are updated
- **THEN** `scripts/assert-showcase.sh` and `e2e/next-app/scripts/assert-next-build.sh` SHALL be replaced with TypeScript assertion scripts using the shared utilities
- **AND** `bun run verify:assert:showcase` and `bun run verify:assert:next` SHALL invoke the TypeScript scripts via `bun run` (delegated through the existing `scripts/verify/assert-*.sh` precondition wrappers)

### Requirement: Keyframes extraction assertion helper

A shared assertion utility `assertKeyframesExtracted(css: string, config?: KeyframesAssertionConfig)` SHALL be exported from `@animus-ui/assertions` (originating in `packages/_assertions/src/assert-css.ts`). The helper SHALL validate, in a single call, that the CSS output of a fixture app correctly extracted keyframes via the `keyframes()` collection primitive. It SHALL throw `AssertionError` on the first failing invariant, returning `void` on success. It SHALL be a pure function over the input string with no I/O.

The config type SHALL be:

```ts
export interface KeyframesAssertionConfig {
  /** Minimum number of distinct @keyframes blocks expected. Default: 1. */
  minBlocks?: number;
  /** Minimum number of distinct animation-name references expected. Default: 1. */
  minReferences?: number;
  /** Prefix every emitted keyframe name must carry. Default: 'animus-kf-'. */
  namePrefix?: string;
  /** If set, every matched @keyframes block MUST appear inside this @layer span. */
  insideLayer?: string;
}
```

The helper SHALL enforce six invariants in fixed order (first failure throws):

1. **Minimum block count**: at least `minBlocks` distinct `@keyframes <namePrefix>...` block declarations SHALL be present.
2. **Minimum reference count**: at least `minReferences` distinct `animation-name: <value>` declarations whose value carries `namePrefix` SHALL be present. Keyword values (`none`, `initial`, `inherit`, `unset`, `revert`, `revert-layer`) SHALL be skipped during reference collection, case-insensitively.
3. **No unit-fallback mangling**: no `animation-name: <namePrefix>...px` substring SHALL appear anywhere in the CSS (guards against `UNITLESS_PROPERTIES` regression). This invariant SHALL be checked BEFORE the dangling-reference check so the diagnostic identifies the `px` mangling directly rather than surfacing as a misleading "no matching block" error.
4. **No dangling references**: every `animation-name: <namePrefix>...` value SHALL match the name of an emitted `@keyframes` block collected in invariant 1.
5. **Cascade placement** (only when `insideLayer` is set): every matched `@keyframes` block offset SHALL fall within the opening and matching-close-brace span of SOME `@layer <insideLayer> { ... }` block in the CSS. Multiple `@layer <insideLayer>` blocks (from chunked output concatenation) SHALL all contribute valid spans. If no layer block with that name is present, invariant 5 SHALL fail.
6. **Prefix conformance**: every emitted and referenced keyframe name involved in invariants 1–5 SHALL start with `namePrefix` (enforced by construction of invariants 1 and 2).

#### Scenario: Passes for well-formed keyframes CSS

- **WHEN** CSS contains `@layer anm-global { @keyframes animus-kf-abc { 0% {} 100% {} } @keyframes animus-kf-def { 0% {} 100% {} } }` followed by two rules each with `animation-name: animus-kf-abc` and `animation-name: animus-kf-def`
- **THEN** `assertKeyframesExtracted(css, { minBlocks: 2, minReferences: 2, insideLayer: 'anm-global' })` SHALL NOT throw

#### Scenario: Fails when no @keyframes blocks are present

- **WHEN** CSS contains only `animation-name: animus-kf-xyz` with no matching `@keyframes animus-kf-xyz` block
- **THEN** `assertKeyframesExtracted` SHALL throw `AssertionError` whose message identifies the missing block count, and the helper SHALL throw before checking reference counts

#### Scenario: Fails when an animation-name reference has no matching block

- **WHEN** CSS contains `@keyframes animus-kf-abc { 0% {} }` plus a rule with `animation-name: animus-kf-xyz`
- **THEN** `assertKeyframesExtracted` SHALL throw `AssertionError` identifying `animus-kf-xyz` as a dangling reference

#### Scenario: Fails when unit-fallback mangles an identifier

- **WHEN** CSS contains a declaration `animation-name: animus-kf-1w7pb41px`
- **THEN** `assertKeyframesExtracted` SHALL throw `AssertionError` whose message identifies the mangled value and flags that `UNITLESS_PROPERTIES` excluded `animation-name`

#### Scenario: Skips CSS keyword values when counting references

- **WHEN** CSS contains a valid `@keyframes animus-kf-abc` block, one rule with `animation-name: animus-kf-abc`, and another rule with `animation-name: none`
- **THEN** `assertKeyframesExtracted(css)` with the default `minReferences: 1` SHALL NOT throw (the keyword `none` SHALL NOT be counted toward the reference total)

#### Scenario: Fails when a block lands outside insideLayer

- **WHEN** CSS contains `@keyframes animus-kf-abc {}` at the top level (outside any `@layer` block) followed by `@layer anm-global {}` and a valid `animation-name: animus-kf-abc` reference
- **THEN** `assertKeyframesExtracted(css, { insideLayer: 'anm-global' })` SHALL throw `AssertionError` identifying `animus-kf-abc` as outside the expected layer span

#### Scenario: Fails when insideLayer block is entirely absent

- **WHEN** CSS contains valid `@keyframes animus-kf-abc {}` and `animation-name: animus-kf-abc` but NO `@layer anm-global {}` block
- **THEN** `assertKeyframesExtracted(css, { insideLayer: 'anm-global' })` SHALL throw `AssertionError` stating that the layer block was not found

#### Scenario: Honors custom namePrefix

- **WHEN** CSS contains `@keyframes custom-abc {}` + `animation-name: custom-abc` and `assertKeyframesExtracted(css, { namePrefix: 'custom-' })` is called
- **THEN** the helper SHALL NOT throw (prefix matching is configurable)

#### Scenario: Unit tests cover every failure mode

- **WHEN** `packages/_assertions/__tests__/assert-css.test.ts` is inspected
- **THEN** it SHALL contain at least one failing-input test for each of invariants 1–5, plus at least one passing-input test, covering the `insideLayer` on/off cases and the keyword-skip edge case

