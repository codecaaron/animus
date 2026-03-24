## Why

The current `.states()` conflates two distinct concepts: composable boolean behavior toggles (`column`, `centered`, `loading`) and semantic DOM states (`disabled`, `hidden`, `open`). Boolean toggles are lightweight prop-driven style overrides that compose freely. Semantic DOM states are selector-driven — they target the presence of HTML attributes or data attributes on the element. Conflating them means:

1. Semantic states like `disabled` get swallowed by the runtime (prop consumed, never forwarded to DOM), breaking accessibility and headless UI interop
2. No system-level vocabulary for targeting DOM state selectors (`[data-state="open"]`, `[disabled]`, `[aria-expanded]`) — each component re-invents selector strings

## Design Principles

### The cascade contract is inviolable
Each chain method maps to a predictable `@layer`. Later layers always override earlier ones. No exceptions. No sovereignty. No `!important` by any name. The four-layer model holds:

```
@layer base, variants, states, system
```

System props override states. States override variants. The consumer always knows what wins by looking at the layer order. If a consumer sets `bg="red"` on a component with state styling, system wins. They chose that. The system told them what would happen.

### States are composable behavior toggles
States are independent boolean props that compose: `<Stack column centered gap={16} />`. They are NOT variants (which are mutually exclusive within a prop). They are NOT semantic DOM states (which should be targeted via selectors). States create typed boolean props, apply classes from `@layer states`, and are consumed by the runtime (not forwarded to DOM).

### Semantic DOM states are selectors, not props
`disabled`, `hidden`, `open`, `checked` — these are DOM concerns. They belong in `.styles()` via selector syntax (`'&[disabled]': { ... }`), not in `.states()`. The styling fires when the attribute is present on the element. The component author writes the selector; the consumer (or Radix, or native HTML) manages the attribute.

## What Changes

### Selector registry (`.withSelectors()`)
A new system builder method that registers selector shorthands — a vocabulary for targeting DOM state selectors from any style position:

```tsx
createSystem()
  .withTokens(...)
  .withProperties(...)
  .withSelectors({
    open: '[data-state="open"]',
    closed: '[data-state="closed"]',
    disabled: '[disabled]',
    active: '[data-active]',
  })
  .build();
```

Registered selectors become usable as shorthand in `.styles()`, `.variant()`, and `.states()`:

```tsx
ds.styles({
  bg: 'surface',
  '&:open': { maxHeight: '500px' },     // → &[data-state="open"]
  '&:disabled': { opacity: 0.4 },       // → &[disabled]
})
```

The registry:
- Is analogous to custom transforms (system-level vocabulary for selectors, like `fluid` is for values)
- Syncs usage across components — register `data-state="open"` once, target it consistently everywhere
- Is resolved at extraction time — the Rust pipeline or Vite plugin expands shorthands to full selectors
- Does NOT create props, does NOT affect cascade, does NOT add layers

### State prop forwarding (runtime)
The runtime should forward state props to the DOM when they match valid HTML attributes. A small map of forwardable attributes (`disabled`, `hidden`, `checked`, `open`, `required`, `readOnly`) plus `data-*` and `aria-*` prefix matching. This is independent of the selector registry — it's a runtime concern for semantic correctness.

### No cascade changes
The four-layer model stays: `@layer base, variants, states, system`. No new layers. No sovereignty. All layers overridable by the next.

## Capabilities

### New Capabilities
- `selector-registry`: System builder method for registering selector shorthands. Resolved at extraction time. Usable in any style position via `&:shorthand` syntax.

### Modified Capabilities
- `extraction-runtime-shim`: Runtime gains forwarding logic for state props that match valid HTML attributes or data/aria prefixes.
- `system-builder`: Gains `.withSelectors()` method in the builder chain.

## Impact

- **System package** (`packages/system/`): `SystemBuilder` gains `.withSelectors()`. `SerializedConfig` gains `selectors` field. Selector map passed through to extraction pipeline.
- **Runtime** (`packages/runtime/`): `createComponent` gains forwarding logic for semantic state props.
- **Rust crate** (`packages/extract/`): Selector shorthand expansion during CSS generation. Registered selectors resolved to full attribute selectors.
- **Vite plugin** (`packages/vite-plugin/`): Passes selector registry from serialized config to extraction pipeline.

## Design Notes

### Why not a sovereign assertion layer?
A sovereign layer violates the cascade contract. Every layer must be overridable by the next. No exceptions. Sovereignty is `!important` by another name.

### Why not collapse states into boolean variants?
States compose independently (`<Stack column centered />`). Variants are mutually exclusive within a prop (`size="sm" | "lg"`). Different concept, different ergonomics. States also have their own cascade position (`@layer states` after `@layer variants`), giving component authors a predictable layering for behavior toggles vs named variations.

### Why a registry instead of ad-hoc selectors?
`'&[data-state="open"]'` works today in `.styles()`. The registry adds vocabulary — a single source of truth for what selectors mean in your system. Like tokens name colors and transforms name value functions, registered selectors name DOM states. Consistent naming, no typo risk, discoverable via autocomplete.

### Comparison to Tailwind data attribute variants
Tailwind's `data-[state=open]:bg-red-500` is ad-hoc — the selector is inline in the utility class. Animus's registry is system-level — you define the vocabulary once, use it everywhere with a shorthand. The registry is the closed vocabulary; Tailwind is the open one.
