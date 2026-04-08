# Framework Agnosticism & Headless UI

## Headless UI interop

Animus components pass through `data-*` and `aria-*` attributes, making them compatible with headless UI libraries like Radix and Ark UI. Target third-party state attributes in nested selectors:

```typescript
const Dialog = ds
  .styles({
    bg: 'surface',
    opacity: '0',
    '&[data-state="open"]': { opacity: '1' },
    '&[data-state="closed"]': { opacity: '0' },
  })
  .asComponent(RadixDialog.Content);
```

## Using `.asClass()` outside React

`.asClass()` is a terminal that returns a class resolver function instead of a React component. Same resolution logic -- variants, states, system props -- but the output is a className string:

```typescript
const resolveCard = ds
  .styles({ display: 'block', p: 16, bg: 'surface' })
  .variant({
    prop: 'size',
    variants: {
      sm: { p: 8 },
      lg: { p: 32 },
    },
  })
  .asClass();

resolveCard({ size: 'lg' });
// → "animus-Card-x3k9f animus-Card-x3k9f--size-lg"
```

This is useful when you need Animus's style resolution without React:

- **Server rendering** -- generate class names in a Node template engine or edge function
- **Non-React frameworks** -- apply resolved classes in Svelte, Vue, or Solid components
- **Testing** -- assert that a specific prop combination produces expected classes

## Going further

- [Base Styling](/docs/authoring/base-styling) -- `as` prop, className merging, dynamic styles
- [Builder Chain reference](/docs/reference/builder-chain) -- `.asClass()` and `.asComponent()` details
