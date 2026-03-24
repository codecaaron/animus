## Context

The extraction pipeline has three layers where "bail" can occur:

1. **Chain walker** (`chain_walker.rs`) — unknown method on the builder chain → `extractable: false`. This is correct and unchanged.
2. **Style evaluator** (`style_evaluator.rs`) — `eval_object_expr()` uses `?` to propagate `BailError` from any non-static property value up through the entire object evaluation.
3. **Process chain** (`lib.rs`) — `parse_object_from_source()` returns `Err` → `process_chain()` returns `Err` → component skipped entirely.

The problem is layer 2. A single non-static value (e.g., `background: arr.join('')`) causes `eval_expression()` → `BailError` → `eval_object_expr()` propagates → entire component gets zero styles.

The user's key insight: method calls inside style values are **closed expressions** — they produce a value but don't affect the builder chain. The extractor can't evaluate them statically, but it CAN safely skip them and extract everything else.

## Goals / Non-Goals

**Goals:**
- Non-static property values skip the individual property, not the entire component
- Structural issues (spread, computed keys, getters) still bail the entire object — they affect object shape
- Skipped properties produce diagnostic warnings (not errors) in ExtractionResult
- Nested contexts (pseudo-selectors, responsive objects) apply the same per-property skip
- Zero changes to chain-level bail semantics

**Non-Goals:**
- Attempting to evaluate non-static expressions at build time (no partial evaluation, no const folding)
- Making skipped properties work at runtime (no hybrid extraction + runtime fallback per property)
- Changing the `ExtractionResult` struct shape

## Decisions

### 1. Two categories of BailError: structural vs. value-level

**Decision:** Split `BailError` into two severity levels. Structural errors (spread, computed key, getter/setter) bail the whole object. Value-level errors (function call, variable ref, template literal with expressions, member expression) skip just that property.

**Rationale:** Structural errors mean we can't even determine the set of properties in the object. A spread (`...baseStyles`) could inject any number of properties — we can't know what we're missing. A computed key (`[dynamicKey]: value`) means we don't know the property name. These corrupt the object shape.

Value-level errors mean we know the property name and position, we just can't resolve the value. Safe to skip.

**Alternative considered:** A single `BailError` with a flag — rejected because the distinction is semantic, not just severity. Structural errors are fundamentally different from value errors.

### 2. Collect warnings during evaluation, return partial result

**Decision:** `eval_object_expr` returns `Result<(Value, Vec<SkippedProperty>), BailError>` — `Ok` with a partial object and skip diagnostics, or `Err` only for structural bail. The `SkippedProperty` carries the property name and reason.

**Rationale:** This lets callers decide how to handle skips. `parse_object_from_source` can thread the warnings through to `process_chain` and into the `ExtractionResult.errors` vec (which already exists and is surfaced to the user).

**Alternative considered:** Making `eval_object_expr` always succeed by treating structural errors as "skip all properties" — rejected because spread elements genuinely corrupt the result (we'd have an incomplete property set without knowing it).

### 3. Recursive skip in nested objects

**Decision:** When evaluating a nested object (pseudo-selector block, responsive value), apply the same per-property skip. A non-static value inside `'&:hover': { color: dynamicVar, bg: 'red' }` skips `color` but keeps `bg`.

**Rationale:** Pseudo-selector blocks and responsive objects are just nested style objects. The same logic applies recursively.

**Edge case:** If a pseudo-selector key's VALUE is entirely non-static (e.g., `'&:hover': someFunction()`), that's a value-level error on the parent property `'&:hover'` — skip the entire pseudo block. This is correct because we can't evaluate the block at all.

### 4. Warnings format reuses existing `errors` vec

**Decision:** Skipped property warnings go into `ExtractionResult.errors` with a distinct prefix: `"[skip] ComponentName: property 'background' skipped — function call (non-static)"`.

**Rationale:** No API change. The `errors` field already carries bail reasons. Adding skip warnings with a `[skip]` prefix lets consumers distinguish them from full bails. The Vite plugin already logs these.

**Alternative considered:** A separate `warnings` field on `ExtractionResult` — rejected because it's a NAPI struct change that ripples into the JS side for marginal benefit.

## Risks / Trade-offs

**[Risk] Partial extraction produces confusing visual results** — A component with 20 properties but 1 skipped might render with 19 correct styles and one missing (e.g., no background). The developer sees a mostly-styled component with a mysterious gap.
→ **Mitigation:** The `[skip]` warning in the extraction output names the exact property and reason. The Vite plugin already logs extraction errors. Additionally, we could emit a CSS comment above the component's rules listing skipped properties.

**[Risk] Spread elements could hide inside nested objects** — `{ '&:hover': { ...hoverStyles } }` — the spread is inside a nested object, not at the top level.
→ **Mitigation:** The recursive evaluation already catches this. `eval_object_expr` is called recursively for nested objects, and spread at any level triggers structural bail for that nested object. The parent property (`'&:hover'`) then fails as a value-level error and gets skipped.

**[Trade-off] More properties extracted = more CSS generated = larger output for partially-extractable components** — Previously these components produced zero CSS. Now they produce CSS for all static properties. This is net positive (the component actually works) but increases output size relative to the zero-output baseline.
