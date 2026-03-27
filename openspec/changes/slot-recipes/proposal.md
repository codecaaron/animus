## Context

Multi-part components (Accordion, Checkbox, Dialog, Card) need coordinated styling across named sub-elements ("slots") from a single variant definition. Panda CSS (`sva()`), Chakra v3 (`defineSlotRecipe()`), and Ark UI all converge on this pattern.

Animus's @layer cascade contract makes this uniquely powerful — each slot is a builder chain with its own cascade position. A parent slot's variant styles predictably override a child slot's base styles. No other framework can guarantee this.

**This is an API-first decision.** How the consumer writes slot recipes matters more than the implementation.

## Status: READY TO IMPLEMENT

Design space explored, persona-reviewed (Panda/Ark, NextUI/TV, VE/StyleX), conclusion reached. The `compose()` utility is the right abstraction — low implementation cost, high optionality, zero extraction changes.

## Key Insight: Slot Recipes Are Not a Styling Primitive

At the styling primitive level (Panda's `sva()`, Tailwind Variants' `tv()`), slot recipes are **className factories** — pure functions that take variant values and return a record of class strings per slot. No React, no context, no components.

Context propagation only appears in the component library layer (Ark UI), not the styling system. This means the styling system's job is to produce per-slot classes; how they reach the DOM is a composition concern.

In Animus, each slot is already a full component (via `.asElement()`). The slot recipe question reduces to: **how do you compose existing components into a coordinated family with shared variant contracts?**

## Conclusion: `compose()` — Enforce, Wire, Seal

### The Pattern

```ts
// 1. Define slots independently — normal builder chain, full extraction
const CheckboxRoot = ds.styles({ display: 'flex', gap: 8 })
  .variant({ prop: 'size', variants: { sm: { gap: 4 }, md: { gap: 8 } } })
  .asElement('label')

const CheckboxControl = ds.styles({ borderWidth: '1px' })
  .variant({ prop: 'size', variants: { sm: { w: 20 }, md: { w: 24 } } })
  .asElement('div')

const CheckboxLabel = ds.styles({ ml: 8 })
  .variant({ prop: 'size', variants: { sm: { fontSize: 14 }, md: { fontSize: 16 } } })
  .asElement('span')

// 2. Compose — type-enforce shared variants, wire context, seal output
const Checkbox = compose({
  Root: CheckboxRoot,
  Control: CheckboxControl,
  Label: CheckboxLabel,
}, { shared: ['size'] as const })

// 3. Consumer uses composed components
<Checkbox.Root size="sm">
  <Checkbox.Control />
  <Checkbox.Label>Accept terms</Checkbox.Label>
</Checkbox.Root>
```

### What `compose()` Does

1. **Enforce** — TypeScript enforces at compile time that every slot component's variant interface includes the shared keys with matching value sets. If `CheckboxLabel` doesn't have a `size` variant, or if its `size` values don't match `CheckboxRoot`'s, the call to `compose()` is a type error. This solves the divergence problem (see Persona Reviews below).

2. **Wire** — Root becomes a React context provider for shared variant props. Child slots become context consumers. The consumer passes `size="sm"` to `Checkbox.Root`; `Checkbox.Control` and `Checkbox.Label` read it from context automatically.

3. **Seal** — The output components (`Checkbox.Root`, `Checkbox.Control`, `Checkbox.Label`) are plain React components, NOT Animus builders. No `.extend()`, no `.variant()`, no further chain. The builder chain is closed at composition time.

### Why Seal?

The compose boundary is a one-way door from builder-land to component-land. This prevents downstream code from adding variants outside the shared contract, which would break the type enforcement.

**To extend a composed component family:** go back to the source slot builders, extend them (`.extend()` or `.asComponent()`), and recompose. The shared variant contract gets re-enforced at the new composition site.

### Implementation Surface

- **Zero Rust changes.** Zero extraction changes. The Rust crate sees each slot as a normal component.
- **Pure TS types** for the shared variant enforcement (~0 runtime cost for type checking).
- **~50 lines of React** for context wiring (provider + consumer wrappers).
- **`.asClass()` is NOT a prerequisite.** `compose()` wraps `.asElement()` outputs directly. `.asClass()` (now shipped) enables Panda-style manual className distribution as a parallel option, but `compose()` works with components.

### Cross-Slot Compound Variants

**Explicitly out of scope for the styling system.** Cross-slot compounds ("when `checked=true AND size=sm`, control gets blue border AND label gets blue text") are runtime logic — the condition depends on component state, not static variant values.

Handle with conditional className or a state prop on the affected slot:

