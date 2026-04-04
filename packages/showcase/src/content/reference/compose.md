# compose()

Composes independently-authored Animus components into a sealed, namespaced component family with shared variant propagation via React context.

## Signature

```typescript
function compose<
  Slots extends Record<string, AnyBrandedComponent>,
  Shared extends SharedConfig<Slots>,
>(
  slots: Slots,
  options: { shared: Shared; name?: string }
): ComposedFamily<Slots>
```

## Parameters

### `slots`

```typescript
Record<string, AnyBrandedComponent>
```

A map of slot names to Animus components (created with `.asElement()` or `.asComponent()`). One slot must be named `Root` -- it acts as the context provider for shared variants.

### `options.shared`

```typescript
Record<string, true>
```

Declares which variant props are shared across slots. Keys must be variant prop names that exist on the `Root` component. TypeScript validates this constraint:

```typescript
// If Root has variants 'size' and 'intent':
{ shared: { size: true } }          // valid
{ shared: { size: true, intent: true } } // valid
{ shared: { missing: true } }       // TS error: 'missing' not a variant of Root
```

### `options.name`

```typescript
string  // optional, default: 'Composed'
```

Sets the `displayName` prefix for devtools. Each slot's display name becomes `{name}.{slotName}`.

## Return type

```typescript
ComposedFamily<Slots>
```

An object with the same keys as `slots`, where each value is a `ForwardRefExoticComponent`. The components are sealed -- no `.extend()` method, no builder chain access.

## Behavior

### Root provides, children consume

`Root` receives shared variant props directly. It wraps its children in a React context provider that distributes the shared values.

```tsx
<Card.Root size="lg">         {/* Root provides size="lg" via context */}
  <Card.Title>Heading</Card.Title> {/* Title receives size="lg" from context */}
  <Card.Body>Content</Card.Body>
</Card.Root>
```

### Direct props override context

A child slot can override a shared variant by passing the prop directly:

```tsx
<Card.Root size="lg">
  <Card.Title size="sm">Small title in a large card</Card.Title>
</Card.Root>
```

### Selective consumption

Only variant props that a child slot actually declares are consumed from context. If `CardBody` has no `size` variant, it ignores the shared `size` value -- no unknown props leak to the DOM.

### Root requirement

If no slot is named `Root`, `compose()` throws at runtime:

```
Error: compose(): No "Root" slot found. The root slot key must be exactly "Root" (PascalCase).
```

## Full example

```typescript
import { compose } from '@animus-ui/system';

const AlertRoot = ds
  .styles({
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    p: 16,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderRadius: '8px',
  })
  .variant({
    prop: 'severity',
    defaultVariant: 'info',
    variants: {
      info: { borderColor: 'primary', bg: 'surface' },
      error: { borderColor: 'error', bg: 'surface' },
    },
  })
  .asElement('div');

const AlertIcon = ds
  .styles({ flexShrink: '0', width: '20px', height: '20px' })
  .variant({
    prop: 'severity',
    defaultVariant: 'info',
    variants: {
      info: { color: 'primary' },
      error: { color: 'error' },
    },
  })
  .asElement('span');

const AlertMessage = ds
  .styles({ fontSize: 14, lineHeight: 'base' })
  .asElement('p');

const Alert = compose(
  { Root: AlertRoot, Icon: AlertIcon, Message: AlertMessage },
  { shared: { severity: true }, name: 'Alert' }
);

// Usage:
<Alert.Root severity="error">
  <Alert.Icon>!</Alert.Icon>
  <Alert.Message>Something went wrong.</Alert.Message>
</Alert.Root>
```

`Alert.Icon` automatically receives `severity="error"` from `Alert.Root` via context. `Alert.Message` has no `severity` variant, so it's unaffected.
