## Context

The Rust extraction crate's `style_evaluator.rs` evaluates object literal expressions from the AST into JSON values. When it encounters a function expression (arrow function, function expression) or identifier, it bails with a non-static error. This is correct for style values — dynamic expressions can't be statically extracted into CSS.

However, the `transform` field in `.props()` custom prop configs is a special case. The value is a runtime function that transforms prop values before applying them as CSS. The Rust crate doesn't need to evaluate the function — it just needs to **preserve the source text** so it can be emitted in the replacement JS.

Custom prop transforms operate differently from group-level transforms:

| | Group-level transforms | Custom prop transforms |
|---|---|---|
| **Scope** | Shared across components | Component-scoped |
| **Identity** | Named (`createTransform('size', fn)`) | Anonymous (identity from component + prop) |
| **CSS path** | `__TRANSFORM__name__VALUE__` placeholders resolved at build time | No CSS placeholders — runtime-only via CSS variables |
| **Registry** | `transforms.size` in shared registry | None — function inlined in replacement JS |
| **Serialization** | TS subprocess via `ds.serialize()` | Rust captures source span from AST |

## Goals / Non-Goals

**Goals:**
- Rust captures inline function expressions from `transform` fields in `.props()` configs
- Function body is emitted directly in the replacement JS (no shared registry)
- Test fixture uses correct TS API (raw function, no `@ts-expect-error`)
- Group-level transform pipeline remains completely unchanged

