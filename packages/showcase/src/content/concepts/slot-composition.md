# Slot Composition

Multi-part components — cards, accordions, form fields — need coordinated styling across named sub-elements. Each slot is an independent Animus component with its own cascade layers. `compose()` takes these independent slots and produces a sealed component family with shared variant propagation via React context.

The utility performs three operations: **Enforce** — TypeScript verifies that every shared variant key exists on all slots with matching value sets. Compile error on mismatch. **Wire** — Root becomes a context provider for shared variant values. Child slots consume them automatically. Direct props on children override context. **Seal** — output components are plain `ForwardRefExoticComponent` with no `.extend()`. The builder chain is closed at composition time.

### Define slots independently

Each slot is a normal builder chain. The `density` variant exists on every slot — compact tightens spacing and font sizes, comfortable opens them up. The `variant` prop (elevated, outlined, ghost) exists only on Root.

```tsx
// Each slot is an independent component with its own cascade layers.
// density exists on every slot — compose() enforces matching value sets.

const CardRoot = ds
  .styles({
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'mono',
    color: 'text',
  })
  .variant({
    prop: 'density',
    variants: {
      compact:     { p: 12, gap: 4 },
      comfortable: { p: 24, gap: 12 },
    },
  })
  .variant({
    prop: 'variant',
    variants: {
      elevated: { bg: 'surface', border: 1, borderColor: 'border', boxShadow: 'glow-accent' },
      outlined: { bg: 'transparent', border: 1, borderColor: 'border' },
      ghost:    { bg: 'transparent', border: 1, borderColor: 'transparent' },
    },
  })
  .asElement('article');

const CardHeader = ds
  .styles({ fontWeight: 500, color: 'text' })
  .variant({
    prop: 'density',
    variants: {
      compact:     { fontSize: 13, pb: 4 },
      comfortable: { fontSize: 16, pb: 8 },
    },
  })
  .asElement('header');

const CardBody = ds
  .styles({ color: 'text-muted', lineHeight: 'relaxed' })
  .variant({
    prop: 'density',
    variants: {
      compact:     { fontSize: 12 },
      comfortable: { fontSize: 14 },
    },
  })
  .asElement('div');

const CardFooter = ds
  .styles({ display: 'flex', borderTopWidth: '1px', borderTopStyle: 'solid', borderTopColor: 'border' })
  .variant({
    prop: 'density',
    variants: {
      compact:     { gap: 6, pt: 8, mt: 4, fontSize: 12 },
      comfortable: { gap: 12, pt: 16, mt: 8, fontSize: 13 },
    },
  })
  .asElement('footer');
```

### Compose the family

```tsx
import { compose } from '@animus-ui/system';

// Enforce: density must exist on ALL slots with matching values.
// Wire:    Root provides density via context. Children consume it.
// Seal:    Output components have no .extend() — the chain is closed.

const Card = compose({
  Root: CardRoot,
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
}, { shared: { density: true } });
```

### Consumer usage

```tsx
// One prop on Root — every slot responds.
<Card.Root density="compact" variant="elevated">
  <Card.Header>System Status</Card.Header>
  <Card.Body>All services operational.</Card.Body>
  <Card.Footer>
    <Button size="sm" kind="ghost">Details</Button>
  </Card.Footer>
</Card.Root>
```
