## Context

Every comparable CSS-in-JS framework provides a standalone style utility for one-off class generation. Animus currently requires a full builder chain ending in `.asElement()` — producing a React component even when you just want a className.

The insight: this isn't a new API. It's a new **terminal** on the existing builder chain. The chain already encodes styles, variants, states, compounds, groups. The terminal determines what comes out.

## Goals / Non-Goals

**Goals:**
- `.asClass()` terminal on the builder chain — same chain, different output shape
- Always returns a callable function: `() => string` (static) or `(props) => string` (dynamic)
- Full cascade contract preserved — `.styles()` → `@layer base`, `.variant()` → `@layer variants`, etc.
- All chain methods work: styles, variants, states, compounds, groups, props
- Static extraction via Rust crate — optimizable to string literal at call sites
- Framework-agnostic — no React dependency

**Non-Goals:**
- Callable strings / dual string+function return types (JS can't)
- Tagged template literal syntax (awkward for options objects)
- New chain methods or new concepts

## The API

### Static usage (no dynamic aspects)

```ts
const card = ds
  .styles({ display: 'flex', p: 16, bg: 'surface', borderRadius: 4 })
  .asClass()

// Always called — returns className string
<div className={card()} />
```

### With variants

```ts
const button = ds
  .styles({ display: 'inline-flex', cursor: 'pointer' })
  .variant({
    prop: 'size',
    variants: {
      sm: { p: 4, fontSize: 14 },
      lg: { p: 16, fontSize: 18 },
    },
  })
  .asClass()

<button className={button({ size: 'lg' })} />
```

### With states

```ts
const panel = ds
  .styles({ overflow: 'hidden' })
  .states({ open: { maxHeight: '500px' }, disabled: { opacity: '0.5' } })
  .asClass()

<div className={panel({ open: true })} />
```

### With groups (system props)

```ts
const box = ds
  .styles({ display: 'flex' })
  .groups({ space: true, layout: true })
  .asClass()

<div className={box({ p: 16, m: 8, display: 'grid' })} />
```

### Full chain

```ts
const widget = ds
  .styles({ display: 'flex' })
  .variant({ prop: 'variant', variants: { ghost: { opacity: '0.8' } } })
  .states({ loading: { opacity: '0.5' } })
  .compound({ variant: 'ghost', loading: true }, { display: 'none' })
  .groups({ space: true })
  .asClass()

<div className={widget({ variant: 'ghost', loading: true, p: 8 })} />
```

### Composition

className concatenation. No special merge API:

```tsx
<div className={`${card()} ${box({ p: 16 })}`} />
```

## Decisions

### 1. Always callable

`.asClass()` always returns a function. Static usage: `card()`. Dynamic usage: `button({ size: 'lg' })`.

**Why not conditional return type (string vs function)?** The conditional type is possible via the type-state machine, but:
- Adds complexity to already-complex builder types
- Creates two consumption patterns consumers must learn
- Extraction can optimize `card()` → `"animus-card-abc"` at the call site anyway

Always callable = one pattern, simpler types, extraction-optimizable.

### 2. Same chain, different terminal

`.asClass()` sits alongside `.asElement()` and `.asComponent()` as a terminal method. The chain is identical — only the output shape differs.

| Terminal | Output | React dependency |
|---|---|---|
| `.asElement('div')` | React component | Yes |
| `.asComponent(Base)` | Extended React component | Yes |
| `.asClass()` | `(props?) => string` | No |

### 3. Cascade contract preserved

The terminal does not affect WHERE styles go — only WHAT comes out. Layer assignment is determined by chain methods:
- `.styles()` → `@layer base`
- `.variant()` → `@layer variants`
- `.states()` → `@layer states`
- `.compound()` → `@layer compounds`
- `.groups()` → `@layer system`

### 4. Framework-agnostic

`.asClass()` returns a plain function. No React, no JSX, no hooks. Works in Svelte, Vue, vanilla JS, server-side rendering, anywhere you can set a class attribute.

## Runtime Implementation

The returned function is `createComponent` minus `React.createElement`:

```ts
function createClassResolver(
  baseClassName: string,
  variantConfig?: VariantConfig,
  stateConfig?: StateConfig,
  compoundConfig?: CompoundConfig,
  systemPropMap?: SystemPropMap,
  dynamicPropConfig?: DynamicPropConfig
): (props?: Record<string, unknown>) => string
```

Resolves variant classes, state toggles, compound matches, system prop utilities — returns concatenated className string. All logic already exists in `createComponent`; this factors it out.

## Extraction

### Static chains (no variants/states/groups)

Rust replaces the `.asClass()` chain with a `createClassResolver` call with only a base className. The extractor MAY further optimize call sites: `card()` → `"animus-card-abc"` (inline string literal, zero runtime).

### Dynamic chains

Rust replaces with `createClassResolver(base, variantConfig, ...)` — same shape as `createComponent` replacement but without the element/React wrapper.

### Class naming

Same pattern as components:
- Dev: `animus-{variableName}-{positionHash}` (stable across edits for HMR)
- Prod: `animus-{variableName}-{contentHash}` (optimal caching)

Variable name inferred from AST (same as component name inference).

## Type Signature

```ts
// On the builder chain (simplified)
asClass(): (props: InferredProps) => string

// Where InferredProps is derived from the chain's accumulated generics:
// - Variant props (from .variant() calls)
// - State booleans (from .states() calls)
// - System props (from .groups() calls)
// - Dynamic props (from .props() calls)
// If none of the above: empty object (call with no args)
```

## Implementation Scope

### TypeScript (system package)
- Add `.asClass()` terminal to builder chain types (Animus.ts, AnimusExtended.ts)
- Factor className resolution out of `createComponent` → `createClassResolver`
- Export `createClassResolver` from system package

### Rust (extract crate)
- Recognize `.asClass()` as a terminal in `chain_walker.rs`
- Emit `createClassResolver` call instead of `createComponent` in `transform_emitter.rs`
- CSS generation unchanged — same pipeline as `.asElement()`

### Vite plugin
- No changes needed — `.asClass()` chains are extracted alongside component chains

### Tests
- Type tests: `.asClass()` compiles, return type is function, props inferred correctly
- Unit tests: `createClassResolver` produces correct classNames for variant/state/compound/group combos
- Canary tests: `.asClass()` chain extracts correctly, CSS emitted to correct layers
