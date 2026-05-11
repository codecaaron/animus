## Why

The style evaluator currently bails the **entire component** when any single style property contains a non-static expression (function call, variable reference, template literal with interpolation). This means one complex gradient using `.join('')` or one dynamic color reference kills all 20 other perfectly static properties — the component gets zero styles, zero class name, invisible element.

This is the single biggest friction point in the extraction pipeline. Creative CSS work (gradients, shadows, SVG data URIs) naturally produces values that are difficult to express as single static strings. The extractor should extract what it can and skip what it can't, not throw everything away.

## What Changes

- Style evaluator skips individual non-static properties instead of bailing the entire object
- Skipped properties are reported as warnings in the extraction result (not errors)
- Structural issues (spread elements, computed keys, getters/setters) still bail the entire object — these affect the shape of the style object, not just one value
- Chain-level bail semantics unchanged — unknown methods on the builder chain still bail the whole component
- The distinction is **scope**: a `.join()` on the builder chain is structural (bail component), a `.join()` inside a style value is a closed expression (skip property)

## Capabilities

### New Capabilities
- `per-property-bail`: Style evaluator gracefully degrades by skipping non-static properties instead of bailing entire components. Includes diagnostic reporting of skipped properties.

### Modified Capabilities
- `rust-extraction-pipeline`: The static style evaluation requirement changes from "bail entire chain on non-static value" to "skip individual property, continue extraction." Scenarios for bail-on-variable-reference and bail-on-function-call change to property-skip semantics.

## Impact

- **`packages/extract/src/style_evaluator.rs`** — `eval_object_expr` changes from propagating `BailError` to catching and collecting per-property skip warnings
- **`packages/extract/src/lib.rs`** — `parse_object_from_source` and `process_chain` may need to handle a new return shape that includes both partial results and skip diagnostics
- **`packages/extract/tests/canary.test.ts`** — Existing snapshots change (components that previously produced zero output now produce partial output)
- **No API changes** — `ExtractionResult` already has an `errors` field that can carry skip warnings
- **No runtime changes** — extracted CSS is still valid, just has fewer properties for partially-evaluated components
