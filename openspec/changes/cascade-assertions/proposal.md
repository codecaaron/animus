## Why

The current `.states()` method serves two fundamentally different purposes: boolean style toggles (`column`, `reverse`, `loading`) and semantic HTML states (`disabled`, `hidden`, `open`). Both are valid uses of boolean props, but they differ in one critical way: semantic states should forward to the DOM as attributes for accessibility and headless UI interop, while toggles should be consumed and stripped.

Additionally, the runtime currently swallows ALL state props — including `disabled`, `hidden`, and other valid HTML attributes. This means `<Button disabled />` where `disabled` is a state never sets the HTML `disabled` attribute on the element, breaking browser UA styles, screenreader announcements, and headless UI interop (Radix, Ark, etc.).

## Design Principles

### The cascade contract is inviolable
Each chain method maps to a predictable `@layer`. Later layers always override earlier ones. No exceptions. No sovereignty. No `!important` by any name. The consumer always knows what wins by looking at the layer order:

```
@layer base, variants, states, system
```

System props override states. States override variants. That is the contract. If a consumer sets `bg="red"` on a disabled component, system wins. They chose that. The system told them what would happen.

### DOM forwarding is orthogonal to cascade position
Forwarding `disabled` to the DOM is an accessibility concern, not a cascade concern. The state's CSS class is applied AND the attribute is forwarded. But the cascade position doesn't change — system props can still override state styling. These are independent concerns.

## What Changes

### Boolean toggles → boolean variants
Current states that are pure styling toggles (`column`, `reverse`, `wrap`, `centered`) should migrate to boolean variants. They are two-valued variants — on or off — and belong in `@layer variants`.

### State prop forwarding
The runtime should forward state props to the DOM when they are valid HTML attributes for the given element. The forwarding heuristic:
- If state name is a valid HTML attribute for the element → forward
- If state name starts with `data-` → forward
- If state name starts with `aria-` → forward
- Otherwise → consume and strip (current behavior for custom states like `loading`)

The runtime maintains a small map of common forwardable attributes (`disabled`, `hidden`, `checked`, `open`, `required`, `readOnly`) rather than a full HTML spec lookup. Data and ARIA attributes are forwarded by prefix match.

### No cascade changes
The four-layer model stays: `@layer base, variants, states, system`. States remain in their current cascade position. System props can override state styling. This is predictable and correct.

## Capabilities

### Modified Capabilities
- `extraction-runtime-shim`: Runtime gains forwarding logic for state props that match valid HTML attributes or data/aria prefixes. State class is still applied; prop is additionally forwarded to DOM.
- `builder-chain`: `.states()` documentation clarifies the distinction between boolean toggles (consider `.variant()`) and semantic states (forwarded to DOM).

## Impact

- **Runtime** (`packages/runtime/`): `createComponent` gains a `forwardableStates` set or map. State props matching this set are both class-applied AND forwarded to DOM.
- **No cascade changes.** No new layers. No sovereignty. The four-layer model is unchanged.
- **No new chain methods.** `.states()` continues to work as-is. The forwarding is a runtime behavior, not a chain-level concept.

## Design Notes

### Why not a sovereign assertion layer?
A sovereign layer that cannot be overridden by system props violates the cascade contract. The contract says: later layers always win. No exceptions. Sovereignty is `!important` repackaged as architecture. The consumer must always have the last word via system props.

### Why not compound selectors in base?
`.card[disabled]` in `.styles()` is already possible via `'&[disabled]'` syntax. It doesn't create a prop, doesn't participate in the type system, and doesn't interact with the runtime. States as a chain method exist precisely because they create typed boolean props with defined cascade and runtime behavior.

### The disabled-looks-active case
`<Button disabled bg="red" />` — system prop overrides disabled styling. This is correct per the cascade contract. The consumer explicitly chose to override. If they didn't want that, they shouldn't pass `bg`. The system is predictable; the consumer is responsible.