```ts
// In the component body — runtime logic, not extraction
<Checkbox.Control className={checked && size === 'sm' ? 'checked-sm-override' : undefined} />
```

The extraction pipeline handles each slot's self-contained variants. Cross-slot conditional styling is a component-library concern, not a styling-system concern.

### Consumer className Override

When a consumer passes `className` to a composed slot, it merges with the slot's extracted classes (appended, same as any Animus component). The cascade contract applies: consumer classes at `@layer system` or higher override base/variant styles deterministically.

## Design Space (explored, informing conclusion)

### Option A: Builder chain with `.slots()` entry point

```ts
const Checkbox = ds
  .slots(['root', 'control', 'label'])
  .styles({ root: { ... }, control: { ... }, label: { ... } })
  .variant({ prop: 'size', variants: { sm: { control: { ... } }, md: { ... } } })
  .asElements({ root: 'label', control: 'div', label: 'span' })
```

**Rejected:** Changes the shape of `.styles()` from flat CSS to slot-keyed objects. Requires a second type-state machine. The builder chain becomes about N components pretending to be one chain.

### Option B: Composition via `createSlotRecipe()`

```ts
const Checkbox = ds.slotRecipe({
  slots: { root: checkboxRoot, control: checkboxControl, label: checkboxLabel },
  variants: { ... },
})
```

**Rejected:** Variant styles are separate from slot definitions. The variant injection mechanism ("how do shared variants modify existing slot components?") has no clean answer without changing extraction.

### Option C: Independent components + thin utility

Evolved into the `compose()` conclusion above. Each slot owns its variants. The utility handles enforcement, context, and sealing.

## Persona Reviews (March 2026)

Three simulated practitioner reviews were conducted to stress-test the proposal:

### Convergent Signal (all three agree)

1. **Bottom-up composition is correct.** No new primitive needed.
2. **The real cost is divergence, not duplication.** Slots drift apart over time — engineer adds `lg` to one slot, forgets another. Bug surfaces months later. `compose()`'s type enforcement directly addresses this.
3. **Cross-slot compound variants are the unsolved hard case.** Correctly scoped as a component-library concern.
4. **The @layer cascade claim is real but narrower than originally stated.** It solves parent-variant vs child-base conflicts deterministically, but consumers hit other conflict patterns (sibling collisions, consumer overrides) more often.
5. **Consumer className override needs an explicit story.** (Addressed above.)

### Panda/Ark UI Reviewer

- Biggest pain of `sva()` is manual class distribution + context boilerplate. `compose()` solves exactly this.
- The "independence" story is partly illusory — in practice, slot components are never used outside their bundle. Source components should be non-exported.
- Variant divergence across slots is a real maintenance burden at 15+ multi-slot components.

### NextUI/Tailwind Variants Reviewer

- Context is not how `tv()` propagates variants — it uses a single call site. But for Animus's component model (`.asElement()` outputs), context is the appropriate mechanism.
- Unified type inference matters for Storybook controls, form integration, and design tooling. `compose()` should derive a union type for shared props automatically.
- Variant value set mismatches between slots are the specific bug class that type enforcement must catch.

### Vanilla Extract/StyleX Reviewer

- `bundle()` is context dressed as explicitness — honest framing matters.
- The layer-per-slot cascade contract is genuinely better than VE's atomic merge model for composition.
- Biggest risk at scale: slots gain variants outside the bundle's `shared` list, and the bundle doesn't know to propagate them. `compose()` type enforcement addresses this if the shared list is enforced bidirectionally.

## Prior Art Comparison

| Framework | API shape | @layer ordering | Extraction | Runtime model |
|---|---|---|---|---|
| Panda `sva()` | Flat config, top-down | No @layer | Build-time codegen | className factory |
| Chakra `defineSlotRecipe()` | Flat config, top-down | No @layer | Build-time codegen | className factory |
| NextUI / Tailwind Variants | `tv()` with slots | No @layer | None (runtime) | className factory |
| Animus `compose()` | Bottom-up, type-enforced | Per-slot @layer | Per-component Rust extraction | Sealed components + context |

The @layer advantage is preserved in the bottom-up approach because each slot IS a normal Animus component with full cascade semantics. The compose boundary adds coordination without changing the extraction model.

## Prerequisites

- `.asClass()` terminal — **SHIPPED** (session 20). Enables Panda-style manual className wiring as a parallel option. Not required for `compose()`.
- Type-level variant interface extraction from `AnimusComponent` — needed for `compose()` to read variant keys and value sets from slot components at the type level.
