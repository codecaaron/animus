## 1. Style Evaluator — Per-Property Skip

- [x] 1.1 Add `SkippedProperty` struct to `style_evaluator.rs` with `key: String` and `reason: String` fields
- [x] 1.2 Change `eval_object_expr` return type to `Result<(Value, Vec<SkippedProperty>), BailError>` — `Ok` contains partial result + skip list, `Err` only for structural bail (spread, computed key, getter)
- [x] 1.3 In `eval_object_expr`, catch value-level `BailError` from `eval_expression` per property — on catch, push to skip list and continue loop instead of propagating with `?`
- [x] 1.4 Handle recursive nested objects: when `eval_object_expr` is called for a nested object (pseudo-selector value) and returns `Ok` with skips, thread those skips up. When it returns `Err` (structural bail in nested), treat as a value-level skip on the parent property.
- [x] 1.5 Update `eval_object_expr` tests: existing bail tests become skip tests (function call, variable ref, template literal skip individual property). Structural bail tests remain (spread, computed key).

## 2. Variant and States Evaluation — Propagate Skip Semantics

- [x] 2.1 Update `parse_variant_arg` to use new `eval_object_expr` return shape — collect skips from variant option style objects
- [x] 2.2 Update `parse_states_arg` to use new return shape — collect skips from state style objects
- [x] 2.3 Thread skip warnings from variant/states evaluation up through `parse_variant_from_source` and `parse_object_from_source`

## 3. Process Chain — Skip Diagnostics

- [x] 3.1 Update `parse_object_from_source` to return `Result<(Value, Vec<SkippedProperty>), String>` — partial result with skips
- [x] 3.2 Update `parse_variant_from_source` to return skip info alongside `VariantStageConfig`
- [x] 3.3 In `process_chain`, collect all `SkippedProperty` from styles/variant/states stages and format as `[skip] {binding}: property '{key}' — {reason}` warnings
- [x] 3.4 In `extract()`, push skip warnings into `ExtractionResult.errors` (alongside existing bail errors)

## 4. Canary Test Update

- [x] 4.1 Add canary test case: component with mixed static and non-static properties — verify partial CSS output and skip warnings
- [x] 4.2 Add canary test case: component with non-static value inside pseudo-selector block — verify inner property skipped, rest extracted
- [x] 4.3 Add canary test case: component with spread element — verify structural bail still works (entire object fails)
- [x] 4.4 Update existing snapshot if any current test fixtures are affected by the new behavior
