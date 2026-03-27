## `.asClass()` Terminal — Specification

### Builder Chain Terminal

`.asClass()` is a terminal method on the builder chain, alongside `.asElement()` and `.asComponent()`. It returns a callable function that resolves to a className string.

**Available at the same chain positions as `.asElement()`:**
- After `.styles()`
- After `.variant()`
- After `.states()`
- After `.compound()`
- After `.groups()`
- After `.props()`

**Not available:**
- Before `.styles()` (must have at least base styles)
- After another terminal (`.asElement()`, `.asComponent()`, `.asClass()`)

### Return Type

Always `(props?: InferredProps) => string`.

`InferredProps` is the union of:
- Variant props: `{ [variantProp]: VariantKey }` for each `.variant()` call
- State booleans: `{ [stateName]: boolean }` for each key in `.states()`
- System props: flattened group props for each group in `.groups()`
- Dynamic props: prop types for each prop in `.props()`
- Compound conditions do not add props (they use variant/state props)

If the chain has no dynamic aspects (only `.styles()`), `InferredProps` is `{}` — call with no arguments.

### Runtime: `createClassResolver`

**File:** `packages/system/src/createClassResolver.ts` (new)

```ts
export function createClassResolver(
  baseClassName: string,
  config: {
    variants?: VariantRuntimeConfig[],
    states?: StateRuntimeConfig,
    compounds?: CompoundRuntimeConfig[],
    systemPropMap?: SystemPropMap,
    dynamicPropConfig?: DynamicPropConfig,
  }
): (props?: Record<string, unknown>) => string
```

**Behavioral contract:**

1. Always includes `baseClassName` in output
2. For each variant prop present in `props`, appends the matching variant className
3. For each state boolean `true` in `props`, appends the matching state className
4. For each compound condition fully matched by `props`, appends the compound className
5. For system props, looks up utility classNames from `systemPropMap`
6. For dynamic props, generates inline CSS variable style string (same as createComponent)
7. Returns space-joined className string

**Note on dynamic props:** When `.props()` is used, the resolver needs to return BOTH a className and an inline style object (for CSS variable bindings). The return type becomes `(props?) => string` for chains without `.props()`, or a richer return for chains with `.props()`. This matches the current `createComponent` split between className and style.

**Simplification:** For v1, `.props()` + `.asClass()` may be deferred. The primary use case is `.styles()` + `.variant()` + `.states()` + `.groups()`. Dynamic props (`.props()`) imply per-instance CSS variable injection which couples to the element — better served by `.asElement()`.

### Extraction: Rust Crate

**File:** `packages/extract/src/chain_walker.rs`

Recognition: `.asClass()` is a terminal, same as `.asElement()` and `.asComponent()`. The chain walker identifies it by method name on the terminal call expression.

**File:** `packages/extract/src/transform_emitter.rs`

Emit shape:

```js
// Input
const card = ds.styles({ display: 'flex', p: 16 }).asClass()

// Output (static — no variants/states/groups)
import { createClassResolver as _cr } from '@animus-ui/system'
const card = _cr("animus-card-a1b2c3", {})

// Output (dynamic — with variants)
import { createClassResolver as _cr } from '@animus-ui/system'
const card = _cr("animus-card-a1b2c3", {
  variants: [{ prop: "size", default: "md", classes: { sm: "animus-card-a1b2c3--variant-size-sm", lg: "animus-card-a1b2c3--variant-size-lg" } }],
})
```

**CSS generation** is identical to `.asElement()` chains — same `css_generator.rs` pipeline, same `@layer` assignment. The terminal does not affect CSS output.

### Class Naming

| Mode | Pattern | Stability |
|---|---|---|
| Dev | `animus-{varName}-{positionHash}` | Stable across edits (HMR-safe) |
| Prod | `animus-{varName}-{contentHash}` | Optimal caching |

Variable name inferred from AST assignment (`const card = ...` → `card`). Same inference logic as component name detection.

### Cascade Contract

Unchanged. Layer assignment by chain method:

| Chain method | CSS Layer |
|---|---|
| `.styles()` | `@layer base` |
| `.variant()` | `@layer variants` |
| `.compound()` | `@layer compounds` |
| `.states()` | `@layer states` |
| `.groups()` | `@layer system` |
| `.props()` | `@layer custom` |

`.asClass()` does not introduce a new layer or modify layer assignment.

### HMR

Dev mode: `.asClass()` calls the runtime `createClassResolver`. CSS is injected via adopted stylesheets (same as components). On file edit, the vite plugin re-extracts and replaces the adopted stylesheet. Class names are position-hashed (stable), so existing DOM references remain valid.

### Type Tests

**Positive assertions:**
- `ds.styles({ display: 'flex' }).asClass()` returns `(props?: {}) => string`
- `ds.styles({}).variant({ prop: 'size', variants: { sm: {}, lg: {} } }).asClass()` — returned function accepts `{ size?: 'sm' | 'lg' }`
- `ds.styles({}).states({ loading: {} }).asClass()` — returned function accepts `{ loading?: boolean }`
- `ds.styles({}).groups({ space: true }).asClass()` — returned function accepts space props
- Full chain: all prop types merged in returned function signature

**Negative assertions:**
- `ds.asClass()` — error, no `.styles()` called (if enforced by type-state)
- After `.asElement()`: `.asElement('div').asClass()` — error, terminal already used
