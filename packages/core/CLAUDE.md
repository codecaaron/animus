# Animus Core Package

## Canonical Specifications

Authoritative behavioral contracts:

- **`openspec/specs/builder-chain/spec.md`** — Type-state machine, cascade ordering, terminals, backwards inheritance
- **`openspec/specs/extension-system/spec.md`** — AnimusExtended flexible ordering, merge semantics, extension cascade ordering
- **`openspec/specs/prop-system/spec.md`** — Groups, scale resolution, transforms, responsive syntax, prop forwarding

## Key Files

- `src/Animus.ts` — Builder chain (6 classes, backwards inheritance)
- `src/AnimusExtended.ts` — Extension system (flexible ordering, immutable merge)
- `src/AnimusConfig.ts` — Entry point: `createAnimus().addGroup().build()`
- `src/config.ts` — 13 prop groups, default `animus` instance
- `src/styles/createStylist.ts` — Runtime style compilation (cascade merge)
- `src/styles/createParser.ts` — Prop→CSS resolution with responsive handling
- `src/styles/createPropertyStyle.ts` — Single prop→CSS with scale lookup + transform

## Builder Chain Order

```
animus.styles() → .variant() → .states() → .groups() → .props() → .asElement()
```

This order defines cascade priority. Later stages override earlier. The chain maps to CSS @layer: `base, variants, states, system, custom`.

## Responsive Syntax

```tsx
// Array: [default, xs, sm, md, lg, xl]
p={[8, 12, , 16]}

// Object: named breakpoints
p={{ _: 8, sm: 16 }}
```

Both generate equivalent `@media` queries. Available in `.styles()`, `.variant()`, `.states()`, and component props.