**Non-Goals:**
- Supporting identifier references to externally-defined transforms in `.props()` (use groups for shared transforms)
- Adding `createTransform()` support to `.props()` (unnecessary — raw functions work)
- Changing how group-level transforms are serialized or resolved
- Evaluating transform functions at extraction time (they're runtime-only for custom props)

## Decisions

### D1: Source span capture for function expressions on transform fields

When `eval_object_expr` processes an object property where:
1. The key is `"transform"`
2. The value is `ArrowFunctionExpression` or `FunctionExpression`

Instead of bailing, capture the source text from the expression's span (`source[span.start..span.end]`). Return it alongside the JSON value in a new output structure.

**Implementation approach:** Add a `captured_transforms` output to `eval_object_expr` — a `Vec<(String, String)>` mapping property paths to source text. The caller (process_chain's "props" stage) reads these captures and attaches them to PropConfig.

**Why not modify eval_expression directly?** eval_expression returns `Result<Value, BailError>` — a captured function isn't a JSON value. Rather than changing the return type everywhere, handle function expressions as a special case in `eval_object_expr` where we have the property key context.

**Scope:** Only applies when the property key is `"transform"`. All other function expression values continue to bail. This is not general-purpose function capture.

### D2: Inline-only constraint — no identifier resolution

Custom prop transforms in `.props()` MUST be inline function expressions:

```tsx
// VALID — function expression directly on transform field
.props({ sizing: { property: 'flexBasis', transform: (v) => `${v}px` } })

// INVALID — identifier reference, still bails
const myTransform = (v) => `${v}px`;
.props({ sizing: { property: 'flexBasis', transform: myTransform } })
```

**Rationale:** Identifier resolution requires scope tracking, binding maps, and cross-file following — significant complexity for a rare pattern. If a transform needs to be shared across components, it should be a named group-level transform via `createTransform()` + system groups. Custom props are component-specific by definition.

This constraint also enables component-scoped identity: the transform is co-located with its usage, so the identity is unambiguously `component + prop_name`.

### D3: New field on DynamicPropMeta for function source

Add `transform_fn_source: Option<String>` to `DynamicPropMeta` in `transform_emitter.rs`. In the emission logic:

```rust
// Prefer inline function source over named transform reference
if let Some(ref fn_src) = meta.transform_fn_source {
    fields.push(format!("\"transform\":{}", fn_src));
} else if let Some(ref tn) = meta.transform_name {
    fields.push(format!("\"transformName\":\"{}\"", tn));
    fields.push(format!("\"transform\":transforms.{}", tn));
}
```

Inline transforms don't emit `transformName` — there is no name. They also don't need the runtime binding loop (`if (v.transformName) v.transform = transforms[v.transformName]`) since the function is already resolved.

### D4: PropConfig gains transform_fn_source

The `PropConfig` struct in `theme_resolver.rs` gains:

```rust
#[serde(default)]
pub transform_fn_source: Option<String>,
```

This is populated in `process_chain`'s "props" stage handler after `eval_object_expr` returns captured transforms. It flows through `project_analyzer.rs` into `DynamicPropMeta.transform_fn_source`.

The existing `PropConfig.transform: Option<String>` (the named transform path) continues to work for group-level configs that arrive pre-serialized from the TS subprocess.

### D5: Source text must be available to eval_object_expr

Currently, `eval_object_expr` receives only the `&ObjectExpression` AST node. To capture source spans, it also needs the source text. Two options:

1. Pass `source: &str` to `eval_object_expr`
2. Return spans from `eval_object_expr`, let the caller do `source[span.start..span.end]`

Option 2 is cleaner — `eval_object_expr` stays source-text-agnostic, returns spans, and the caller (which already has `source`) does the extraction. Add a `captured_fn_spans` field to the return type: `Vec<(String, Span)>` where the string is the property key path.

Actually — since `parse_object_from_source` in `lib.rs` already has the source text (it wraps and parses it), it can do the span-to-text conversion there.

## Future: Rule-level transforms (CSSObject returns)

`TransformFn` is typed to return `string | number | CSSObject`. No existing transform returns CSSObject, and the extraction pipeline doesn't handle it. But the type allows it, and the design should acknowledge the two logical modes:

**Value-level transform** (current scope): config provides `property`, transform provides the CSS value. One input → one declaration.
```tsx
// Config: { property: 'flexBasis', transform: (v) => `${v}px` }
// Output: flex-basis: 100px;
```

**Rule-level transform** (future): transform provides the entire declaration block. `property` is irrelevant — the transform owns the full CSS rule content. One input → N declarations.
```tsx
// Config: { transform: (v) => ({ paddingTop: `${v}px`, paddingBottom: `${v * 2}px` }) }
// Output: padding-top: 8px; padding-bottom: 16px;
```

These are logically separate operations. A value transform produces a CSS value; a rule transform produces a CSS declaration block. The inline capture mechanism handles both identically — the function body is captured verbatim regardless of return type. The distinction matters downstream:

- **CSS generation**: value transforms → `property: __TRANSFORM__...` placeholder at value position. Rule transforms → entire declaration block is the placeholder.
- **Runtime (CSS variables)**: value transforms → one CSS variable per prop. Rule transforms → either inline styles or multiple CSS variables, TBD.
- **Detection**: at capture time, we don't know which mode. The consuming layer (vite plugin subprocess or runtime) evaluates the function and branches on return type.

**Not in scope for this change.** The current implementation captures the function body and emits it for value-level use. Rule-level support can be added when a concrete use case exercises CSSObject returns — the capture mechanism is already in place.

## Risks / Trade-offs

- **[Inline-only constraint]** — Users who want `const myTransform = ...; .props({ x: { transform: myTransform } })` must instead inline the function. This is a documentation/DX concern, not a correctness issue. Shared transforms should use groups.
- **[Source text fidelity]** — The captured function body is raw source text. If it references variables from the surrounding scope (closures), those must survive in the replacement JS context. This already works because the replacement is spliced into the same file scope.
- **[No build-time resolution]** — Custom prop transform values are always resolved at runtime via CSS variables. Static prop values (e.g., `<Card sizing={100}>`) could theoretically be resolved at build time, but the CSS variable mechanism handles them correctly at runtime. This is a performance trade-off we accept for simplicity.
- **[Two transform tiers]** — The system now has two distinct transform mechanisms (group-level named + custom prop inline). This is inherent complexity, but the tiers are cleanly separated by scope (shared vs component) and mechanism (registry vs inline).
- **[CSSObject returns unhandled]** — `TransformFn` allows CSSObject returns but extraction only handles value-level (string/number). Documented above as a future rule-level transform path. No existing transform exercises this.
