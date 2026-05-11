## Why

Custom prop transforms in `.props()` configs don't survive Rust extraction. The `style_evaluator` bails on any non-static expression — function expressions, identifiers, call expressions — so `transform: (v) => v + 'px'` is silently dropped. Consumers must write the undocumented `transform: 'size'` (string literal referencing a group-level named transform) which:

1. Creates a TS type error — `Prop.transform` is typed as `TransformFn`, not a string
2. Couples custom props to the shared group transforms registry — custom props should be self-contained
3. Can't express component-specific transform logic that doesn't exist as a named group transform

The root issue: the extraction pipeline treats custom prop transforms the same as group-level transforms (shared, named, resolved via registry). But they're fundamentally different — custom prop transforms are component-scoped, runtime-only, and don't need names.

## What Changes

- **Inline function capture**: style_evaluator captures function expression source text from `transform` fields instead of bailing. The function body is preserved as a raw source string.
- **Direct emission**: transform_emitter emits the function body directly in the replacement JS (`"transform":(v) => v + 'px'`) instead of a registry reference (`"transform":transforms.size`).
- **No naming required**: Custom prop transform identity is implicit from `component + prop_name`. No `createTransform()` wrapper needed. No shared registry entry.
- **Two transform tiers**: Group-level transforms remain shared/named via `transforms` registry (unchanged). Custom prop transforms are inline/anonymous/component-scoped (new).
- **BREAKING**: `transform: 'size'` string literal workaround no longer needed (and should be removed from fixtures)

## Capabilities

### New Capabilities

_None — this extends existing extraction behavior._

### Modified Capabilities

- `rust-extraction-pipeline`: style_evaluator must capture function expression source spans on `transform` fields, not bail on them
- `named-transforms`: extraction must support inline anonymous transforms in `.props()` configs alongside named group transforms

## Impact

- `packages/extract/src/style_evaluator.rs` — capture ArrowFunctionExpression/FunctionExpression source text when evaluating `transform` fields
- `packages/extract/src/transform_emitter.rs` — emit inline function body for custom prop transforms (new field on DynamicPropMeta)
- `packages/extract/src/project_analyzer.rs` — thread captured function source through to DynamicPropMeta
- `packages/extract/src/lib.rs` — pass source text to style evaluator for span capture; propagate transform function source in props stage
- `packages/extract/tests/fixtures/custom-props.tsx` — switch from `transform: 'size'` to inline function, remove `@ts-expect-error`
- `packages/extract/tests/canary.test.ts` — update assertion from `transforms.size` to inline function body
- No API changes to `@animus-ui/system` — `Prop.transform` already accepts `TransformFn`
