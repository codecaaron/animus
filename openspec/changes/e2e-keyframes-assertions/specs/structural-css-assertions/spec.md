## ADDED Requirements

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
