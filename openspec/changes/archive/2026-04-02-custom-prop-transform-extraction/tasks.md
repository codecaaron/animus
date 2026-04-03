## 1. Rust crate: style_evaluator — transform function capture

- [x] 1.1 Add `CapturedTransform` struct to `style_evaluator.rs`: `{ key: String, span: Span }` — records the property key and function expression span
- [x] 1.2 Expand `eval_object_expr` return type from `Result<(Value, Vec<SkippedProperty>), BailError>` to `Result<(Value, Vec<SkippedProperty>, Vec<CapturedTransform>), BailError>`. Update all 5 callers (3 internal in style_evaluator, 1 in lib.rs, 1 in test helper) to destructure the third element.
- [x] 1.3 In `eval_object_expr`'s property loop, handle ObjectExpression values directly (bypassing eval_expression) to propagate inner captures with the outer property key prepended. When recursing into a nested object, prefix inner CapturedTransform keys with the outer key + `.` separator. This ensures `{ sizing: { transform: fn } }` produces a capture keyed `"sizing.transform"`, not just `"transform"`.
- [x] 1.4 In the same property loop, BEFORE calling eval_expression: if key == `"transform"` and value is `ArrowFunctionExpression` or `FunctionExpression`, push a CapturedTransform with the expression's span and `continue` (skip eval). All other expression types on `transform` fields fall through to normal eval (string literals still work for backward compat; identifiers still bail/skip as before).
- [x] 1.5 Add unit tests: (a) inline arrow on transform field → captured, not bailed, rest of object evaluates normally; (b) function expression on transform field → captured; (c) identifier on transform field → still skipped; (d) arrow on non-transform field → still bails; (e) nested object with transform capture → key is prefixed correctly

## 2. Rust crate: PropConfig + DynamicPropMeta — new field

- [x] 2.1 Add `transform_fn_source: Option<String>` to `PropConfig` in `theme_resolver.rs` (with `#[serde(default)]`)
- [x] 2.2 Add `transform_fn_source: Option<String>` to `DynamicPropMeta` in `project_analyzer.rs`

## 3. Rust crate: lib.rs — thread captured transforms through props stage

- [x] 3.1 Update `parse_object_from_source` to return captured transforms alongside the JSON value: `Result<(Value, Vec<SkippedProperty>, Vec<ResolvedCapture>), String>`. Convert captured spans to source text INSIDE this function using the wrapped source string (`wrapped[span.start..span.end]`), returning `Vec<ResolvedCapture>` (dotted key path + function text) to avoid span offset issues.
- [x] 3.2 In the "props" stage handler of `process_chain`: after deserializing `PropConfigMap` from JSON, iterate captured transforms. For each `("propName.transform", fn_text)` entry, look up `propName` in the deserialized map and set `prop_config.transform_fn_source = Some(fn_text)`.
- [x] 3.3 Thread `PropConfig.transform_fn_source` through to `DynamicPropMeta.transform_fn_source` at both construction sites in `project_analyzer.rs` (system dynamic props ~line 812, custom dynamic props ~line 908).

## 4. Rust crate: transform_emitter — inline function emission

- [x] 4.1 Update `customDynamicConfig` emission in `generate_replacement` (lines 265-268): prefer `transform_fn_source` over `transform_name`. If `transform_fn_source` is Some, emit `"transform":{fn_source}` directly. Else if `transform_name` is Some, emit existing `"transformName":"name","transform":transforms.name` path.
- [x] 4.2 Inline transforms SHALL NOT emit `"transformName"` — no name exists. The runtime binding loop (`if (v.transformName) v.transform = transforms[v.transformName]`) naturally skips entries without `transformName`.
- [x] 4.3 Add unit test: DynamicPropMeta with `transform_fn_source` emits inline function body in customDynamicConfig. Verify existing test for `transform_name` → `transforms.{name}` path still passes unchanged.

## 5. Test fixture + canary update

- [x] 5.1 Update `packages/extract/tests/fixtures/custom-props.tsx`: replace `transform: 'size'` with an inline arrow function. Remove the `@ts-expect-error` on the transform line.
- [x] 5.2 Verify fixture type-checks cleanly: `transform` field now has a valid `TransformFn` value
- [x] 5.3 Update canary test assertion at line ~2461: change `expect(card.replacement).toContain('transforms.size')` to assert the inline function body appears in the replacement instead
- [x] 5.4 JSX `@ts-expect-error` comments on lines 38/40 stay — those are a separate `.props()` scale literal widening issue, not related to this change

## 6. Verification

- [x] 6.1 Run `cargo test --lib` — all 188 Rust unit tests pass (including new style_evaluator + transform_emitter tests)
- [x] 6.2 Run `bun run test:canary` — all 150 canary tests pass with updated assertions
- [x] 6.3 Run `bun test` — all 392 tests pass
- [x] 6.4 Run `bun run verify` — full pipeline clean (pre-existing biome format issue in compound-variants.tsx is unrelated)
