# Composition

## Multi-slot component families

```typescript
import { compose } from '@animus-ui/system';

const CardRoot = ds
  .styles({
    p: 16,
    bg: 'surface',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'border',
    borderRadius: '8px',
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { p: 8 },
      lg: { p: 24 },
    },
  })
  .asElement('div');

const CardTitle = ds
  .styles({
    fontWeight: 700,
    m: 0,
  })
  .variant({
    prop: 'size',
    variants: {
      sm: { fontSize: 14 },
      lg: { fontSize: 24 },
    },
  })
  .asElement('h3');

const Card = compose(
  { Root: CardRoot, Title: CardTitle },
  { shared: { size: true } }
);
```

`compose()` takes two arguments: a slots object and an options object. The slots object maps names to Animus components. The options object declares which variant props are shared across slots.

```tsx
<Card.Root size="lg">
  <Card.Title>Large card</Card.Title>
</Card.Root>
```

Pass `size="lg"` to `Card.Root` and `Card.Title` receives the same sizing automatically via CSS cascade. The extraction pipeline emits composed variant rules that use descendant selectors -- no React context, no runtime overhead. Direct props on a child slot override the inherited value via CSS source order.

## The Root convention

One slot must be named `Root`. It's the cascade source -- shared variant values are applied as classes on `Root`, and CSS descendant selectors carry the styles to all child slots.

```typescript
// This throws at runtime:
compose(
  { Container: SomeComponent, Title: SomeOther },
  { shared: {} }
);
// Error: No "Root" slot found
```

## Shared variant validation

The `shared` config is validated against the Root slot's variant keys at the type level:

```typescript
compose(
  { Root: CardRoot, Title: CardTitle },
  { shared: { size: true } }       // 'size' must be a variant on CardRoot
);

compose(
  { Root: CardRoot, Title: CardTitle },
  { shared: { missing: true } }    // TS error: 'missing' is not a variant key of Root
);
```

Only variant props that exist on Root can be shared. The extraction pipeline only emits composed CSS rules for variants that the child actually declares -- no unnecessary rules are generated.

## Sealed output

The components returned by `compose()` are plain `ForwardRefExoticComponent` -- no `.extend()`, no builder methods. Composition is a one-way door from builder-land to component-land.

```typescript
Card.Root.extend();  // This doesn't exist -- composed output is sealed
```

## Naming

By default, composed families use the display name `Composed`. Pass a `name` option for better devtools labels:

```typescript
const Card = compose(
  { Root: CardRoot, Title: CardTitle },
  { shared: { size: true }, name: 'Card' }
);
// Card.Root.displayName → "Card.Root"
// Card.Title.displayName → "Card.Title"
```

## Going further

- [TypeScript & Autocomplete](/docs/advanced/typescript) -- type system features and error paths
- [compose() reference](/docs/reference/compose) -- full API details
