## Context

Multi-part components (Accordion, Checkbox, Dialog, Card) need coordinated styling across named sub-elements ("slots") from a single variant definition. Panda CSS (`sva()`), Chakra v3 (`defineSlotRecipe()`), and Ark UI all converge on this pattern.

Animus's @layer cascade contract makes this uniquely powerful — each slot is a builder chain with its own cascade position. A parent slot's variant styles predictably override a child slot's base styles. No other framework can guarantee this.

**This is an API-first decision.** How the consumer writes slot recipes matters more than the implementation. This explore documents the design space before proposing a specific API.

## Status: EXPLORE

Not ready for implementation. Needs API design iteration.

## The Pattern

A slot recipe defines:
1. Named slots (sub-elements)
2. Per-slot base styles
3. Shared variants that style multiple slots simultaneously
4. A root element that accepts variant props and propagates them to child slots

Example: a Checkbox with `root`, `control`, and `label` slots. The `size` variant simultaneously changes the control's dimensions and the label's font size.

## Design Space

### Option A: Builder chain with `.slots()` entry point

```ts
const Checkbox = ds
  .slots(['root', 'control', 'label'])
  .styles({
    root: { display: 'flex', alignItems: 'center', gap: 8 },
    control: { borderWidth: '1px', borderRadius: 4 },
    label: { ml: 8 },
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { control: { w: 20, h: 20 }, label: { fontSize: 14 } },
      md: { control: { w: 24, h: 24 }, label: { fontSize: 16 } },
    },
  })
  .asElements({
    root: 'label',
    control: 'div',
    label: 'span',
  })

// Returns: { Root, Control, Label } — React components
// Root accepts variant props, propagates via context
<Checkbox.Root size="sm">
  <Checkbox.Control />
  <Checkbox.Label>Accept terms</Checkbox.Label>
</Checkbox.Root>
```

**Pros:** Familiar builder chain. @layer ordering per slot is implicit. Type-state machine enforces method ordering across ALL slots simultaneously.
**Cons:** Style objects are now keyed by slot name — different shape from single-component `.styles()`. `.asElements()` is a new terminal. The type-state machine needs to track slot names as generic.

### Option B: Composition of independent chains via `createSlotRecipe()`

```ts
const checkboxRoot = ds.styles({ display: 'flex', gap: 8 }).asElement('label')
const checkboxControl = ds.styles({ borderWidth: '1px' }).asElement('div')
const checkboxLabel = ds.styles({ ml: 8 }).asElement('span')

const Checkbox = ds.slotRecipe({
  slots: { root: checkboxRoot, control: checkboxControl, label: checkboxLabel },
  variants: {
    size: {
      sm: { control: { w: 20, h: 20 }, label: { fontSize: 14 } },
      md: { control: { w: 24, h: 24 }, label: { fontSize: 16 } },
    },
  },
})

// Same consumption:
<Checkbox.Root size="sm">
  <Checkbox.Control />
  <Checkbox.Label>Accept</Checkbox.Label>
</Checkbox.Root>
```

**Pros:** Each slot is a full standalone component. Slots can be used independently. Variant layer is added ON TOP of existing slot components.
**Cons:** Variant styles are separate from slot definitions — harder to see the full picture. Two-step definition. The variant styles need to inject into each slot's cascade somehow.

### Option C: Minimal — variant context without new API

```ts
// No new API — just a React context pattern on top of existing components
const CheckboxRoot = ds.styles({ display: 'flex' })
  .variant({ prop: 'size', variants: { sm: { gap: 4 }, md: { gap: 8 } } })
  .asElement('label')

const CheckboxControl = ds.styles({ borderWidth: '1px' })
  .variant({ prop: 'size', variants: { sm: { w: 20 }, md: { w: 24 } } })
  .asElement('div')

// User wires context manually or we provide a utility
const Checkbox = createSlotContext({ root: CheckboxRoot, control: CheckboxControl })
```

**Pros:** Zero new API surface. Each slot is a normal component. Context wiring is a thin utility.
**Cons:** Variants are duplicated across slots (the `size` prop appears on each). No single source of truth for "these slots share this variant." Extraction doesn't know they're related.

## Open Questions

1. **Does the Rust crate need to know about slots?** If variants are shared across slots, the crate needs to generate variant classes that apply to multiple components simultaneously. This is different from per-component variant generation.

2. **How does variant propagation work at runtime?** React context from root to children. The root captures variant props, provides them via context, each child slot reads the context and applies the appropriate class.

3. **How do compound variants work across slots?** `{ size: 'sm', variant: 'ghost' }` → styles for BOTH control and label. The compound condition is on the root, but styles are distributed.

4. **Extension of slot recipes?** Can you `.asComponent(CheckboxSlotRecipe)` to extend a slot recipe? Which slots are extensible?

5. **What's the extraction shape?** Does a slot recipe produce ONE manifest entry or N entries (one per slot)? N seems right — each slot is independently extracted with its own class.

## Prior Art Comparison

| Framework | API shape | @layer ordering | Extraction |
|---|---|---|---|
| Panda `sva()` | Flat config object | No @layer | Build-time codegen |
| Chakra `defineSlotRecipe()` | Flat config object | No @layer | Build-time codegen |
| Animus (proposed) | Builder chain or slot composition | Per-slot @layer | Rust extraction |

The @layer advantage: in Panda/Chakra, if a parent slot's variant style conflicts with a child slot's base style, resolution depends on class order (fragile). In Animus, `@layer variants` always beats `@layer base` — the cascade contract resolves it.
